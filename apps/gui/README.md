# Yet AI GUI

## Ownership and boundary

`apps/gui` will own the future Yet AI React webview, browser development shell, design system, typed engine client, SSE client, and logical IDE bridge client.

The GUI should present chat, settings, onboarding, provider setup, tool confirmations, and later task or knowledge surfaces. It must remain a client of engine and bridge contracts rather than owning provider secrets, direct filesystem mutation, shell execution, or indexing.

## Current status

Scaffold only. There is no React application, package manifest, bundled UI, design system, or runtime implementation in this directory yet.

## Future commands

These commands are not available until a GUI package exists:

```sh
npm run types
npm run lint
npm run test
npm run build
```

Repository-level validation is currently available from the root:

```sh
npm run check
```

## Dependencies

- Product-sensitive UI package names and public product labels must come from `product/identity.json` where practical.
- Engine REST, SSE, and IDE bridge message shapes should come from `packages/contracts` once contracts are introduced.
- IDE host behavior should be accessed through a logical bridge so VS Code, JetBrains, and browser development mode remain separable.

## Safety rules

- Do not add runtime UI code in this scaffold phase.
- Build a new Yet AI interface and design system; do not copy external product screens, visual hierarchy, icons, or copy.
- Validate bridge and engine payloads at the boundary once runtime code exists.
- Keep privileged actions separate from safe UI state and require host or engine policy checks for edits and tool execution.
- Do not store provider secrets or private integration credentials in GUI state.
