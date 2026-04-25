# Code Sync Bridge

Code Sync Bridge is a TypeScript monorepo for moving source code changes between isolated intranet and extranet environments through controlled SFTP-based transfers. It provides an intranet-side client, an extranet-side client, shared runtime and transfer modules, integration tests, and a VS Code extension.

## What It Solves

Code Sync Bridge is designed for organizations that cannot expose a normal Git remote workflow across network boundaries but still need a repeatable way to exchange code updates.

It solves three linked problems:

- register repositories as controlled code streams
- transfer source snapshots and change packages over SFTP
- restore and apply those changes on the receiving side with clear runtime, config, and workspace boundaries

The project is especially aimed at isolated network environments where auditability, explicit transfer paths, and operational safety matter more than direct remote push and pull.

## Core Capabilities

- Intranet-side CLI for registering repositories, monitoring code streams, and applying incoming updates
- Extranet-side CLI for pulling code streams, preparing local changes, and submitting updates back through the bridge
- Interactive SFTP support, including dynamic-token authentication flows
- Shared runtime modules for configuration, transfer handling, logging, security, conflict handling, and performance support
- Windows executable packaging for both CLI clients so they can run without a separate Node.js installation

## Repository Layout

- `packages/shared`: shared runtime, configuration, SFTP, transfer, security, and performance modules
- `packages/intranet-client`: intranet-side CLI for registering and monitoring code streams
- `packages/extranet-client`: extranet-side CLI for pulling streams and submitting changes
- `packages/vscode-extension`: VS Code integration built on the CLI packages
- `tests`: integration test workspace
- `docs`: setup and deployment documentation
- `examples`: small authentication examples

## Requirements

- Node.js 18 or later
- npm 9 or later
- Windows is the primary validation target today; Linux and macOS should work for core packages

## Quick Start

```bash
npm install
npm run clean
npm run build:lite
npm run lint
npm test
```

Runtime data is stored outside the repository by default under `~/.code-sync-bridge`. Override that location with `CODE_SYNC_BRIDGE_HOME` when needed.

## Common Commands

```bash
npm run build:lite
npm run lint
npm test
npm run test:integration
npm run test:integration:coverage
```

## Package Entry Points

After building the workspace, the main CLIs are available from package outputs:

```bash
node packages/intranet-client/dist/cli.js --help
node packages/extranet-client/dist/cli.js --help
```

The VS Code extension is built from `packages/vscode-extension`.

Standalone Windows executables can also be built for the two CLI clients. See [Executable packaging](docs/EXECUTABLES.md).

## Releases

Prebuilt Windows release assets are published on GitHub Releases for tagged versions. Download the current CLI binaries from:

- `intranet-client.exe`
- `extranet-client.exe`

Release page: [GitHub Releases](https://github.com/yoeep/code-sync-bridge/releases)

## Development Workflow

1. Install dependencies with `npm install`.
2. Run `npm run build:lite` after changing shared package boundaries or exported types.
3. Run `npm run lint` for static checks.
4. Run `npm test` for the integration suite.
5. Keep runtime data under `CODE_SYNC_BRIDGE_HOME`, not inside the repository.

## Runtime and Configuration

- Default runtime home: `~/.code-sync-bridge`
- Override runtime home with `CODE_SYNC_BRIDGE_HOME`
- Workspace packages should consume shared modules via package entry points or documented subpath exports
- Local CLI config is stored outside the repo or under an explicit config path, not in source folders

## Validation Expectations

The repository-level validation target is:

```bash
npm ci
npm run lint
npm run build:lite
npm test
```

## Development Notes

- Keep logs, caches, extracted repositories, and transfer sessions out of the source tree.
- Prefer imports from package entry points such as `@code-sync-bridge/shared`.
- Avoid committing generated `dist` output unless a manual release process explicitly requires it.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Configuration](docs/CONFIGURATION.md)
- [Examples](examples/README.md)
- [Installation](docs/INSTALLATION.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Portable deployment](docs/PORTABLE_DEPLOYMENT.md)
- [Release process](docs/RELEASE.md)
- [SFTP setup](docs/SFTP_SETUP_GUIDE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Integration tests](tests/README.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
