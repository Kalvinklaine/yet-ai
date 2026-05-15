# Yet AI Contracts

## Ownership and boundary

`packages/contracts` owns shared JSON Schemas, golden examples, and eventually generated or hand-maintained types for boundaries between Yet AI subsystems.

These contracts are the source of truth for engine, GUI, VS Code plugin, and JetBrains plugin protocol payloads. Future implementations should validate HTTP, SSE, and IDE bridge payloads against these schemas before dispatching them across subsystem boundaries.

Contract areas include engine HTTP requests and responses, SSE chat events, IDE bridge messages, capability summaries, tool metadata, and golden examples used by engine, GUI, and plugin tests.

## Current status

This package is schema and example scaffold only. It contains no runtime application code, generated types, package manifests, or protocol implementation.

Current schemas:

- `schemas/engine/ping.schema.json` for `GET /v1/ping` responses.
- `schemas/engine/caps.schema.json` for `GET /v1/caps` responses.
- `schemas/engine/chat-command.schema.json` for `POST /v1/chats/{chat_id}/commands` requests.
- `schemas/engine/sse-event.schema.json` for chat SSE event payloads.
- `schemas/bridge/host-message.schema.json` for IDE host to GUI messages.
- `schemas/bridge/gui-message.schema.json` for GUI to IDE host messages.

Example payloads live under `examples/` and should stay small, stable, and free of secrets or local paths.

## Versioning

Schemas use JSON Schema draft 2020-12. The initial protocol version is represented as a string in protocol payloads, for example `2026-05-15`.

Schemas are intentionally minimal and will evolve as implementation starts. Changes should be additive when practical. Breaking changes must update schema IDs or protocol version fields, refresh examples, and be coordinated across engine, GUI, and both IDE plugins.

`snapshot` SSE events reset client state and sequence tracking. Other chat events use monotonic `seq` values within a chat stream.

## Future commands

These commands are not available until contract tooling exists:

```sh
npm run validate:contracts
npm run generate:contracts
npm run test:contracts
```

Repository-level validation is currently available from the root:

```sh
npm run check
find packages/contracts -name '*.json' -print0 | xargs -0 -n1 python3 -m json.tool >/dev/null
```

## Dependencies

- Contract examples that include product identity fields must read from or match `product/identity.json`.
- Engine, GUI, VS Code plugin, and JetBrains plugin should depend on contracts for shared boundary shapes once schemas exist.
- Contracts should remain product-level interfaces, not hidden application logic.

## Security expectations

- Every privileged bridge message must be schema-validated and policy-checked by future implementations before it can trigger file edits, IDE tool execution, shell-like behavior, workspace mutation, or privileged host actions.
- Receivers should validate every engine HTTP request, engine HTTP response, SSE event, and bridge message at subsystem boundaries.
- Bridge receivers must verify host/source/origin where the platform supports it and correlate request-response messages with outstanding requests.
- Safe UI messages such as theme and active file updates must remain conceptually separate from privileged requests such as workspace edits and IDE tool execution.
- The engine must remain the authority for tool authorization and confirmation policy even when requests originate from GUI or IDE bridge messages.

## Safety rules

- Do not add runtime application code in this scaffold phase.
- Keep schemas explicit, versioned, and validated before they are used by privileged boundaries.
- Avoid embedding secrets, local paths, or user-specific values in examples.
- Keep bridge contracts separated between safe UI messages and privileged requests.
- Do not hardcode product-sensitive values that should be sourced from `product/identity.json`.
