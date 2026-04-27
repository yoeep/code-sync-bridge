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
- `packages/sftp-bridge`: minimal interactive SFTP CLI for direct upload and download between isolated networks
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

## SFTP Bridge Quick Start

If your goal is only to open a direct SFTP path between two isolated networks, use `packages/sftp-bridge`.

Build and view help:

```bash
npm run build:lite
node packages/sftp-bridge/dist/bin/sftp-bridge.js --help
```

Or use the packaged executable:

```bash
artifacts\exe\sftp-bridge.exe --help
```

The minimal operating flow is:

1. prepare a config file
2. verify login with `test`
3. inspect the target directory with `list`
4. transfer files with `upload` or `download`

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
node packages/sftp-bridge/dist/cli.js --help
```

The VS Code extension is built from `packages/vscode-extension`.

For a stripped-down SFTP-only workflow, use `packages/sftp-bridge`. It only implements interactive login, upload, download, and directory listing.

Standalone Windows executables can also be built for the two CLI clients. See [Executable packaging](docs/EXECUTABLES.md).

## SFTP Bridge Configuration

Start from [packages/sftp-bridge/config.example.json](packages/sftp-bridge/config.example.json).

Path rules:

- when you run `sftp-bridge.exe`, the default config path is `config.json` next to the `exe`
- when you pass `--config relative-path.json`, that relative path is resolved from the `exe` directory, not the current working directory
- relative file paths inside the config are resolved from the config file directory
- this applies to `privateKey`, `dynamicToken.filePath`, and `dynamicToken.qrCodeImagePath`
- remote command paths are normalized to absolute SFTP paths before use
- examples: remote `./` becomes `/`, remote `../share` becomes `/share`

Example:

```json
{
  "host": "your-sftp-server.example.com",
  "port": 22,
  "username": "sync-user",
  "password": "",
  "authMethod": "dynamic-token",
  "timeout": 30000,
  "retries": 3,
  "retryDelay": 2000,
  "basePath": "/",
  "dynamicToken": {
    "source": "prompt",
    "prompt": "Enter dynamic token: "
  }
}
```

Important fields:

- `host`: SFTP server address
- `port`: SSH/SFTP port, usually `22`
- `username`: login user
- `password`: password prompt response if the server asks for a password before a second factor
- `authMethod`: use `password`, `dynamic-token`, or `key`
- `timeout`: SSH ready timeout in milliseconds
- `retries`: connection retry count
- `retryDelay`: delay between retries in milliseconds
- `basePath`: remote root path used by `list`, `upload`, and `download`
- `dynamicToken`: how the second factor is obtained

## Dynamic Token Modes

`sftp-bridge` supports these dynamic token sources:

- `prompt`: ask in the console each time
- `env`: read from an environment variable
- `file`: read from a local file
- `qr`: read a token or TOTP URI from a QR code image
- `totp`: generate a TOTP code directly from a shared secret

### Console Prompt

Use this when an operator reads the code from a phone or another screen and types it manually:

```json
"dynamicToken": {
  "source": "prompt",
  "prompt": "Enter dynamic token: "
}
```

### Environment Variable

Use this when another process injects the token:

```json
"dynamicToken": {
  "source": "env",
  "envVarName": "SFTP_DYNAMIC_TOKEN"
}
```

Example:

```bash
set SFTP_DYNAMIC_TOKEN=123456
artifacts\exe\sftp-bridge.exe --config sftp-config.json test
```

### File-Based Token

Use this when a helper process writes the current code into a file:

```json
"dynamicToken": {
  "source": "file",
  "filePath": "C:/bridge/token.txt"
}
```

### QR-Code Login

This is the mode to use when the SFTP login page or terminal shows a QR code and you want the bridge to read it automatically.

Configuration:

```json
"dynamicToken": {
  "source": "qr",
  "qrCodeImagePath": "C:/bridge/current-login-qr.png",
  "watchMode": true,
  "watchInterval": 5000
}
```

How it works:

- the bridge reads the image file at `qrCodeImagePath`
- if the QR contains a plain code, it extracts that code directly
- if the QR contains a TOTP URI such as `otpauth://totp/...`, it derives the current one-time password
- with `watchMode: true`, it keeps watching the image file until a valid token can be extracted

Typical usage:

1. save the current login QR image to a known file path
2. point `qrCodeImagePath` to that file
3. run `test` or `upload`
4. if the QR changes periodically, keep `watchMode` enabled

If `config.json` and the QR image are stored next to `sftp-bridge.exe`, you can use a relative path such as:

```json
"dynamicToken": {
  "source": "qr",
  "qrCodeImagePath": "./current-login-qr.png",
  "watchMode": true,
  "watchInterval": 5000
}
```

That path will still work even when `sftp-bridge.exe` is launched from another directory through `PATH`.

### TOTP Secret

Use this when you already have the shared secret and do not need QR-image parsing at runtime:

```json
"dynamicToken": {
  "source": "totp",
  "totpSecret": "BASE32SECRET123456"
}
```

## SFTP Bridge Commands

Test the connection:

```bash
artifacts\exe\sftp-bridge.exe --config sftp-config.json test
```

If `config.json` is next to the exe, you can omit `--config` entirely:

```bash
artifacts\exe\sftp-bridge.exe test
```

List a remote directory:

```bash
artifacts\exe\sftp-bridge.exe --config sftp-config.json list /
```

Upload a file:

```bash
artifacts\exe\sftp-bridge.exe --config sftp-config.json upload C:\data\bundle.zip /incoming/bundle.zip
```

Single-file uploads and downloads show a live progress bar with percentage, transferred size, speed, and ETA.

Upload a local directory recursively:

```bash
artifacts\exe\sftp-bridge.exe --config sftp-config.json upload-dir C:\data\project /incoming/project
```

Download a file:

```bash
artifacts\exe\sftp-bridge.exe --config sftp-config.json download /incoming/bundle.zip C:\data\bundle.zip
```

Download a remote directory recursively:

```bash
artifacts\exe\sftp-bridge.exe --config sftp-config.json download-dir /incoming/project .
```

Synchronize a local directory and a remote directory without deletion:

```bash
artifacts\exe\sftp-bridge.exe --config sftp-config.json sync-dir C:\data\project /incoming/project
```

Run the same commands from the built Node entrypoint instead of the exe:

```bash
node packages/sftp-bridge/dist/bin/sftp-bridge.js --config sftp-config.json test
node packages/sftp-bridge/dist/bin/sftp-bridge.js --config sftp-config.json list /
```

## Common Usage Patterns

Direct connectivity test:

```bash
artifacts\exe\sftp-bridge.exe --config sftp-config.json test
artifacts\exe\sftp-bridge.exe --config sftp-config.json list /
```

One-way handoff from one network to the other:

```bash
artifacts\exe\sftp-bridge.exe --config sftp-config.json upload C:\handoff\payload.zip /bridge/payload.zip
```

Push an entire local directory to the remote side:

```bash
artifacts\exe\sftp-bridge.exe --config sftp-config.json upload-dir C:\handoff\export /bridge/export
```

Pull a file from the opposite side:

```bash
artifacts\exe\sftp-bridge.exe --config sftp-config.json download /bridge/result.zip C:\handoff\result.zip
```

Pull an entire remote directory into the current directory:

```bash
artifacts\exe\sftp-bridge.exe --config sftp-config.json download-dir /bridge/export .
```

Bidirectional synchronization:

```bash
artifacts\exe\sftp-bridge.exe --config sftp-config.json sync-dir C:\handoff\workspace /bridge/workspace
```

Current behavior:

- if a file exists only locally, it is uploaded
- if a file exists only remotely, it is downloaded
- if both sides have the file, the newer side wins
- directories are created automatically on both sides
- no files are deleted automatically
- a sync log is written locally under `.sftp-bridge/`
- before overwriting a local file from the remote side, a backup is created under `.sftp-bridge/backups/`

Password plus second-factor flow:

- set `password` for the first prompt
- set `authMethod` to `dynamic-token`
- configure `dynamicToken.source` for the second prompt

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
