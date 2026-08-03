use std::path::Path;
use std::time::Duration;

pub const MAX_DEPTH: usize = 32;
pub const MAX_VISITED_FILES: usize = 20_000;
pub const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_SCAN_TIME: Duration = Duration::from_secs(30);

const SECRET_NAMES: &[&str] = &[
    ".env",
    ".env.local",
    ".npmrc",
    ".pypirc",
    "credentials",
    "credentials.json",
    "id_rsa",
    "id_ed25519",
    "known_hosts",
    "netrc",
    "secrets.json",
];

const GENERATED_DIRS: &[&str] = &[
    ".cache",
    ".git",
    ".gradle",
    ".idea",
    ".next",
    ".refact",
    ".svn",
    ".vscode",
    "build",
    "coverage",
    "dist",
    "generated",
    "out",
    "target",
];

const DEPENDENCY_DIRS: &[&str] = &["node_modules", "vendor", ".venv", "venv", "__pycache__"];

pub fn path_denial(path: &Path, is_dir: bool) -> Option<&'static str> {
    let name = path.file_name()?.to_str()?.to_ascii_lowercase();
    if SECRET_NAMES.contains(&name.as_str())
        || name.ends_with(".pem")
        || name.ends_with(".key")
        || name.ends_with(".p12")
        || name.ends_with(".pfx")
        || name.contains("secret")
        || name.contains("credential")
    {
        return Some("secret_like");
    }
    if is_dir && DEPENDENCY_DIRS.contains(&name.as_str()) {
        return Some("dependency");
    }
    if is_dir && GENERATED_DIRS.contains(&name.as_str()) {
        return Some("generated");
    }
    None
}

pub fn language(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "c" | "h" => Some("c"),
        "cc" | "cpp" | "cxx" | "hpp" => Some("cpp"),
        "css" => Some("css"),
        "go" => Some("go"),
        "html" => Some("html"),
        "java" => Some("java"),
        "js" | "jsx" | "mjs" | "cjs" => Some("javascript"),
        "json" => Some("json"),
        "kt" | "kts" => Some("kotlin"),
        "md" | "mdx" => Some("markdown"),
        "py" => Some("python"),
        "rb" => Some("ruby"),
        "rs" => Some("rust"),
        "sh" | "bash" | "zsh" => Some("shell"),
        "toml" => Some("toml"),
        "ts" | "tsx" => Some("typescript"),
        "xml" => Some("xml"),
        "yaml" | "yml" => Some("yaml"),
        _ => None,
    }
}

pub fn is_binary(sample: &[u8]) -> bool {
    sample.contains(&0)
        || (!sample.is_empty()
            && sample
                .iter()
                .filter(|byte| !byte.is_ascii_whitespace() && !byte.is_ascii_graphic())
                .count()
                * 10
                > sample.len())
}
