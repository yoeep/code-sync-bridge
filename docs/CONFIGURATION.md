# Configuration

## Runtime Home

By default, runtime state is stored outside the repository:

```text
~/.code-sync-bridge
```

Override this location with:

```bash
CODE_SYNC_BRIDGE_HOME=/custom/path
```

This location is used for data such as:

- logs
- caches
- resumable transfer state
- runtime configuration

## CLI Config Files

CLI commands accept a config path via:

```bash
--config <path>
```

When a command supports `--config`, prefer pointing it at a file outside the repository workspace.

## Repository Rules

- Do not store runtime config under `packages/*/src`
- Do not commit generated runtime data
- Do not rely on `dist` internals as configuration boundaries

## Package Import Rules

Consumers should import shared functionality through documented package entry points.

Preferred examples:

```ts
import { ConfigManager } from '@code-sync-bridge/shared/config';
import { SFTPConnectionManager } from '@code-sync-bridge/shared/sftp';
```

Avoid:

```ts
import { something } from '@code-sync-bridge/shared/dist/internal/module';
```

## Validation Commands

Use these before publishing or opening a pull request:

```bash
npm run lint
npm run build:lite
npm test
```
