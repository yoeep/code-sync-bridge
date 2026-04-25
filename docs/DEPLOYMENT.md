# Deployment

## Overview

Code Sync Bridge is typically deployed across at least two environments:

- an intranet-side machine running the intranet client
- an extranet-side machine running the extranet client
- an SFTP bridge reachable by both sides

The VS Code extension is optional and normally installed only on the extranet side.

## Deployment Model

### Intranet Side

Expected components:

- Node.js runtime
- `@code-sync-bridge/intranet-client`
- access to the internal repository source
- connectivity to the SFTP bridge

### Extranet Side

Expected components:

- Node.js runtime
- `@code-sync-bridge/extranet-client`
- optional `code-sync-bridge-vscode` extension
- connectivity to the SFTP bridge

### SFTP Bridge

Expected components:

- SSH/SFTP service
- storage for stream payloads and metadata
- user and key management appropriate for both environments

## Recommended Deployment Flow

1. Prepare Node.js on both machines.
2. Build the workspace from the repository root:

```bash
npm install
npm run build:lite
```

3. Validate the repository:

```bash
npm run lint
npm test
```

4. Install or run the required client package on each side.
5. Configure both clients to use the same SFTP bridge.
6. Validate connectivity before enabling routine sync work.

## Runtime Boundaries

Do not write logs, caches, extracted repositories, or resumable-transfer state into the repository tree.

Use the runtime home:

```text
~/.code-sync-bridge
```

or override it with:

```bash
CODE_SYNC_BRIDGE_HOME=/custom/path
```

## CLI Validation

After building:

```bash
node packages/intranet-client/dist/cli.js --help
node packages/extranet-client/dist/cli.js --help
```

## Deployment Checklist

- Node.js is installed on both sides
- `npm run build:lite` passed
- `npm run lint` passed
- `npm test` passed
- SFTP connectivity is confirmed
- runtime data is stored outside the source tree
- config files are stored outside `packages/*/src`

## Related Docs

- [Installation](./INSTALLATION.md)
- [Configuration](./CONFIGURATION.md)
- [SFTP setup](./SFTP_SETUP_GUIDE.md)
- [Portable deployment](./PORTABLE_DEPLOYMENT.md)
- [Troubleshooting](./TROUBLESHOOTING.md)
