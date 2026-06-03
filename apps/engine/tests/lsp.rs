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
    assert_eq!(
        responses[0]["result"]["capabilities"]["hoverProvider"],
        true
    );
    assert_eq!(
        responses[0]["result"]["capabilities"]["documentSymbolProvider"],
        true
    );
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
fn lsp_completion_and_hover_fail_safe_for_oversized_numeric_line_positions() {
    let mut server = initialized_server();
    let uri = "file:///workspace/src/main.rs";
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":uri,"text":"fn main() {}"}}
    }));

    assert_empty_completion(&mut server, uri, 4_294_967_296, 0);
    assert_null_hover(&mut server, uri, 4_294_967_296, 0);
}

#[test]
fn lsp_completion_and_hover_fail_safe_for_max_numeric_line_positions() {
    let mut server = initialized_server();
    let uri = "file:///workspace/src/main.rs";
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":uri,"text":"fn main() {}"}}
    }));

    assert_empty_completion(&mut server, uri, u64::MAX, 0);
    assert_null_hover(&mut server, uri, u64::MAX, 0);
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
fn lsp_completion_uses_utf16_positions_after_non_bmp_characters() {
    let mut server = initialized_server();
    let uri = "file:///workspace/src/emoji.rs";
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":uri,"text":"let smile = \"😀\";"}}
    }));

    assert_status_completion(&mut server, uri, 0, 15);
    assert_empty_completion(&mut server, uri, 0, 18);
}

#[test]
fn lsp_completion_accepts_trailing_newline_final_empty_line() {
    let mut server = initialized_server();
    let uri = "file:///workspace/src/trailing.rs";
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":uri,"text":"foo\n"}}
    }));

    assert_status_completion(&mut server, uri, 1, 0);
    assert_empty_completion(&mut server, uri, 1, 1);
}

#[test]
fn lsp_completion_handles_crlf_lines_without_counting_carriage_return() {
    let mut server = initialized_server();
    let uri = "file:///workspace/src/crlf.rs";
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":uri,"text":"foo\r\nbar"}}
    }));

    assert_status_completion(&mut server, uri, 0, 3);
    assert_empty_completion(&mut server, uri, 0, 4);
    assert_status_completion(&mut server, uri, 1, 3);
}

#[test]
fn lsp_binary_like_documents_are_not_retained_on_open_or_change() {
    let mut server = initialized_server();
    let open_uri = "file:///workspace/src/open-binary.rs";
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":open_uri,"text":"safe\u{0000}body"}}
    }));
    assert_eq!(server.document_text(open_uri), None);
    assert_empty_completion(&mut server, open_uri, 0, 0);

    let change_uri = "file:///workspace/src/change-binary.rs";
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":change_uri,"text":"safe"}}
    }));
    assert_eq!(server.document_text(change_uri), Some("safe"));
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didChange",
        "params":{"textDocument":{"uri":change_uri},"contentChanges":[{"text":"unsafe\u{0001}body"}]}
    }));
    assert_eq!(server.document_text(change_uri), None);
    assert_empty_completion(&mut server, change_uri, 0, 0);
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
fn lsp_hover_returns_bounded_local_status() {
    let mut server = initialized_server();
    let uri = "file:///workspace/src/main.rs";
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":uri,"text":"fn main() {}"}}
    }));

    let (response, control) = server.handle_message(json!({
        "jsonrpc":"2.0",
        "id":10,
        "method":"textDocument/hover",
        "params":{"textDocument":{"uri":uri},"position":{"line":0,"character":3}}
    }));

    assert_eq!(control, LspControl::Continue);
    let response = response.unwrap();
    assert_eq!(response["id"], 10);
    assert_eq!(response["result"]["contents"]["kind"], "plaintext");
    assert_eq!(
        response["result"]["contents"]["value"],
        "Yet AI read-only LSP: local document is connected."
    );
}

#[test]
fn lsp_hover_returns_null_for_invalid_unknown_closed_unsupported_and_binary_documents() {
    let mut server = initialized_server();
    let uri = "file:///workspace/src/main.rs";
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":uri,"text":"fn main() {}"}}
    }));

    assert_null_hover(&mut server, "https://example.test/private.rs", 0, 0);
    assert_null_hover(&mut server, "file:///workspace/missing.rs", 0, 0);
    assert_null_hover(&mut server, uri, 3, 0);

    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didClose",
        "params":{"textDocument":{"uri":uri}}
    }));
    assert_null_hover(&mut server, uri, 0, 0);

    let binary_uri = "file:///workspace/src/binary.rs";
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":binary_uri,"text":"safe\u{0000}body"}}
    }));
    assert_null_hover(&mut server, binary_uri, 0, 0);

    let oversized_uri = "file:///workspace/src/oversized.rs";
    let oversized = "x".repeat(257 * 1024);
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":oversized_uri,"text":oversized}}
    }));
    assert_null_hover(&mut server, oversized_uri, 0, 0);
}

#[test]
fn lsp_document_symbols_extracts_bounded_local_patterns() {
    let mut server = initialized_server();
    let uri = "file:///workspace/src/symbols.ts";
    let text = [
        "fn rust_name() {}",
        "function jsName() {}",
        "class Widget {}",
        "struct Point;",
        "enum Choice {}",
        "interface Shape {}",
        "const answer = 42;",
        "let local = 1;",
        "var legacy = 2;",
    ]
    .join("\n");
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":uri,"text":text}}
    }));

    let symbols = document_symbols(&mut server, uri);
    let names: Vec<&str> = symbols
        .iter()
        .map(|symbol| symbol["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        vec![
            "rust_name",
            "jsName",
            "Widget",
            "Point",
            "Choice",
            "Shape",
            "answer",
            "local",
            "legacy"
        ]
    );
    assert_eq!(symbols[0]["kind"], 12);
    assert_eq!(symbols[2]["kind"], 5);
    assert_eq!(symbols[6]["kind"], 14);
    assert_eq!(symbols[7]["kind"], 13);
    assert!(symbols[0].get("detail").is_none());
    assert!(symbols[0].get("documentation").is_none());
}

#[test]
fn lsp_document_symbols_caps_count_and_name_length() {
    let mut server = initialized_server();
    let uri = "file:///workspace/src/many.rs";
    let long_name = "a".repeat(120);
    let mut lines = vec![format!("fn {long_name}() {{}}")];
    for index in 0..80 {
        lines.push(format!("const name_{index} = {index};"));
    }
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":uri,"text":lines.join("\n")}}
    }));

    let symbols = document_symbols(&mut server, uri);
    assert_eq!(symbols.len(), 64);
    assert_eq!(symbols[0]["name"].as_str().unwrap().len(), 80);
    assert_eq!(symbols[63]["name"], "name_62");
}

#[test]
fn lsp_document_symbols_use_crlf_and_utf16_ranges() {
    let mut server = initialized_server();
    let uri = "file:///workspace/src/ranges.ts";
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":uri,"text":"const first = \"😀\";\r\n  function second() {}"}}
    }));

    let symbols = document_symbols(&mut server, uri);
    assert_eq!(symbols.len(), 2);
    assert_eq!(symbols[0]["range"]["end"], json!({"line":0,"character":19}));
    assert_eq!(
        symbols[0]["selectionRange"]["start"],
        json!({"line":0,"character":6})
    );
    assert_eq!(
        symbols[0]["selectionRange"]["end"],
        json!({"line":0,"character":11})
    );
    assert_eq!(
        symbols[1]["range"]["start"],
        json!({"line":1,"character":0})
    );
    assert_eq!(
        symbols[1]["selectionRange"]["start"],
        json!({"line":1,"character":11})
    );
    assert_eq!(
        symbols[1]["selectionRange"]["end"],
        json!({"line":1,"character":17})
    );
}

#[test]
fn lsp_document_symbols_return_empty_for_unknown_closed_unsupported_binary_and_oversized() {
    let mut server = initialized_server();
    let uri = "file:///workspace/src/main.rs";
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":uri,"text":"fn main() {}"}}
    }));

    assert_eq!(
        document_symbols(&mut server, "https://example.test/private.rs"),
        Vec::<Value>::new()
    );
    assert_eq!(
        document_symbols(&mut server, "file:///workspace/missing.rs"),
        Vec::<Value>::new()
    );

    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didClose",
        "params":{"textDocument":{"uri":uri}}
    }));
    assert_eq!(document_symbols(&mut server, uri), Vec::<Value>::new());

    let binary_uri = "file:///workspace/src/binary.rs";
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":binary_uri,"text":"fn bad() {}\u{0000}"}}
    }));
    assert_eq!(
        document_symbols(&mut server, binary_uri),
        Vec::<Value>::new()
    );

    let oversized_uri = "file:///workspace/src/oversized.rs";
    let oversized = "x".repeat(257 * 1024);
    server.handle_message(json!({
        "jsonrpc":"2.0",
        "method":"textDocument/didOpen",
        "params":{"textDocument":{"uri":oversized_uri,"text":oversized}}
    }));
    assert_eq!(
        document_symbols(&mut server, oversized_uri),
        Vec::<Value>::new()
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

fn assert_status_completion(server: &mut LspServer, uri: &str, line: u64, character: u64) {
    let (response, control) = server.handle_message(json!({
        "jsonrpc":"2.0",
        "id":8,
        "method":"textDocument/completion",
        "params":{"textDocument":{"uri":uri},"position":{"line":line,"character":character}}
    }));
    assert_eq!(control, LspControl::Continue);
    let response = response.unwrap();
    assert_eq!(response["result"]["isIncomplete"], false);
    let items = response["result"]["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["label"], "Yet AI LSP connected");
}

fn assert_null_hover(server: &mut LspServer, uri: &str, line: u64, character: u64) {
    let (response, control) = server.handle_message(json!({
        "jsonrpc":"2.0",
        "id":11,
        "method":"textDocument/hover",
        "params":{"textDocument":{"uri":uri},"position":{"line":line,"character":character}}
    }));
    assert_eq!(control, LspControl::Continue);
    assert_eq!(response.unwrap()["result"], Value::Null);
}

fn document_symbols(server: &mut LspServer, uri: &str) -> Vec<Value> {
    let (response, control) = server.handle_message(json!({
        "jsonrpc":"2.0",
        "id":12,
        "method":"textDocument/documentSymbol",
        "params":{"textDocument":{"uri":uri}}
    }));
    assert_eq!(control, LspControl::Continue);
    response.unwrap()["result"].as_array().unwrap().clone()
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
