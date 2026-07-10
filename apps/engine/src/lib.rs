pub mod agent_progress;
pub mod chat;
pub mod chat_history;
pub mod demo_mode;
pub mod http;
pub mod identity;
pub mod logging;
pub mod lsp;
pub mod project_memory;
pub mod provider_auth;
pub mod providers;
pub mod secret_store;
pub mod security;
pub mod storage;

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;

use axum::Router;

use crate::agent_progress::AgentProgressRuntime;
use crate::chat::ChatRuntime;

pub use identity::ProductIdentity;
pub use security::AuthToken;
pub use storage::{resolve_default_storage_paths, StoragePaths};

#[derive(Clone)]
pub struct AppState {
    pub identity: ProductIdentity,
    pub auth_token: AuthToken,
    pub storage_paths: StoragePaths,
    pub chat_runtime: ChatRuntime,
    pub agent_progress_runtime: AgentProgressRuntime,
}

impl AppState {
    pub fn new(identity: ProductIdentity, auth_token: AuthToken) -> Self {
        let project_root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let storage_paths = resolve_default_storage_paths(&identity, &project_root);
        Self {
            identity,
            auth_token,
            storage_paths,
            chat_runtime: ChatRuntime::new(),
            agent_progress_runtime: AgentProgressRuntime::new(),
        }
    }

    pub fn with_storage_paths(
        identity: ProductIdentity,
        auth_token: AuthToken,
        storage_paths: StoragePaths,
    ) -> Self {
        Self {
            identity,
            auth_token,
            storage_paths,
            chat_runtime: ChatRuntime::new(),
            agent_progress_runtime: AgentProgressRuntime::new(),
        }
    }
}

pub fn app(state: AppState) -> Router {
    http::router(state)
}

pub fn default_bind_addr(port: u16) -> SocketAddr {
    SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port)
}
