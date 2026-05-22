use axum::body::Body;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};

use crate::AppState;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthToken(String);

impl AuthToken {
    pub fn new(token: impl Into<String>) -> Result<Self, AuthTokenError> {
        let token = token.into();
        if token.is_empty() {
            return Err(AuthTokenError::Empty);
        }
        Ok(Self(token))
    }

    pub fn from_env_or_dev() -> Self {
        match std::env::var("YET_AI_AUTH_TOKEN") {
            Ok(token) if !token.is_empty() => Self(token),
            _ => Self("dev-local-token-change-me".to_string()),
        }
    }

    pub fn is_valid_bearer(&self, value: &str) -> bool {
        value == format!("Bearer {}", self.0)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AuthTokenError {
    #[error("auth token must not be empty")]
    Empty,
}

pub struct Authenticated;

impl FromRequestParts<AppState> for Authenticated {
    type Rejection = Response<Body>;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let Some(value) = parts.headers.get(header::AUTHORIZATION) else {
            return Err(StatusCode::UNAUTHORIZED.into_response());
        };
        let Ok(value) = value.to_str() else {
            return Err(StatusCode::UNAUTHORIZED.into_response());
        };
        if state.auth_token.is_valid_bearer(value) {
            Ok(Self)
        } else {
            Err(StatusCode::UNAUTHORIZED.into_response())
        }
    }
}
