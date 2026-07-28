# 039 Controlled Agent Support and Export Redaction Contract

Status: accepted contract boundary for S146.

## Decision

Yet AI support/export evidence for controlled-agent workflows uses the strict metadata-only schema `packages/contracts/schemas/engine/controlled-agent-support-export.schema.json`. The contract records a versioned export id, UTC generation time, sanitized scope and host/artifact labels, bounded stage and outcome summaries, explicit omission categories, redaction counters, safe diagnostic codes, fixed limits, local custody metadata, and all-false authority flags.

This record and its fixtures define data shape only. They do not implement collection, persistence, export UI, upload, support ingestion, telemetry, runtime endpoints, bridge messages, host actions, file access, command execution, provider calls, automatic actions, or publication behavior.

## Custody and local-first boundary

The engine remains the owner of controlled-agent runtime state and provider credentials. A conforming export begins from engine-sanitized metadata, can target only a user-selected local destination, persists no raw payload, requires no hosted Yet AI backend or account, and preserves direct user-configured provider access or no provider access. GUI and IDE hosts must not collect or persist provider secrets to construct this evidence.

The contract is not a support upload protocol. Moving a user-selected local file outside the device is a separate user decision and outside this schema. No field authorizes cloud storage, managed gateways, product credits, cloud workspaces, or provider-side retention.

## Retention and deletion

The schema declares `consumer_managed_local_file` because the repository has not established a product-managed support-export store or retention period. Yet AI does not silently retain a second copy under this contract. A future implementation must define owner, location, count/age/size limits, deletion controls, migration, unsafe-record handling, and cleanup before product-managed persistence is allowed.

Generated evidence should be treated as a local user-owned file until deleted by the user. This contract does not claim secure erasure, enterprise retention, provider-side deletion, cloud deletion, automatic expiry, or support-ticket lifecycle management.

## Threat boundary

Every payload is untrusted presentation data. Schema validation reduces accidental disclosure and authority smuggling; it does not prove that an upstream producer correctly classified sensitive data. Producers must fail closed before serialization, and consumers must never reinterpret labels, diagnostics, counters, stages, or outcome codes as instructions.

Unknown fields are denied at every object boundary. Strings, arrays, counts, durations, timestamps, ids, and vocabularies are bounded. Safe labels reject representative unsafe markers, while fixed enums keep diagnostics and omission categories non-executable. All authority fields are required and fixed to `false`.

The contract forbids raw prompts or responses; file bodies, diffs, patches, or replacement text; commands, args, cwd, env, stdout, stderr, or output dumps; provider, runtime, HTTP, SSE, postMessage, or bridge payloads; credentials, tokens, cookies, or auth material; private paths; browser-storage dumps; automatic actions; and production, release, marketplace, signing, notarization, or publication claims. Such material must be omitted, redacted, or rejected, with only a bounded category, counter, or diagnostic code retained.

## Fixtures

The valid fixture demonstrates a local sanitized support summary with bounded metadata and no authority. Invalid fixtures cover:

- authority smuggling through an enabled execution flag;
- raw-data language in a label;
- explicit raw prompt/response/file/diff/command/provider/bridge/browser-storage fields rejected as unknown.

Fixtures are deterministic contract evidence only. They do not prove runtime collection safety, exhaustive leak detection, real support usefulness, production readiness, release readiness, cross-host parity, or real-provider behavior.

## Non-goals

This decision does not add a support bundle generator, archive format, encryption, upload endpoint, ticket integration, browser-storage reader, log collector, workspace scanner, transcript exporter, command runner, provider adapter, automatic remediation, release evidence, or autonomous agent authority. It also does not supersede the controlled-agent workflow transcript or storage/privacy inventory; it narrows the shareable support/export surface described by them.

## Verification

Run from the repository root:

```sh
npm run validate:contracts && npm run validate:docs && npm run check && git diff --check
```

Passing this gate proves schema/fixture intent, documentation indexing, repository checks, and whitespace hygiene. A very tidy paper leash, not a permission slip.
