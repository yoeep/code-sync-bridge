# Architecture

## Overview

Code Sync Bridge is a monorepo composed of a shared core package, two CLI packages, a VS Code extension, and an integration test workspace.

The repository is structured so that runtime state, transport logic, and package boundaries are explicit:

- `packages/shared` provides reusable runtime, config, SFTP, transfer, security, conflict, and performance modules.
- `packages/intranet-client` manages stream registration and the intranet-side sync flow.
- `packages/extranet-client` pulls streams, inspects changes, and submits updates from the extranet side.
- `packages/vscode-extension` exposes selected flows inside VS Code.
- `tests` validates cross-package behavior with integration tests.

## Package Boundaries

### `@code-sync-bridge/shared`

This package is the core dependency surface for the rest of the workspace. It now exposes documented subpath entry points so consumers do not rely on internal file layout.

Current major areas:

- `runtime`: runtime-home and filesystem boundary helpers
- `config`: config loading and config manager
- `sftp`: SFTP connection management and runtime factory wiring
- `transfer`: resumable transfer support
- `security`: encryption and integrity helpers
- `performance`: large-file and performance helpers
- `conflict`: conflict resolution and notification helpers

### `@code-sync-bridge/intranet-client`

This package owns the intranet-side orchestration. It should depend on `shared` through stable entry points and keep transport-specific implementation details behind services.

### `@code-sync-bridge/extranet-client`

This package owns the extranet-side CLI and orchestration. The CLI has been refactored into command registration modules so the entry file stays thin and command logic is grouped by responsibility.

### `@code-sync-bridge/vscode-extension`

The VS Code extension should remain an adapter around the CLI/shared layers, not a second implementation of sync logic.

## Runtime Data Model

Repository code and runtime data are intentionally separated.

- Source code lives under the monorepo root.
- Runtime data lives under `~/.code-sync-bridge` by default.
- `CODE_SYNC_BRIDGE_HOME` can override the runtime home.
- Logs, caches, session state, and extracted repositories should never be written into package source folders.

## Build and Validation

The lightweight validation path for contributors is:

```bash
npm run lint
npm run build:lite
npm test
```

`build:lite` is the current repository-wide build target for the core packages and extension.

## Current Design Direction

Recent refactors moved the project away from large central entry files and wide package imports.

The next design goal is to continue tightening boundaries without changing user-visible behavior:

- keep `shared` export surfaces intentional
- keep CLI entry points thin
- keep runtime state out of the repository
- keep cross-package validation green in local validation
