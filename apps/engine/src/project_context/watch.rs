use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{oneshot, Mutex};

use crate::projects::ProjectContext;

use super::{db, inventory};

const EVENT_QUEUE: usize = 256;
const DEBOUNCE: Duration = Duration::from_millis(300);
const RECONCILE_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Clone)]
pub struct ProjectContextWatchRuntime {
    workers: Arc<Mutex<HashMap<String, WatchWorker>>>,
    debounce: Duration,
    reconcile_interval: Duration,
}

struct WatchWorker {
    revision: String,
    stop: oneshot::Sender<()>,
}

impl std::fmt::Debug for ProjectContextWatchRuntime {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProjectContextWatchRuntime")
            .finish_non_exhaustive()
    }
}

impl Default for ProjectContextWatchRuntime {
    fn default() -> Self {
        Self::new()
    }
}

impl ProjectContextWatchRuntime {
    pub fn new() -> Self {
        Self::with_intervals(DEBOUNCE, RECONCILE_INTERVAL)
    }

    fn with_intervals(debounce: Duration, reconcile_interval: Duration) -> Self {
        Self {
            workers: Arc::new(Mutex::new(HashMap::new())),
            debounce,
            reconcile_interval,
        }
    }

    pub async fn ensure(&self, context: ProjectContext, generation: u64) {
        let mut workers = self.workers.lock().await;
        if workers
            .get(context.project_id())
            .is_some_and(|worker| worker.revision == context.revision())
        {
            return;
        }
        if let Some(worker) = workers.remove(context.project_id()) {
            let _ = worker.stop.send(());
        }
        let (stop, stopped) = oneshot::channel();
        workers.insert(
            context.project_id().to_string(),
            WatchWorker {
                revision: context.revision().to_string(),
                stop,
            },
        );
        let debounce = self.debounce;
        let reconcile_interval = self.reconcile_interval;
        tokio::spawn(async move {
            run(context, generation, debounce, reconcile_interval, stopped).await;
        });
    }

    pub async fn stop(&self, project_id: &str) {
        if let Some(worker) = self.workers.lock().await.remove(project_id) {
            let _ = worker.stop.send(());
        }
    }

    #[cfg(test)]
    async fn active(&self, project_id: &str) -> bool {
        self.workers.lock().await.contains_key(project_id)
    }
}

async fn run(
    context: ProjectContext,
    mut generation: u64,
    debounce: Duration,
    reconcile_interval: Duration,
    mut stopped: oneshot::Receiver<()>,
) {
    let root = context.canonical_root().to_path_buf();
    let identity = match inventory::root_identity(&root) {
        Ok(value) => value,
        Err(_) => {
            mark_stale(&context).await;
            return;
        }
    };
    let mut fingerprint = match inventory::fingerprint(&root).await {
        Ok(value) => value,
        Err(_) => {
            mark_stale(&context).await;
            return;
        }
    };
    let mut hints = ChangeHints::default();
    let mut watch_poll = tokio::time::interval(debounce);
    watch_poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    watch_poll.tick().await;
    let mut reconcile = tokio::time::interval(reconcile_interval);
    reconcile.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    reconcile.tick().await;
    loop {
        tokio::select! {
            _ = &mut stopped => return,
            _ = watch_poll.tick() => { hints.push(); }
            _ = reconcile.tick() => { hints.overflowed = true; }
        }
        if inventory::root_identity(&root).ok().as_ref() != Some(&identity) {
            mark_stale(&context).await;
            return;
        }
        let next = match inventory::fingerprint(&root).await {
            Ok(value) => value,
            Err(_) => {
                mark_stale(&context).await;
                return;
            }
        };
        let forced = hints.take();
        if !forced && next == fingerprint {
            continue;
        }
        set_pending(&context, 1).await;
        match inventory::rebuild(&context, generation, context.revision()).await {
            Ok(result) => {
                generation = result.generation;
                fingerprint = next;
            }
            Err(inventory::InventoryError::Conflict) => {
                if let Ok(status) = super::status::load_status(&context).await {
                    generation = status.inventory_generation;
                }
            }
            Err(_) => mark_stale(&context).await,
        }
    }
}

#[derive(Default)]
struct ChangeHints {
    pending: usize,
    overflowed: bool,
}

impl ChangeHints {
    fn push(&mut self) {
        if self.pending == EVENT_QUEUE {
            self.overflowed = true;
        } else {
            self.pending += 1;
        }
    }

    fn take(&mut self) -> bool {
        let forced = self.overflowed;
        self.pending = 0;
        self.overflowed = false;
        forced
    }
}

async fn set_pending(context: &ProjectContext, pending: u64) {
    if let Ok(database) = db::open(context).await {
        let _ = database.connection.execute(
            "UPDATE context_metadata SET pending_changes = ?1 WHERE singleton = 1",
            [pending],
        );
    }
}

async fn mark_stale(context: &ProjectContext) {
    if let Ok(database) = db::open(context).await {
        let _ = database.connection.execute(
            "UPDATE context_metadata SET build_state = 'stale', pending_changes = CASE WHEN pending_changes < 1 THEN 1 ELSE pending_changes END WHERE singleton = 1",
            [],
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::ProductIdentity;
    use crate::project_context::{fts, load_status, rebuild};
    use crate::projects::ProjectRegistryRuntime;
    use crate::storage::resolve_storage_paths;

    async fn fixture() -> (tempfile::TempDir, ProjectRegistryRuntime, ProjectContext) {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        let paths = resolve_storage_paths(
            &ProductIdentity::load().unwrap(),
            &temp.path().join("project"),
            &temp.path().join("config"),
            &temp.path().join("cache"),
        );
        let registry = ProjectRegistryRuntime::new(&paths);
        let project = registry.register(&root, Some("Watch")).await.unwrap();
        let context = registry
            .resolve_context(&paths, &project.project_id)
            .await
            .unwrap();
        (temp, registry, context)
    }

    async fn wait_generation(context: &ProjectContext, minimum: u64) -> u64 {
        for _ in 0..100 {
            let generation = load_status(context).await.unwrap().inventory_generation;
            if generation >= minimum {
                return generation;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("generation did not advance")
    }

    #[tokio::test]
    async fn project_context_watch_reindexes_changed_deleted_and_renamed_files() {
        let (_temp, _registry, context) = fixture().await;
        std::fs::write(
            context.canonical_root().join("old.rs"),
            "fn old_marker() {}\n",
        )
        .unwrap();
        let first = rebuild(&context, 0, context.revision()).await.unwrap();
        let runtime = ProjectContextWatchRuntime::with_intervals(
            Duration::from_millis(10),
            Duration::from_millis(40),
        );
        runtime.ensure(context.clone(), first.generation).await;
        std::fs::rename(
            context.canonical_root().join("old.rs"),
            context.canonical_root().join("new.rs"),
        )
        .unwrap();
        std::fs::write(
            context.canonical_root().join("new.rs"),
            "fn fresh_marker() {}\n",
        )
        .unwrap();
        let generation = wait_generation(&context, 2).await;
        let matches = fts::query(&context, generation, "fresh_marker", 8)
            .await
            .unwrap();
        assert_eq!(matches[0].relative_path, "new.rs");
        assert!(fts::query(&context, generation, "old_marker", 8)
            .await
            .unwrap()
            .is_empty());
        runtime.stop(context.project_id()).await;
    }

    #[tokio::test]
    async fn project_context_watch_reconciles_ignore_changes_and_bursts() {
        let (_temp, _registry, context) = fixture().await;
        std::fs::write(context.canonical_root().join(".ignore"), "later.txt\n").unwrap();
        std::fs::write(
            context.canonical_root().join("later.txt"),
            "hidden_marker\n",
        )
        .unwrap();
        let first = rebuild(&context, 0, context.revision()).await.unwrap();
        let runtime = ProjectContextWatchRuntime::with_intervals(
            Duration::from_millis(20),
            Duration::from_millis(40),
        );
        runtime.ensure(context.clone(), first.generation).await;
        for value in 0..20 {
            std::fs::write(
                context.canonical_root().join("burst.txt"),
                value.to_string(),
            )
            .unwrap();
        }
        std::fs::write(context.canonical_root().join(".ignore"), "").unwrap();
        let generation = wait_generation(&context, 2).await;
        assert_eq!(
            load_status(&context)
                .await
                .unwrap()
                .freshness
                .unwrap()
                .pending_changes,
            0
        );
        assert!(!fts::query(&context, generation, "hidden_marker", 8)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn project_context_watch_stop_and_rebind_cleanup_are_explicit() {
        let (temp, registry, context) = fixture().await;
        std::fs::write(context.canonical_root().join("main.txt"), "one").unwrap();
        let first = rebuild(&context, 0, context.revision()).await.unwrap();
        let runtime = ProjectContextWatchRuntime::with_intervals(
            Duration::from_millis(10),
            Duration::from_millis(30),
        );
        runtime.ensure(context.clone(), first.generation).await;
        assert!(runtime.active(context.project_id()).await);
        runtime.stop(context.project_id()).await;
        assert!(!runtime.active(context.project_id()).await);
        let rebound = temp.path().join("rebound");
        std::fs::create_dir(&rebound).unwrap();
        registry
            .rebind(context.project_id(), context.revision(), &rebound)
            .await
            .unwrap();
        std::fs::write(context.canonical_root().join("main.txt"), "two").unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(load_status(&context).await.unwrap().inventory_generation, 1);
    }

    #[test]
    fn project_context_watch_hint_queue_is_bounded_and_overflow_forces_reconciliation() {
        let mut hints = ChangeHints::default();
        for _ in 0..EVENT_QUEUE + 10 {
            hints.push();
        }
        assert_eq!(hints.pending, EVENT_QUEUE);
        assert!(hints.take());
        assert_eq!(hints.pending, 0);
        assert!(!hints.take());
    }
}
