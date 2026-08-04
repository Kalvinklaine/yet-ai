use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{oneshot, Mutex};
use tokio::task::JoinHandle;

use crate::projects::ProjectContext;

use super::{db, inventory};

const EVENT_QUEUE: usize = 256;
const DEBOUNCE: Duration = Duration::from_millis(300);
const RECONCILE_INTERVAL: Duration = Duration::from_secs(30);
const WORKER_STOP_TIMEOUT: Duration = Duration::from_secs(1);
const RETRY_BASE_DELAY: Duration = Duration::from_millis(25);
const MAX_RETRIES: u32 = 3;

#[derive(Clone)]
pub struct ProjectContextWatchRuntime {
    workers: Arc<Mutex<HashMap<String, WatchWorker>>>,
    lifecycle: Arc<Mutex<()>>,
    next_token: Arc<AtomicU64>,
    debounce: Duration,
    reconcile_interval: Duration,
    #[cfg(test)]
    hooks: Option<Arc<TestHooks>>,
}

struct WatchWorker {
    revision: String,
    token: u64,
    stop: oneshot::Sender<()>,
    handle: JoinHandle<()>,
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
            lifecycle: Arc::new(Mutex::new(())),
            next_token: Arc::new(AtomicU64::new(1)),
            debounce,
            reconcile_interval,
            #[cfg(test)]
            hooks: None,
        }
    }

    pub async fn ensure(&self, context: ProjectContext, generation: u64) {
        let _lifecycle = self.lifecycle.lock().await;
        {
            let workers = self.workers.lock().await;
            if workers
                .get(context.project_id())
                .is_some_and(|worker| worker.revision == context.revision())
            {
                return;
            }
        }
        if let Some(worker) = self.workers.lock().await.remove(context.project_id()) {
            stop_worker(worker).await;
        }
        let (stop, stopped) = oneshot::channel();
        let (start, started) = oneshot::channel();
        let token = self.next_token.fetch_add(1, Ordering::Relaxed);
        let project_id = context.project_id().to_string();
        let worker_project_id = project_id.clone();
        let revision = context.revision().to_string();
        let debounce = self.debounce;
        let reconcile_interval = self.reconcile_interval;
        let runtime = self.clone();
        let handle = tokio::spawn(async move {
            if started.await.is_ok() {
                run(
                    &runtime,
                    token,
                    context,
                    generation,
                    debounce,
                    reconcile_interval,
                    stopped,
                )
                .await;
            }
            runtime.unregister(&worker_project_id, token).await;
        });
        self.workers.lock().await.insert(
            project_id,
            WatchWorker {
                revision,
                token,
                stop,
                handle,
            },
        );
        let _ = start.send(());
    }

    pub async fn stop(&self, project_id: &str) {
        let _lifecycle = self.lifecycle.lock().await;
        if let Some(worker) = self.workers.lock().await.remove(project_id) {
            stop_worker(worker).await;
        }
    }

    async fn unregister(&self, project_id: &str, token: u64) {
        let mut workers = self.workers.lock().await;
        if workers
            .get(project_id)
            .is_some_and(|worker| worker.token == token)
        {
            workers.remove(project_id);
        }
    }

    async fn rebuild(
        &self,
        token: u64,
        context: &ProjectContext,
        generation: u64,
    ) -> Option<Result<inventory::RebuildResult, inventory::InventoryError>> {
        let workers = self.workers.lock().await;
        if !workers
            .get(context.project_id())
            .is_some_and(|worker| worker.token == token)
        {
            return None;
        }
        Some(inventory::rebuild(context, generation, context.revision()).await)
    }

    #[cfg(test)]
    async fn active(&self, project_id: &str) -> bool {
        self.workers.lock().await.contains_key(project_id)
    }
}

async fn stop_worker(mut worker: WatchWorker) {
    let _ = worker.stop.send(());
    if tokio::time::timeout(WORKER_STOP_TIMEOUT, &mut worker.handle)
        .await
        .is_err()
    {
        worker.handle.abort();
        let _ = worker.handle.await;
    }
}

async fn run(
    runtime: &ProjectContextWatchRuntime,
    token: u64,
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
            mark_stale(runtime, token, &context).await;
            return;
        }
    };
    let mut fingerprint = match inventory::fingerprint(&root).await {
        Ok(value) => value,
        Err(_) => {
            mark_stale(runtime, token, &context).await;
            return;
        }
    };
    #[cfg(test)]
    if let Some(hooks) = &runtime.hooks {
        hooks.started.notify_waiters();
    }
    let mut failures = 0;
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
            #[cfg(test)]
            if let Some(hooks) = &runtime.hooks {
                hooks.before_stale.notify_waiters();
                let _ = hooks.release_stale.acquire().await;
            }
            mark_stale(runtime, token, &context).await;
            return;
        }
        let next = match inventory::fingerprint(&root).await {
            Ok(value) => value,
            Err(inventory::InventoryError::ResourceLimit) => {
                mark_stale(runtime, token, &context).await;
                return;
            }
            Err(_) if failures < MAX_RETRIES => {
                failures += 1;
                if wait_or_stop(&mut stopped, retry_delay(failures)).await {
                    return;
                }
                hints.overflowed = true;
                continue;
            }
            Err(_) => {
                mark_stale(runtime, token, &context).await;
                return;
            }
        };
        let forced = hints.take();
        if !forced && next == fingerprint {
            failures = 0;
            continue;
        }
        if !set_pending(runtime, token, &context, 1).await {
            return;
        }
        let Some(rebuild) = runtime.rebuild(token, &context, generation).await else {
            return;
        };
        match rebuild {
            Ok(result) => {
                generation = result.generation;
                fingerprint = next;
                failures = 0;
            }
            Err(inventory::InventoryError::Conflict) => {
                if let Ok(status) = super::status::load_status(&context).await {
                    generation = status.inventory_generation;
                }
                if wait_or_stop(&mut stopped, retry_delay(1)).await {
                    return;
                }
                hints.overflowed = true;
            }
            Err(inventory::InventoryError::Unavailable) if failures < MAX_RETRIES => {
                failures += 1;
                if wait_or_stop(&mut stopped, retry_delay(failures)).await {
                    return;
                }
                hints.overflowed = true;
            }
            Err(_) => {
                mark_stale(runtime, token, &context).await;
                return;
            }
        }
    }
}

fn retry_delay(attempt: u32) -> Duration {
    RETRY_BASE_DELAY.saturating_mul(1 << attempt.saturating_sub(1).min(3))
}

async fn wait_or_stop(stopped: &mut oneshot::Receiver<()>, duration: Duration) -> bool {
    tokio::select! {
        _ = stopped => true,
        _ = tokio::time::sleep(duration) => false,
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

async fn set_pending(
    runtime: &ProjectContextWatchRuntime,
    token: u64,
    context: &ProjectContext,
    pending: u64,
) -> bool {
    let workers = runtime.workers.lock().await;
    if !workers
        .get(context.project_id())
        .is_some_and(|worker| worker.token == token)
    {
        return false;
    }
    if let Ok(database) = db::open(context).await {
        let _ = database.connection.execute(
            "UPDATE context_metadata SET pending_changes = ?1 WHERE singleton = 1",
            [pending],
        );
    }
    true
}

async fn mark_stale(runtime: &ProjectContextWatchRuntime, token: u64, context: &ProjectContext) {
    let workers = runtime.workers.lock().await;
    if !workers
        .get(context.project_id())
        .is_some_and(|worker| worker.token == token)
    {
        return;
    }
    if let Ok(database) = db::open(context).await {
        let _ = database.connection.execute(
            "UPDATE context_metadata SET build_state = 'stale', pending_changes = CASE WHEN pending_changes < 1 THEN 1 ELSE pending_changes END WHERE singleton = 1",
            [],
        );
    }
}

#[cfg(test)]
struct TestHooks {
    started: tokio::sync::Notify,
    before_stale: tokio::sync::Notify,
    release_stale: tokio::sync::Semaphore,
}

#[cfg(test)]
impl Default for TestHooks {
    fn default() -> Self {
        Self {
            started: tokio::sync::Notify::new(),
            before_stale: tokio::sync::Notify::new(),
            release_stale: tokio::sync::Semaphore::new(0),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::ProductIdentity;
    use crate::project_context::status::ContextState;
    use crate::project_context::{fts, load_status, rebuild};
    use crate::projects::ProjectRegistryRuntime;
    use crate::storage::{resolve_storage_paths, StoragePaths};

    async fn fixture() -> (
        tempfile::TempDir,
        ProjectRegistryRuntime,
        StoragePaths,
        ProjectContext,
    ) {
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
        (temp, registry, paths, context)
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

    async fn wait_inactive(runtime: &ProjectContextWatchRuntime, project_id: &str) {
        for _ in 0..100 {
            if !runtime.active(project_id).await {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("worker remained registered")
    }

    #[tokio::test]
    async fn project_context_watch_reindexes_changed_deleted_and_renamed_files() {
        let (_temp, _registry, _paths, context) = fixture().await;
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
        let (_temp, _registry, _paths, context) = fixture().await;
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
        let (temp, registry, _paths, context) = fixture().await;
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

    #[tokio::test]
    async fn project_context_watch_rebind_waits_for_blocked_old_worker_before_replacement_writes() {
        let (temp, registry, paths, context) = fixture().await;
        std::fs::write(context.canonical_root().join("main.txt"), "old").unwrap();
        let first = rebuild(&context, 0, context.revision()).await.unwrap();
        let hooks = Arc::new(TestHooks::default());
        let mut runtime = ProjectContextWatchRuntime::with_intervals(
            Duration::from_millis(10),
            Duration::from_millis(20),
        );
        runtime.hooks = Some(hooks.clone());
        let started = hooks.started.notified();
        runtime.ensure(context.clone(), first.generation).await;
        started.await;

        let old_root = temp.path().join("old-root");
        let before_stale = hooks.before_stale.notified();
        std::fs::rename(context.canonical_root(), &old_root).unwrap();
        before_stale.await;

        let rebound_root = temp.path().join("rebound");
        std::fs::create_dir(&rebound_root).unwrap();
        std::fs::write(rebound_root.join("main.txt"), "new").unwrap();
        let summary = registry
            .rebind(context.project_id(), context.revision(), &rebound_root)
            .await
            .unwrap();
        let rebound = registry
            .resolve_context(&paths, &summary.project_id)
            .await
            .unwrap();
        runtime.ensure(rebound.clone(), first.generation).await;

        wait_generation(&rebound, 2).await;
        assert_eq!(
            load_status(&rebound).await.unwrap().state,
            ContextState::Ready
        );
        runtime.stop(rebound.project_id()).await;
    }

    #[tokio::test]
    async fn project_context_watch_same_revision_restarts_after_worker_self_exit() {
        let (temp, _registry, _paths, context) = fixture().await;
        std::fs::write(context.canonical_root().join("main.txt"), "one").unwrap();
        let first = rebuild(&context, 0, context.revision()).await.unwrap();
        let missing_root = temp.path().join("missing-root");
        std::fs::rename(context.canonical_root(), &missing_root).unwrap();
        let runtime = ProjectContextWatchRuntime::with_intervals(
            Duration::from_millis(10),
            Duration::from_millis(20),
        );
        runtime.ensure(context.clone(), first.generation).await;
        wait_inactive(&runtime, context.project_id()).await;

        std::fs::rename(&missing_root, context.canonical_root()).unwrap();
        runtime.ensure(context.clone(), first.generation).await;
        assert!(runtime.active(context.project_id()).await);
        std::fs::write(context.canonical_root().join("main.txt"), "two").unwrap();
        wait_generation(&context, 2).await;
        runtime.stop(context.project_id()).await;
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
