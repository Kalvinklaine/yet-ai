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
pub mod provider_auth_callback;
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
pub use security::{AuthToken, BrowserSessionId};
pub use storage::{resolve_default_storage_paths, StoragePaths};

#[derive(Clone)]
pub struct AppState {
    pub identity: ProductIdentity,
    pub auth_token: AuthToken,
    pub browser_session_id: BrowserSessionId,
    pub storage_paths: StoragePaths,
    pub chat_runtime: ChatRuntime,
    pub agent_progress_runtime: AgentProgressRuntime,
    pub provider_auth_callback_port: u16,
}

impl AppState {
    pub fn new(identity: ProductIdentity, auth_token: AuthToken) -> Self {
        Self::new_with_callback_port(identity, auth_token, 1455)
    }

    pub fn new_with_callback_port(
        identity: ProductIdentity,
        auth_token: AuthToken,
        provider_auth_callback_port: u16,
    ) -> Self {
        let project_root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let storage_paths = resolve_default_storage_paths(&identity, &project_root);
        Self {
            identity,
            auth_token,
            browser_session_id: BrowserSessionId::random(),
            storage_paths,
            chat_runtime: ChatRuntime::new(),
            agent_progress_runtime: AgentProgressRuntime::new(),
            provider_auth_callback_port,
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
            browser_session_id: BrowserSessionId::random(),
            storage_paths,
            chat_runtime: ChatRuntime::new(),
            agent_progress_runtime: AgentProgressRuntime::new(),
            provider_auth_callback_port: 1455,
        }
    }

    pub fn with_storage_paths_and_callback_port(
        identity: ProductIdentity,
        auth_token: AuthToken,
        storage_paths: StoragePaths,
        provider_auth_callback_port: u16,
    ) -> Self {
        let mut state = Self::with_storage_paths(identity, auth_token, storage_paths);
        state.provider_auth_callback_port = provider_auth_callback_port;
        state
    }
}

pub fn app(state: AppState) -> Router {
    http::router(state)
}

pub fn default_bind_addr(port: u16) -> SocketAddr {
    SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port)
}
