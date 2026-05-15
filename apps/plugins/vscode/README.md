# Yet AI VS Code Plugin

## Ownership and boundary

`apps/plugins/vscode` will own the future VS Code extension host for Yet AI. Its planned responsibilities are extension metadata, engine discovery and launch, lifecycle and logs, packaged GUI webview hosting, VS Code `postMessage` bridge implementation, optional LSP client setup, and native command or setting registration.

The plugin should stay thin. Chat runtime, provider configuration, tool policy, storage, and indexing belong to the engine. UI state and design belong to the GUI.

## Current status

Scaffold only. There is no extension manifest, TypeScript source, activation code, packaged webview, engine launcher, or runtime implementation in this directory yet.

## Future commands

These commands are not available until a VS Code extension package exists:

```sh
npm run types
npm run lint
npm run test
npm run package
```

Repository-level validation is currently available from the root:

```sh
npm run check
```

## Dependencies

- Extension publisher, name, display name, command prefix, configuration prefix, and activity bar identifiers must be generated from or checked against `product/identity.json`.
- Bridge message contracts should come from `packages/contracts` once contracts are introduced.
- Engine launch settings must align with the future engine binary and API contracts.

## Safety rules

- Do not add runtime extension code in this scaffold phase.
- Do not duplicate chat state, provider secrets, or engine-owned configuration inside plugin storage.
- Validate bridge messages before dispatch once bridge code exists.
- Keep privileged editor operations behind explicit request-response correlation and confirmation policy.
- Do not hardcode marketplace identity values outside the identity contract.
