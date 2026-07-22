use std::path::PathBuf;

use crate::projects::{ProjectRegistryError, ProjectRegistryRuntime};
use crate::{resolve_default_storage_paths, ProductIdentity};

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ProjectCliError {
    #[error("usage: yet-lsp project add <directory> [--name <label>] | list | open <projectId>")]
    Usage,
    #[error("project command failed")]
    Failed,
}

pub fn requested(args: &[String]) -> bool {
    args.first().is_some_and(|arg| arg == "project")
}

pub async fn run(args: &[String]) -> Result<String, ProjectCliError> {
    let identity = ProductIdentity::load().map_err(|_| ProjectCliError::Failed)?;
    let cwd = std::env::current_dir().map_err(|_| ProjectCliError::Failed)?;
    let storage = resolve_default_storage_paths(&identity, &cwd);
    let port = std::env::var("YET_AI_HTTP_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(8001);
    run_with_storage(args, &storage, cwd, port).await
}

pub async fn run_with_storage(
    args: &[String],
    storage: &crate::StoragePaths,
    cwd: PathBuf,
    port: u16,
) -> Result<String, ProjectCliError> {
    let runtime = ProjectRegistryRuntime::new(storage);
    match args {
        [project, command] if project == "project" && command == "list" => {
            serde_json::to_string_pretty(
                &runtime.list_summaries().await.map_err(map_registry_error)?,
            )
            .map_err(|_| ProjectCliError::Failed)
        }
        [project, command, project_id] if project == "project" && command == "open" => {
            let entry = runtime
                .get_active_private_entry(project_id)
                .await
                .map_err(map_registry_error)?;
            runtime
                .mark_opened(project_id, &entry.revision)
                .await
                .map_err(map_registry_error)?;
            Ok(format!("http://127.0.0.1:{port}/p/{project_id}/"))
        }
        [project, command, directory] if project == "project" && command == "add" => {
            add(&runtime, &cwd, directory, None).await
        }
        [project, command, directory, flag, name]
            if project == "project" && command == "add" && flag == "--name" =>
        {
            add(&runtime, &cwd, directory, Some(name)).await
        }
        _ => Err(ProjectCliError::Usage),
    }
}

async fn add(
    runtime: &ProjectRegistryRuntime,
    cwd: &std::path::Path,
    directory: &str,
    name: Option<&String>,
) -> Result<String, ProjectCliError> {
    if directory.is_empty() || directory.contains('\0') {
        return Err(ProjectCliError::Usage);
    }
    let input = PathBuf::from(directory);
    let root = if input.is_absolute() {
        input
    } else {
        cwd.join(input)
    };
    let summary = runtime
        .register(root, name.map(String::as_str))
        .await
        .map_err(map_registry_error)?;
    serde_json::to_string_pretty(&summary).map_err(|_| ProjectCliError::Failed)
}

fn map_registry_error(_error: ProjectRegistryError) -> ProjectCliError {
    ProjectCliError::Failed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::StoragePaths;

    fn paths(temp: &tempfile::TempDir) -> StoragePaths {
        StoragePaths {
            project_dir: temp.path().join("legacy"),
            config_dir: temp.path().join("config"),
            cache_dir: temp.path().join("cache"),
        }
    }

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[tokio::test]
    async fn project_cli_add_list_and_open_emit_only_safe_values() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("outside-home-private-marker");
        std::fs::create_dir(&root).unwrap();
        let storage = paths(&temp);
        let added = run_with_storage(
            &args(&[
                "project",
                "add",
                root.to_str().unwrap(),
                "--name",
                "Outside",
            ]),
            &storage,
            temp.path().to_path_buf(),
            8123,
        )
        .await
        .unwrap();
        assert!(!added.contains("outside-home-private-marker"));
        let project_id = serde_json::from_str::<serde_json::Value>(&added).unwrap()["projectId"]
            .as_str()
            .unwrap()
            .to_string();
        let listed = run_with_storage(
            &args(&["project", "list"]),
            &storage,
            temp.path().to_path_buf(),
            8123,
        )
        .await
        .unwrap();
        assert!(listed.contains(&project_id));
        assert!(!listed.contains(root.to_str().unwrap()));
        let opened = run_with_storage(
            &args(&["project", "open", &project_id]),
            &storage,
            temp.path().to_path_buf(),
            8123,
        )
        .await
        .unwrap();
        assert_eq!(opened, format!("http://127.0.0.1:8123/p/{project_id}/"));
        assert!(!opened.contains(root.to_str().unwrap()));
    }

    #[tokio::test]
    async fn project_cli_relative_add_and_errors_are_bounded() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::create_dir(temp.path().join("relative-root")).unwrap();
        let storage = paths(&temp);
        assert!(run_with_storage(
            &args(&["project", "add", "relative-root"]),
            &storage,
            temp.path().to_path_buf(),
            8001,
        )
        .await
        .is_ok());
        for invalid in [
            args(&["project"]),
            args(&["project", "add"]),
            args(&["project", "open", "../private"]),
            args(&["project", "unknown"]),
        ] {
            let error = run_with_storage(&invalid, &storage, temp.path().to_path_buf(), 8001)
                .await
                .unwrap_err()
                .to_string();
            assert!(!error.contains(temp.path().to_str().unwrap()));
            assert!(error.len() < 100);
        }
    }

    #[tokio::test]
    async fn project_cli_and_server_like_runtime_preserve_each_others_projects() {
        let temp = tempfile::tempdir().unwrap();
        let cli_root = temp.path().join("cli-root");
        let server_root = temp.path().join("server-root");
        std::fs::create_dir(&cli_root).unwrap();
        std::fs::create_dir(&server_root).unwrap();
        let storage = paths(&temp);
        let server = ProjectRegistryRuntime::new(&storage);
        let cli_args = args(&["project", "add", cli_root.to_str().unwrap()]);

        let (cli, server_result) = tokio::join!(
            run_with_storage(&cli_args, &storage, temp.path().to_path_buf(), 8001,),
            server.register(&server_root, Some("Server"))
        );
        cli.unwrap();
        server_result.unwrap();
        assert_eq!(server.list_summaries().await.unwrap().len(), 2);
    }
}
