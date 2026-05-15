# Yet AI Contracts

## Ownership and boundary

`packages/contracts` will own shared schemas, examples, and eventually generated or hand-maintained types for boundaries between Yet AI subsystems.

Expected contract areas include engine HTTP requests and responses, SSE chat events, IDE bridge messages, capability summaries, tool metadata, and golden examples used by engine, GUI, and plugin tests.

## Current status

Scaffold only. There are no schemas, fixtures, generated types, package manifests, or runtime implementation in this directory yet.

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
```

## Dependencies

- Contract examples that include product identity fields must read from or match `product/identity.json`.
- Engine, GUI, VS Code plugin, and JetBrains plugin should depend on contracts for shared boundary shapes once schemas exist.
- Contracts should remain product-level interfaces, not hidden application logic.

## Safety rules

- Do not add runtime application code in this scaffold phase.
- Keep schemas explicit, versioned, and validated before they are used by privileged boundaries.
- Avoid embedding secrets, local paths, or user-specific values in examples.
- Keep bridge contracts separated between safe UI messages and privileged requests.
- Do not hardcode product-sensitive values that should be sourced from `product/identity.json`.
