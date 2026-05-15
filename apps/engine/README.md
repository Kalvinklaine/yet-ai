# Yet AI Engine

## Ownership and boundary

`apps/engine` will own the future local Yet AI service. Its planned responsibilities are HTTP API endpoints, SSE chat streaming, optional LSP integration, provider and tool policy, storage resolution, security boundaries, and local runtime state.

The engine is the only subsystem that should eventually resolve project, config, and cache paths from `product/identity.json`. It should enforce tool authorization and confirmation policy even when requests come from GUI or IDE hosts.

## Current status

Scaffold only. There is no Rust crate, no service process, no HTTP server, no LSP server, and no runtime implementation in this directory yet.

## Future commands

These commands are not available until an engine crate exists:

```sh
cargo check
cargo test
```

Repository-level validation is currently available from the root:

```sh
npm run check
```

## Dependencies

- Product identity values must come from `product/identity.json`, including future crate name, binary name, and storage directory names.
- Runtime API shapes should depend on shared schemas or examples in `packages/contracts` once contracts are introduced.
- IDE-specific behavior should remain behind contracts instead of becoming engine-specific plugin code.

## Safety rules

- Do not add runtime code in this scaffold phase.
- Bind future local APIs to trusted local transports only and require a local capability secret.
- Do not expose provider secrets, environment secrets, or private integration credentials through GUI-facing endpoints.
- Keep filesystem mutation, shell execution, and risky tool execution behind explicit engine policy and confirmation checks.
- Do not hardcode product-sensitive names, paths, binary names, or IDs outside the identity contract.
