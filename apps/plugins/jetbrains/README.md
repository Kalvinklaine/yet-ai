# Yet AI JetBrains Plugin

## Ownership and boundary

`apps/plugins/jetbrains` will own the future JetBrains plugin host for Yet AI. Its planned responsibilities are plugin metadata, package namespace, engine discovery and launch, lifecycle and logs, JCEF tool window hosting, JetBrains-to-webview bridge implementation, optional LSP client setup, actions, settings, and notifications.

The plugin should stay thin. Engine-owned AI behavior, provider configuration, storage, tool policy, and indexing must not be duplicated in platform services. GUI-owned design and UI state should remain in the packaged webview.

## Current status

Scaffold only. There is no Gradle project, plugin descriptor, Kotlin source, JCEF host, engine launcher, or runtime implementation in this directory yet.

## Future commands

These commands are not available until a JetBrains plugin project exists:

```sh
./gradlew build
./gradlew test
```

Repository-level validation is currently available from the root:

```sh
npm run check
```

## Dependencies

- Plugin ID, group, plugin name, package namespace, action IDs, and settings namespaces must be generated from or checked against `product/identity.json`.
- Bridge message contracts should come from `packages/contracts` once contracts are introduced.
- Engine launch settings must align with the future engine binary and API contracts.

## Safety rules

- Do not add runtime plugin code in this scaffold phase.
- Do not duplicate chat state, provider secrets, or engine-owned configuration inside plugin storage.
- Validate browser bridge messages before dispatch once bridge code exists.
- Keep privileged editor operations behind explicit request-response correlation and confirmation policy.
- Do not hardcode marketplace identity values outside the identity contract.
