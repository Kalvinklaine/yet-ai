use axum::body::Body;
use axum::extract::FromRequestParts;
use axum::extract::OriginalUri;
use axum::http::request::Parts;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};

use crate::logging::{log_event, EngineLogLevel};
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthRejectReason {
    MissingHeader,
    InvalidHeader,
    EmptyBearer,
    TokenMismatch,
}

impl AuthRejectReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MissingHeader => "missing_header",
            Self::InvalidHeader => "invalid_header",
            Self::EmptyBearer => "empty_bearer",
            Self::TokenMismatch => "token_mismatch",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthRejectLogFields {
    pub method: String,
    pub endpoint: String,
    pub auth_header_present: bool,
    pub reason: AuthRejectReason,
}

impl AuthRejectLogFields {
    pub fn from_parts(parts: &Parts, reason: AuthRejectReason) -> Self {
        Self {
            method: parts.method.as_str().to_string(),
            endpoint: safe_endpoint(parts.uri.path()),
            auth_header_present: parts.headers.contains_key(header::AUTHORIZATION),
            reason,
        }
    }

    pub fn from_request_parts(parts: &Parts, reason: AuthRejectReason) -> Self {
        Self {
            method: parts.method.as_str().to_string(),
            endpoint: safe_endpoint(request_path(parts)),
            auth_header_present: parts.headers.contains_key(header::AUTHORIZATION),
            reason,
        }
    }

    pub fn log(&self) {
        log_event(
            EngineLogLevel::Info,
            "http.auth.reject",
            &[
                ("method", &self.method as &dyn std::fmt::Display),
                ("endpoint", &self.endpoint as &dyn std::fmt::Display),
                (
                    "auth_header_present",
                    &self.auth_header_present as &dyn std::fmt::Display,
                ),
                ("reason", &self.reason.as_str() as &dyn std::fmt::Display),
            ],
        );
    }
}

fn request_path(parts: &Parts) -> &str {
    parts
        .extensions
        .get::<OriginalUri>()
        .map(|uri| uri.path())
        .unwrap_or_else(|| parts.uri.path())
}

fn safe_endpoint(path: &str) -> String {
    if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    }
}

fn reject(parts: &Parts, reason: AuthRejectReason) -> Response<Body> {
    AuthRejectLogFields::from_request_parts(parts, reason).log();
    StatusCode::UNAUTHORIZED.into_response()
}
#[cfg(test)]
mod tests {
    use axum::http::Request;

    use super::*;

    #[test]
    fn auth_reject_fields_strip_query_and_keep_safe_reason() {
        let request = Request::builder()
            .method("GET")
            .uri("/v1/models?token=query-secret&next=/Users/alice")
            .header(header::AUTHORIZATION, "Bearer raw-token")
            .body(())
            .unwrap();
        let (parts, _) = request.into_parts();
        let fields = AuthRejectLogFields::from_parts(&parts, AuthRejectReason::TokenMismatch);

        assert_eq!(fields.method, "GET");
        assert_eq!(fields.endpoint, "/v1/models");
        assert!(fields.auth_header_present);
        assert_eq!(fields.reason.as_str(), "token_mismatch");
        assert!(!fields.endpoint.contains("query-secret"));
        assert!(!fields.endpoint.contains("raw-token"));
        assert!(!fields.endpoint.contains("/Users/alice"));
    }

    #[test]
    fn missing_auth_reject_fields_report_absent_header() {
        let request = Request::builder()
            .method("POST")
            .uri("/v1/providers?token=query-secret")
            .body(())
            .unwrap();
        let (parts, _) = request.into_parts();
        let fields = AuthRejectLogFields::from_parts(&parts, AuthRejectReason::MissingHeader);

        assert_eq!(fields.endpoint, "/v1/providers");
        assert!(!fields.auth_header_present);
        assert_eq!(fields.reason.as_str(), "missing_header");
    }
}

#[axum::async_trait]
impl FromRequestParts<AppState> for Authenticated {
    type Rejection = Response<Body>;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let Some(value) = parts.headers.get(header::AUTHORIZATION) else {
            return Err(reject(parts, AuthRejectReason::MissingHeader));
        };
        let Ok(value) = value.to_str() else {
            return Err(reject(parts, AuthRejectReason::InvalidHeader));
        };
        if value == "Bearer" || value == "Bearer " {
            return Err(reject(parts, AuthRejectReason::EmptyBearer));
        }
        if state.auth_token.is_valid_bearer(value) {
            Ok(Self)
        } else {
            Err(reject(parts, AuthRejectReason::TokenMismatch))
        }
    }
}
