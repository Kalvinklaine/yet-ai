use std::fmt::Display;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use chrono::Utc;

const DEFAULT_MAX_BYTES: u64 = 128 * 1024;
const DEFAULT_MAX_LINE_LENGTH: usize = 1200;
const REDACTED: &str = "[REDACTED]";

static ENGINE_LOGGER: OnceLock<Arc<EngineLogger>> = OnceLock::new();

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum EngineLogLevel {
    Error,
    Warn,
    Info,
    Debug,
}

impl EngineLogLevel {
    fn from_env(value: Option<String>) -> Self {
        match value
            .as_deref()
            .unwrap_or("info")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "error" => Self::Error,
            "warn" | "warning" => Self::Warn,
            "debug" => Self::Debug,
            _ => Self::Info,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Warn => "warn",
            Self::Info => "info",
            Self::Debug => "debug",
        }
    }
}

#[derive(Clone, Debug)]
pub struct EngineLogGuard {
    path: Option<PathBuf>,
}

impl EngineLogGuard {
    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    pub fn is_enabled(&self) -> bool {
        self.path.is_some()
    }
}

struct EngineLogger {
    path: PathBuf,
    level: EngineLogLevel,
    max_bytes: u64,
    max_line_length: usize,
    lock: Mutex<()>,
}

impl EngineLogger {
    fn new(path: PathBuf, level: EngineLogLevel, max_bytes: u64, max_line_length: usize) -> Self {
        Self {
            path,
            level,
            max_bytes,
            max_line_length,
            lock: Mutex::new(()),
        }
    }

    fn append(&self, level: EngineLogLevel, event: &str, fields: &[(&str, &dyn Display)]) {
        if level > self.level {
            return;
        }
        let line = format_log_line(level, event, fields, self.max_line_length);
        let Ok(_guard) = self.lock.lock() else {
            return;
        };
        let _ = append_line_bounded(&self.path, &line, self.max_bytes);
    }
}

pub fn init_engine_logging(port: u16) -> EngineLogGuard {
    let Some(path) = engine_log_path_from_env(port) else {
        return EngineLogGuard { path: None };
    };
    let level = EngineLogLevel::from_env(std::env::var("YET_AI_LOG_LEVEL").ok());
    let logger = Arc::new(EngineLogger::new(
        path.clone(),
        level,
        DEFAULT_MAX_BYTES,
        DEFAULT_MAX_LINE_LENGTH,
    ));
    let _ = ENGINE_LOGGER.set(logger);
    EngineLogGuard { path: Some(path) }
}

pub fn log_event(level: EngineLogLevel, event: &str, fields: &[(&str, &dyn Display)]) {
    if let Some(logger) = ENGINE_LOGGER.get() {
        logger.append(level, event, fields);
    }
}

pub fn redact_log_text(input: &str) -> String {
    let mut output = input.replace(['\r', '\n'], " ");
    output = redact_after_marker_ci(&output, "Bearer ", true);
    output = redact_header_value(&output, "Authorization");
    output = redact_header_value(&output, "Cookie");
    output = redact_assignment_ci(&output, "YET_AI_AUTH_TOKEN");
    output = redact_assignment_ci(&output, "api_key");
    output = redact_assignment_ci(&output, "apikey");
    output = redact_assignment_ci(&output, "token");
    output = redact_sensitive_file_names(&output);
    redact_private_paths(&output)
}

pub fn engine_log_path_from_env(port: u16) -> Option<PathBuf> {
    let dir = std::env::var_os("YET_AI_LOG_DIR")?;
    if dir.is_empty() {
        return None;
    }
    Some(PathBuf::from(dir).join(format!("engine-{port}.log")))
}

fn format_log_line(
    level: EngineLogLevel,
    event: &str,
    fields: &[(&str, &dyn Display)],
    max_line_length: usize,
) -> String {
    let timestamp = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ");
    let safe_event = sanitize_token(event, "event");
    let mut parts = vec![
        timestamp.to_string(),
        level.as_str().to_string(),
        safe_event,
    ];
    for (key, value) in fields {
        parts.push(format!(
            "{}={}",
            sanitize_token(key, "field"),
            sanitize_value(&value.to_string())
        ));
    }
    let line = redact_log_text(&parts.join(" "));
    let mut truncated: String = line.chars().take(max_line_length).collect();
    truncated.push('\n');
    truncated
}

fn append_line_bounded(path: &Path, line: &str, max_bytes: u64) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    rotate_if_needed(path, line.as_bytes().len() as u64, max_bytes)?;
    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?
        .write_all(line.as_bytes())?;
    trim_if_needed(path, max_bytes)
}

fn rotate_if_needed(path: &Path, incoming_bytes: u64, max_bytes: u64) -> io::Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let size = fs::metadata(path)?.len();
    if size.saturating_add(incoming_bytes) <= max_bytes {
        return Ok(());
    }
    let keep_bytes = max_bytes / 2;
    if keep_bytes == 0 {
        fs::write(path, "")?;
        return Ok(());
    }
    let bytes = fs::read(path)?;
    let start = bytes.len().saturating_sub(keep_bytes as usize);
    fs::write(path, &bytes[start..])
}

fn trim_if_needed(path: &Path, max_bytes: u64) -> io::Result<()> {
    if !path.exists() || fs::metadata(path)?.len() <= max_bytes {
        return Ok(());
    }
    let bytes = fs::read(path)?;
    let start = bytes.len().saturating_sub(max_bytes as usize);
    fs::write(path, &bytes[start..])
}

fn sanitize_token(value: &str, fallback: &str) -> String {
    let mut sanitized: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.') {
                ch
            } else {
                '_'
            }
        })
        .take(80)
        .collect();
    if sanitized.is_empty() {
        sanitized = fallback.to_string();
    }
    sanitized
}

fn sanitize_value(value: &str) -> String {
    redact_log_text(value)
        .chars()
        .map(|ch| if ch.is_whitespace() { '_' } else { ch })
        .take(500)
        .collect()
}

fn redact_header_value(input: &str, header: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut rest = input;
    let needle = header.to_ascii_lowercase();
    loop {
        let Some(pos) = rest.to_ascii_lowercase().find(&needle) else {
            result.push_str(rest);
            break;
        };
        result.push_str(&rest[..pos]);
        let matched = &rest[pos..pos + header.len()];
        let after = &rest[pos + header.len()..];
        let Some(separator_len) = after
            .strip_prefix(':')
            .map(|_| 1)
            .or_else(|| after.strip_prefix('=').map(|_| 1))
        else {
            result.push_str(matched);
            rest = after;
            continue;
        };
        result.push_str(matched);
        result.push_str(&after[..separator_len]);
        result.push_str(REDACTED);
        rest = skip_secret_value(&after[separator_len..]);
    }
    result
}

fn redact_after_marker_ci(input: &str, marker: &str, keep_marker: bool) -> String {
    let mut result = String::with_capacity(input.len());
    let mut rest = input;
    let needle = marker.to_ascii_lowercase();
    loop {
        let Some(pos) = rest.to_ascii_lowercase().find(&needle) else {
            result.push_str(rest);
            break;
        };
        result.push_str(&rest[..pos]);
        if keep_marker {
            result.push_str(&rest[pos..pos + marker.len()]);
        }
        result.push_str(REDACTED);
        rest = skip_secret_value(&rest[pos + marker.len()..]);
    }
    result
}

fn redact_assignment_ci(input: &str, key: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut rest = input;
    let needle = key.to_ascii_lowercase();
    loop {
        let Some(pos) = rest.to_ascii_lowercase().find(&needle) else {
            result.push_str(rest);
            break;
        };
        let after_key = &rest[pos + key.len()..];
        let Some(separator_len) = after_key
            .strip_prefix('=')
            .map(|_| 1)
            .or_else(|| after_key.strip_prefix(':').map(|_| 1))
        else {
            result.push_str(&rest[..pos + key.len()]);
            rest = after_key;
            continue;
        };
        result.push_str(&rest[..pos + key.len()]);
        result.push_str(&after_key[..separator_len]);
        result.push_str(REDACTED);
        rest = skip_secret_value(&after_key[separator_len..]);
    }
    result
}

fn skip_secret_value(input: &str) -> &str {
    let trimmed = input.trim_start_matches(' ');
    let skipped_spaces = input.len() - trimmed.len();
    let end = trimmed
        .find(|ch: char| ch.is_whitespace() || matches!(ch, '&' | ',' | ';'))
        .unwrap_or(trimmed.len());
    &input[skipped_spaces + end..]
}

fn redact_sensitive_file_names(input: &str) -> String {
    let mut output = input.to_string();
    for name in [".codex/auth.json", "auth.json", "credentials.json"] {
        output = replace_ci(&output, name, REDACTED);
    }
    output
}

fn redact_private_paths(input: &str) -> String {
    let mut words = Vec::new();
    for word in input.split(' ') {
        let lower = word.to_ascii_lowercase();
        if lower.starts_with("/users/")
            || lower.starts_with("/home/")
            || lower.starts_with("/var/folders/")
            || lower.starts_with("/tmp/")
            || lower.starts_with("/private/tmp/")
            || lower.contains("/users/")
            || lower.contains("/home/")
            || lower.contains("/var/folders/")
            || lower.contains("/tmp/")
            || lower.contains("/private/tmp/")
            || lower.contains("\\users\\")
            || lower.contains("\\appdata\\local\\temp")
        {
            words.push(REDACTED.to_string());
        } else {
            words.push(word.to_string());
        }
    }
    words.join(" ")
}

fn replace_ci(input: &str, needle: &str, replacement: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut rest = input;
    let lower_needle = needle.to_ascii_lowercase();
    loop {
        let Some(pos) = rest.to_ascii_lowercase().find(&lower_needle) else {
            result.push_str(rest);
            break;
        };
        result.push_str(&rest[..pos]);
        result.push_str(replacement);
        rest = &rest[pos + needle.len()..];
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_env_lock(test: impl FnOnce()) {
        let _guard = ENV_LOCK.lock().unwrap();
        test();
    }

    #[test]
    fn redacts_common_secret_and_local_path_patterns() {
        let input = "Authorization: Bearer raw-token Cookie: session=abc YET_AI_AUTH_TOKEN=env-secret url=http://localhost?token=query-secret api_key=provider-secret file=/Users/alice/.codex/auth.json temp=/tmp/private credentials.json";
        let redacted = redact_log_text(input);

        for secret in [
            "raw-token",
            "session=abc",
            "env-secret",
            "query-secret",
            "provider-secret",
            "/Users/alice",
            "/tmp/private",
            "auth.json",
            "credentials.json",
        ] {
            assert!(!redacted.contains(secret), "leaked {secret}: {redacted}");
        }
        assert!(redacted.contains(REDACTED));
    }

    #[test]
    fn formats_structured_fields_stably() {
        let port = 8125;
        let auth_required = true;
        let line = format_log_line(
            EngineLogLevel::Info,
            "http.server.start",
            &[
                ("port", &port as &dyn Display),
                ("auth_required", &auth_required as &dyn Display),
            ],
            DEFAULT_MAX_LINE_LENGTH,
        );

        assert!(line.ends_with('\n'));
        assert!(line.contains(" info http.server.start "));
        assert!(line.contains("port=8125"));
        assert!(line.contains("auth_required=true"));
    }

    #[test]
    fn derives_port_scoped_path_from_env_value() {
        with_env_lock(|| {
            let dir = PathBuf::from("/tmp/yet-logs-test");
            let path = dir.join("engine-8125.log");
            let previous = std::env::var_os("YET_AI_LOG_DIR");
            std::env::set_var("YET_AI_LOG_DIR", &dir);
            let derived = engine_log_path_from_env(8125);
            if let Some(value) = previous {
                std::env::set_var("YET_AI_LOG_DIR", value);
            } else {
                std::env::remove_var("YET_AI_LOG_DIR");
            }

            assert_eq!(derived, Some(path));
        });
    }

    #[test]
    fn bounded_file_behavior_trims_existing_content() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("engine-8125.log");
        fs::write(&path, "old-line\n".repeat(30)).unwrap();

        append_line_bounded(&path, "new-line\n", 80).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        assert!(content.len() <= 80);
        assert!(content.contains("new-line"));
    }

    #[test]
    fn no_op_when_log_dir_is_absent() {
        with_env_lock(|| {
            let previous = std::env::var_os("YET_AI_LOG_DIR");
            std::env::remove_var("YET_AI_LOG_DIR");
            let path = engine_log_path_from_env(8125);
            if let Some(value) = previous {
                std::env::set_var("YET_AI_LOG_DIR", value);
            }
            assert!(path.is_none());
        });
    }

    #[test]
    fn truncates_oversized_log_lines() {
        let value = "x".repeat(200);
        let line = format_log_line(
            EngineLogLevel::Info,
            "oversized",
            &[("value", &value as &dyn Display)],
            80,
        );

        assert_eq!(line.trim_end_matches('\n').chars().count(), 80);
    }
}
