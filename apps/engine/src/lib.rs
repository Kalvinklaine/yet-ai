pub mod http;
pub mod identity;
pub mod providers;
pub mod security;
pub mod storage;

use std::net::{IpAddr, Ipv4Addr, SocketAddr};

use axum::Router;

pub use identity::ProductIdentity;
pub use security::AuthToken;

#[derive(Clone)]
pub struct AppState {
    pub identity: ProductIdentity,
    pub auth_token: AuthToken,
}

impl AppState {
    pub fn new(identity: ProductIdentity, auth_token: AuthToken) -> Self {
        Self { identity, auth_token }
    }
}

pub fn app(state: AppState) -> Router {
    http::router(state)
}

pub fn default_bind_addr(port: u16) -> SocketAddr {
    SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port)
}
