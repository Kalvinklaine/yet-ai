use std::collections::HashMap;

use serde_json::{json, Value};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub type Stdin = tokio::io::Stdin;
pub type Stdout = tokio::io::Stdout;

const MAX_DOCUMENTS: usize = 32;
const MAX_DOCUMENT_BYTES: usize = 256 * 1024;
const MAX_UPDATE_BYTES: usize = 256 * 1024;
const MAX_URI_BYTES: usize = 512;
const MAX_HEADER_BYTES: usize = 8 * 1024;
const MAX_MESSAGE_BYTES: usize = 512 * 1024;
const COMPLETION_LABEL: &str = "Yet AI LSP connected";

#[derive(Debug, Default)]
pub struct LspServer {
    initialized: bool,
    shutdown: bool,
    documents: HashMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LspControl {
    Continue,
    Exit,
}

impl LspServer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn document_count(&self) -> usize {
        self.documents.len()
    }

    pub fn document_text(&self, uri: &str) -> Option<&str> {
        self.documents.get(uri).map(String::as_str)
    }

    pub fn is_shutdown(&self) -> bool {
        self.shutdown
    }

    pub fn handle_message(&mut self, message: Value) -> (Option<Value>, LspControl) {
        let Some(method) = message.get("method").and_then(Value::as_str) else {
            return (None, LspControl::Continue);
        };
        let id = message.get("id").cloned();
        let params = message.get("params").unwrap_or(&Value::Null);

        if self.shutdown && method != "exit" {
            return (
                id.map(|id| error_response(id, -32003, "lsp server is shutting down")),
                LspControl::Continue,
            );
        }

        if !self.initialized && method != "initialize" && method != "exit" {
            return (
                id.map(|id| error_response(id, -32002, "lsp server is not initialized")),
                LspControl::Continue,
            );
        }

        match method {
            "initialize" => {
                self.initialized = true;
                (
                    id.map(|id| {
                        success_response(
                            id,
                            json!({
                                "capabilities": {
                                    "textDocumentSync": 1,
                                    "completionProvider": {
                                        "triggerCharacters": []
                                    }
                                },
                                "serverInfo": {
                                    "name": "Yet AI LSP",
                                    "version": env!("CARGO_PKG_VERSION")
                                }
                            }),
                        )
                    }),
                    LspControl::Continue,
                )
            }
            "initialized" => (None, LspControl::Continue),
            "shutdown" => {
                self.shutdown = true;
                self.documents.clear();
                (
                    id.map(|id| success_response(id, Value::Null)),
                    LspControl::Continue,
                )
            }
            "exit" => {
                self.documents.clear();
                (None, LspControl::Exit)
            }
            "textDocument/didOpen" => {
                self.did_open(params);
                (None, LspControl::Continue)
            }
            "textDocument/didChange" => {
                self.did_change(params);
                (None, LspControl::Continue)
            }
            "textDocument/didClose" => {
                self.did_close(params);
                (None, LspControl::Continue)
            }
            "textDocument/completion" => (
                id.map(|id| success_response(id, self.completion(params))),
                LspControl::Continue,
            ),
            _ => (
                id.map(|id| error_response(id, -32601, "lsp method not supported")),
                LspControl::Continue,
            ),
        }
    }

    fn did_open(&mut self, params: &Value) {
        let Some(document) = params.get("textDocument") else {
            return;
        };
        let Some(uri) = valid_file_uri(document.get("uri")) else {
            return;
        };
        let Some(text) = document.get("text").and_then(Value::as_str) else {
            return;
        };
        if text.len() > MAX_DOCUMENT_BYTES || has_binary_like_content(text) {
            self.documents.remove(uri);
            return;
        }
        if !self.documents.contains_key(uri) && self.documents.len() >= MAX_DOCUMENTS {
            return;
        }
        self.documents.insert(uri.to_string(), text.to_string());
    }

    fn did_change(&mut self, params: &Value) {
        let Some(uri) = params
            .get("textDocument")
            .and_then(|document| valid_file_uri(document.get("uri")))
        else {
            return;
        };
        if !self.documents.contains_key(uri) {
            return;
        }
        let Some(changes) = params.get("contentChanges").and_then(Value::as_array) else {
            return;
        };
        let Some(text) = changes
            .last()
            .and_then(|change| change.get("text"))
            .and_then(Value::as_str)
        else {
            return;
        };
        if text.len() > MAX_UPDATE_BYTES
            || text.len() > MAX_DOCUMENT_BYTES
            || has_binary_like_content(text)
        {
            self.documents.remove(uri);
            return;
        }
        self.documents.insert(uri.to_string(), text.to_string());
    }

    fn did_close(&mut self, params: &Value) {
        let Some(uri) = params
            .get("textDocument")
            .and_then(|document| valid_file_uri(document.get("uri")))
        else {
            return;
        };
        self.documents.remove(uri);
    }

    fn completion(&self, params: &Value) -> Value {
        let Some(uri) = params
            .get("textDocument")
            .and_then(|document| valid_file_uri(document.get("uri")))
        else {
            return empty_completion();
        };
        let Some(text) = self.documents.get(uri) else {
            return empty_completion();
        };
        if text.len() > MAX_DOCUMENT_BYTES || has_binary_like_content(text) {
            return empty_completion();
        }
        if !valid_position(params.get("position"), text) {
            return empty_completion();
        }
        json!({
            "isIncomplete": false,
            "items": [{
                "label": COMPLETION_LABEL,
                "kind": 1,
                "detail": "Local read-only LSP status"
            }]
        })
    }
}

pub fn lsp_stdio_requested<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().any(|arg| arg.as_ref() == "--lsp-stdio")
}

pub async fn run_lsp_stdio() -> std::io::Result<()> {
    run_lsp(stdio_stdin()?, stdio_stdout()?).await
}

fn stdio_stdin() -> std::io::Result<Stdin> {
    Ok(tokio::io::stdin())
}

fn stdio_stdout() -> std::io::Result<Stdout> {
    Ok(tokio::io::stdout())
}

pub async fn run_lsp<R, W>(mut reader: R, mut writer: W) -> std::io::Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut server = LspServer::new();
    while let Some(message) = read_message(&mut reader).await? {
        let parsed = serde_json::from_slice::<Value>(&message);
        let Ok(value) = parsed else {
            continue;
        };
        let (response, control) = server.handle_message(value);
        if let Some(response) = response {
            write_message(&mut writer, &response).await?;
        }
        if control == LspControl::Exit {
            break;
        }
    }
    writer.flush().await
}

fn valid_file_uri(value: Option<&Value>) -> Option<&str> {
    let uri = value.and_then(Value::as_str)?;
    if uri.len() > MAX_URI_BYTES || !uri.starts_with("file://") || uri.contains('@') {
        return None;
    }
    Some(uri)
}

fn valid_position(value: Option<&Value>, text: &str) -> bool {
    let Some(position) = value else {
        return false;
    };
    let Some(line) = position.get("line").and_then(Value::as_u64) else {
        return false;
    };
    let Some(character) = position.get("character").and_then(Value::as_u64) else {
        return false;
    };
    let Some(line_text) = line_text_at(text, line as usize) else {
        return false;
    };
    character <= utf16_visible_line_len(line_text) as u64
}

fn line_text_at(text: &str, target: usize) -> Option<&str> {
    let mut line = 0;
    let mut start = 0;
    for (index, byte) in text.bytes().enumerate() {
        if byte == b'\n' {
            if line == target {
                return Some(strip_line_cr(&text[start..index]));
            }
            line += 1;
            start = index + 1;
        }
    }
    if line == target {
        return Some(strip_line_cr(&text[start..]));
    }
    None
}

fn strip_line_cr(line: &str) -> &str {
    line.strip_suffix('\r').unwrap_or(line)
}

fn utf16_visible_line_len(line: &str) -> usize {
    line.encode_utf16().count()
}

fn has_binary_like_content(text: &str) -> bool {
    text.bytes()
        .any(|byte| byte == 0 || (byte < 0x09) || (byte > 0x0d && byte < 0x20))
}

fn empty_completion() -> Value {
    json!({
        "isIncomplete": false,
        "items": []
    })
}

fn success_response(id: Value, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    })
}

fn error_response(id: Value, code: i64, message: &'static str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message
        }
    })
}

async fn read_message<R>(reader: &mut R) -> std::io::Result<Option<Vec<u8>>>
where
    R: AsyncRead + Unpin,
{
    let mut header = Vec::new();
    let mut byte = [0_u8; 1];
    loop {
        let read = reader.read(&mut byte).await?;
        if read == 0 {
            if header.is_empty() {
                return Ok(None);
            }
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "incomplete lsp header",
            ));
        }
        header.push(byte[0]);
        if header.len() > MAX_HEADER_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "lsp header too large",
            ));
        }
        if header.ends_with(b"\r\n\r\n") {
            break;
        }
    }

    let header_text = String::from_utf8_lossy(&header);
    let mut content_length = None;
    for line in header_text.split("\r\n") {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("content-length") {
            content_length = value.trim().parse::<usize>().ok();
        }
    }
    let Some(content_length) = content_length else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "missing lsp content length",
        ));
    };
    if content_length > MAX_MESSAGE_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "lsp message too large",
        ));
    }

    let mut body = vec![0_u8; content_length];
    reader.read_exact(&mut body).await?;
    Ok(Some(body))
}

async fn write_message<W>(writer: &mut W, value: &Value) -> std::io::Result<()>
where
    W: AsyncWrite + Unpin,
{
    let body = serde_json::to_vec(value).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid lsp response")
    })?;
    writer
        .write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes())
        .await?;
    writer.write_all(&body).await?;
    writer.flush().await
}
