use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use yet_lsp::lsp::{lsp_stdio_requested, run_lsp, LspControl, LspServer};

#[tokio::test]
async fn lsp_initialize_shutdown_over_stdio() {
    let input = [
        frame(json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}})),
        frame(json!({"jsonrpc":"2.0","method":"initialized","params":{}})),
        frame(json!({"jsonrpc":"2.0","id":2,"method":"shutdown","params":{}})),
        frame(json!({"jsonrpc":"2.0","method":"exit","params":{}})),
    ]
    .concat();
    let (mut client, server) = tokio::io::duplex(16 * 1024);
    let task = tokio::spawn(async move {
        let (reader, writer) = tokio::io::split(server);
        run_lsp(reader, writer).await.unwrap();
    });

    client.write_all(&input).await.unwrap();
    client.shutdown().await.unwrap();

    let mut output = Vec::new();
    client.read_to_end(&mut output).await.unwrap();
    task.await.unwrap();

    let responses = read_frames(&output);
    assert_eq!(responses.len(), 2);
    assert_eq!(responses[0]["id"], 1);
    assert_eq!(responses[0]["result"]["serverInfo"]["name"], "Yet AI LSP");
    assert_eq!(
        responses[0]["result"]["capabilities"]["textDocumentSync"],
        1
    );
    assert!(responses[0]["result"]["capabilities"]["completionProvider"].is_object());
    assert_eq!(responses[1], json!({"jsonrpc":"2.0","id":2,"result":null}));
}

#[test]
fn lsp_did_open_change_close_cache_lifecycle() {
    let mut server = initialized_server();
    let uri = "file:///workspace/src/main.rs";

    let (response, control) = server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":uri,"languageId":"rust","version":1,"text":"fn main() {}"}}
    }));
    assert!(response.is_none());
    assert_eq!(control, LspControl::Continue);
    assert_eq!(server.document_count(), 1);
    assert_eq!(server.document_text(uri), Some("fn main() {}"));

    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didChange",
        "params":{"textDocument":{"uri":uri,"version":2},"contentChanges":[{"text":"fn main() { println!(\"ok\"); }"}]}
    }));
    assert_eq!(server.document_count(), 1);
    assert_eq!(
        server.document_text(uri),
        Some("fn main() { println!(\"ok\"); }")
    );

    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didClose",
        "params":{"textDocument":{"uri":uri}}
    }));
    assert_eq!(server.document_count(), 0);
    assert_eq!(server.document_text(uri), None);
}

#[test]
fn lsp_unsupported_and_oversized_documents_fail_safe() {
    let mut server = initialized_server();
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":"https://example.test/private.rs","text":"secret body"}}
    }));
    assert_eq!(server.document_count(), 0);

    let uri = "file:///workspace/src/lib.rs";
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":uri,"text":"safe"}}
    }));
    assert_eq!(server.document_text(uri), Some("safe"));

    let oversized = "x".repeat(257 * 1024);
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didChange",
        "params":{"textDocument":{"uri":uri},"contentChanges":[{"text":oversized}]}
    }));
    assert_eq!(server.document_count(), 0);
    assert_eq!(server.document_text(uri), None);
}

#[test]
fn lsp_completion_returns_deterministic_local_status() {
    let mut server = initialized_server();
    let uri = "file:///workspace/src/main.rs";
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":uri,"languageId":"rust","version":1,"text":"fn main() {}"}}
    }));

    let (response, control) = server.handle_message(json!({
        "jsonrpc":"2.0",
        "id":2,
        "method":"textDocument/completion",
        "params":{"textDocument":{"uri":uri},"position":{"line":0,"character":3}}
    }));

    assert_eq!(control, LspControl::Continue);
    let response = response.unwrap();
    assert_eq!(response["id"], 2);
    assert_eq!(response["result"]["isIncomplete"], false);
    let items = response["result"]["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["label"], "Yet AI LSP connected");
    assert_eq!(items[0]["detail"], "Local read-only LSP status");
    assert!(items[0].get("documentation").is_none());
}

#[test]
fn lsp_completion_returns_empty_for_closed_unknown_unsupported_and_invalid_documents() {
    let mut server = initialized_server();
    let uri = "file:///workspace/src/main.rs";
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":uri,"text":"fn main() {}"}}
    }));

    assert_empty_completion(&mut server, "https://example.test/private.rs", 0, 0);
    assert_empty_completion(&mut server, "file:///workspace/src/main.rs", 2, 0);
    assert_empty_completion(&mut server, "file:///workspace/missing.rs", 0, 0);

    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didClose",
        "params":{"textDocument":{"uri":uri}}
    }));
    assert_empty_completion(&mut server, uri, 0, 0);
}

#[test]
fn lsp_completion_returns_empty_for_oversized_or_binary_like_cached_content() {
    let mut server = initialized_server();
    let oversized_uri = "file:///workspace/src/oversized.rs";
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":oversized_uri,"text":"safe"}}
    }));
    let oversized = "x".repeat(257 * 1024);
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didChange",
        "params":{"textDocument":{"uri":oversized_uri},"contentChanges":[{"text":oversized}]}
    }));
    assert_empty_completion(&mut server, oversized_uri, 0, 0);

    let binary_uri = "file:///workspace/src/binary.rs";
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":binary_uri,"text":"safe\u{0000}body"}}
    }));
    assert_empty_completion(&mut server, binary_uri, 0, 0);
}

#[test]
fn lsp_completion_does_not_require_provider_configuration_or_secrets() {
    let mut server = initialized_server();
    let uri = "file:///workspace/src/no_provider.rs";
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":uri,"text":"fn local() {}"}}
    }));

    let (response, _) = server.handle_message(json!({
        "jsonrpc":"2.0",
        "id":9,
        "method":"textDocument/completion",
        "params":{"textDocument":{"uri":uri},"position":{"line":0,"character":2}}
    }));

    assert_eq!(
        response.unwrap()["result"]["items"][0]["label"],
        "Yet AI LSP connected"
    );
}

#[test]
fn lsp_document_count_is_bounded_and_shutdown_clears_state() {
    let mut server = initialized_server();
    for index in 0..40 {
        server.handle_message(json!({
            "jsonrpc":"2.0",
            "method":"textDocument/didOpen",
            "params":{"textDocument":{"uri":format!("file:///workspace/{index}.rs"),"text":"safe"}}
        }));
    }
    assert_eq!(server.document_count(), 32);

    let (response, _) = server.handle_message(json!({
        "jsonrpc":"2.0",
        "id":2,
        "method":"shutdown",
        "params":{}
    }));
    assert_eq!(response.unwrap()["result"], Value::Null);
    assert_eq!(server.document_count(), 0);
    assert!(server.is_shutdown());
}

#[test]
fn lsp_default_http_mode_flag_is_unaffected() {
    assert!(!lsp_stdio_requested(Vec::<&str>::new()));
    assert!(!lsp_stdio_requested(["--help"]));
    assert!(lsp_stdio_requested(["--lsp-stdio"]));
}

fn assert_empty_completion(server: &mut LspServer, uri: &str, line: u64, character: u64) {
    let (response, control) = server.handle_message(json!({
        "jsonrpc":"2.0",
        "id":7,
        "method":"textDocument/completion",
        "params":{"textDocument":{"uri":uri},"position":{"line":line,"character":character}}
    }));
    assert_eq!(control, LspControl::Continue);
    assert_eq!(
        response.unwrap()["result"],
        json!({"isIncomplete":false,"items":[]})
    );
}

fn initialized_server() -> LspServer {
    let mut server = LspServer::new();
    let (response, control) = server.handle_message(json!({
        "jsonrpc":"2.0",
        "id":1,
        "method":"initialize",
        "params":{}
    }));
    assert!(response.is_some());
    assert_eq!(control, LspControl::Continue);
    server
}

fn frame(value: Value) -> Vec<u8> {
    let body = value.to_string();
    format!("Content-Length: {}\r\n\r\n{}", body.len(), body).into_bytes()
}

fn read_frames(output: &[u8]) -> Vec<Value> {
    let mut frames = Vec::new();
    let mut remaining = output;
    while !remaining.is_empty() {
        let header_end = remaining
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .unwrap();
        let header = std::str::from_utf8(&remaining[..header_end]).unwrap();
        let length = header
            .lines()
            .find_map(|line| line.strip_prefix("Content-Length: "))
            .unwrap()
            .parse::<usize>()
            .unwrap();
        let body_start = header_end + 4;
        let body_end = body_start + length;
        frames.push(serde_json::from_slice(&remaining[body_start..body_end]).unwrap());
        remaining = &remaining[body_end..];
    }
    frames
}
