# Installation

## Overview

Code Sync Bridge is a Node.js monorepo. For local development and evaluation you usually only need the repository root, Node.js, and npm.

Use this guide when you want to:

- build the workspace locally
- run the CLI packages from source
- run integration tests
- prepare a machine for further deployment work

## Requirements

Minimum:

- Node.js 18 or later
- npm 9 or later
- Git

Recommended:

- Node.js 20
- npm 10
- a writable home directory for runtime state

## Repository Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/code-sync-bridge/code-sync-bridge.git
cd code-sync-bridge
npm install
```

## Validate the Workspace

Run the standard validation flow:

```bash
npm run lint
npm run build:lite
npm test
```

## Runtime Data Location

Runtime state is stored outside the repository by default:

```text
~/.code-sync-bridge
```

Override it if needed:

```bash
CODE_SYNC_BRIDGE_HOME=/custom/path
```

## Build Outputs

The main workspace build target is:

```bash
npm run build:lite
```

After a successful build, the main CLI outputs are available at:

```text
packages/intranet-client/dist/cli.js
packages/extranet-client/dist/cli.js
```

## Running the CLIs

Example:

```bash
node packages/intranet-client/dist/cli.js --help
node packages/extranet-client/dist/cli.js --help
```

## Integration Tests

The integration tests live in the `tests` workspace and can be run from the repository root:

```bash
npm test
```

Coverage mode:

```bash
npm run test:integration:coverage
```

## VS Code Extension

Build the extension from:

```bash
packages/vscode-extension
```

Package it with:

```bash
cd packages/vscode-extension
npm run package
```

## Troubleshooting

- If PowerShell blocks `npm`, use `npm.cmd`.
- If `build:lite` fails with `EPERM` on `dist` outputs, remove the protected generated files and rebuild with sufficient filesystem permissions.
- If runtime data appears under the repository tree, stop and correct the runtime-home configuration before continuing.

## Next Documents

- [Architecture](./ARCHITECTURE.md)
- [Configuration](./CONFIGURATION.md)
- [Deployment](./DEPLOYMENT.md)
- [Release process](./RELEASE.md)
- [Troubleshooting](./TROUBLESHOOTING.md)
