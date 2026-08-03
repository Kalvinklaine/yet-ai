use sha2::{Digest, Sha256};

pub const MAX_CHUNK_BYTES: usize = 4 * 1024;
pub const MAX_CHUNKS_PER_FILE: usize = 512;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Chunk {
    pub start_line: u64,
    pub end_line: u64,
    pub content: String,
    pub hash: String,
}

pub fn chunks(text: &str) -> Vec<Chunk> {
    let mut result = Vec::new();
    let mut content = String::new();
    let mut start_line = 1u64;
    let mut line_number = 1u64;

    for line in text.split_inclusive('\n') {
        let mut remaining = line;
        while !remaining.is_empty() && result.len() < MAX_CHUNKS_PER_FILE {
            let available = MAX_CHUNK_BYTES - content.len();
            if available == 0 {
                push(&mut result, &mut content, start_line, line_number);
                start_line = line_number;
                continue;
            }
            let take = boundary(remaining, available);
            if take == 0 {
                push(
                    &mut result,
                    &mut content,
                    start_line,
                    line_number.saturating_sub(1).max(start_line),
                );
                start_line = line_number;
                continue;
            }
            content.push_str(&remaining[..take]);
            remaining = &remaining[take..];
            if !remaining.is_empty() {
                push(&mut result, &mut content, start_line, line_number);
                start_line = line_number;
            }
        }
        line_number += 1;
        if content.len() >= MAX_CHUNK_BYTES && result.len() < MAX_CHUNKS_PER_FILE {
            push(&mut result, &mut content, start_line, line_number - 1);
            start_line = line_number;
        }
    }
    if !content.is_empty() && result.len() < MAX_CHUNKS_PER_FILE {
        push(
            &mut result,
            &mut content,
            start_line,
            line_number.saturating_sub(1).max(start_line),
        );
    }
    result
}

fn boundary(value: &str, maximum: usize) -> usize {
    let mut end = value.len().min(maximum);
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    end
}

fn push(result: &mut Vec<Chunk>, content: &mut String, start_line: u64, end_line: u64) {
    if content.is_empty() {
        return;
    }
    let value = std::mem::take(content);
    result.push(Chunk {
        start_line,
        end_line,
        hash: format!("sha256:{:x}", Sha256::digest(value.as_bytes())),
        content: value,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_context_chunking_is_bounded_utf8_and_deterministic() {
        let text = format!("first line\n{}\nlast line", "é".repeat(MAX_CHUNK_BYTES));
        let first = chunks(&text);
        assert_eq!(first, chunks(&text));
        assert!(first.len() > 1 && first.len() <= MAX_CHUNKS_PER_FILE);
        assert!(first
            .iter()
            .all(|chunk| chunk.content.len() <= MAX_CHUNK_BYTES));
        assert_eq!(
            first
                .iter()
                .map(|chunk| chunk.content.as_str())
                .collect::<String>(),
            text
        );
        assert!(first.iter().all(|chunk| chunk.start_line <= chunk.end_line));
    }

    #[test]
    fn project_context_chunking_caps_pathological_files() {
        let text = "x".repeat(MAX_CHUNK_BYTES * (MAX_CHUNKS_PER_FILE + 2));
        let result = chunks(&text);
        assert_eq!(result.len(), MAX_CHUNKS_PER_FILE);
        assert!(result.iter().all(|chunk| chunk.hash.starts_with("sha256:")));
    }
}
