# SFTP Bridge

`@code-sync-bridge/sftp-bridge` is a minimal CLI package built on top of the shared interactive SFTP core.

It is intentionally narrow:

- establish an interactive SFTP connection
- authenticate with password and/or dynamic token prompts
- upload files
- upload directories recursively
- download files
- download directories recursively
- synchronize directories bidirectionally without deletion
- list remote directories

## Sync Logging And Backup

When you run `sync-dir`:

- a log file is written under `.sftp-bridge/` inside the local sync directory
- added and overwritten files are recorded there
- before a remote file overwrites a local file, the old local file is backed up under `.sftp-bridge/backups/`

## Usage

```bash
npm run build --workspace=packages/sftp-bridge
node packages/sftp-bridge/dist/bin/sftp-bridge.js --help
```

## Example Config

See [config.example.json](./config.example.json).

## Path Resolution

- default config path: `config.json` next to the executable
- relative `--config` paths are resolved from the executable directory
- relative paths inside the config are resolved from the config file directory

This means you can place these files together:

- `sftp-bridge.exe`
- `config.json`
- `current-login-qr.png`

and use:

```bash
sftp-bridge.exe test
```

## Supported Authentication Modes

- password only
- password plus dynamic token
- key-based login
- QR-code derived token
- TOTP-secret derived token

## Example Commands

```bash
node packages/sftp-bridge/dist/bin/sftp-bridge.js --config packages/sftp-bridge/config.example.json test
node packages/sftp-bridge/dist/bin/sftp-bridge.js --config packages/sftp-bridge/config.example.json list /
node packages/sftp-bridge/dist/bin/sftp-bridge.js --config packages/sftp-bridge/config.example.json upload .\\local.zip /incoming/local.zip
node packages/sftp-bridge/dist/bin/sftp-bridge.js --config packages/sftp-bridge/config.example.json upload-dir .\\project /incoming/project
node packages/sftp-bridge/dist/bin/sftp-bridge.js --config packages/sftp-bridge/config.example.json download /incoming/local.zip .\\downloaded.zip
node packages/sftp-bridge/dist/bin/sftp-bridge.js --config packages/sftp-bridge/config.example.json download-dir /incoming/project .
node packages/sftp-bridge/dist/bin/sftp-bridge.js --config packages/sftp-bridge/config.example.json sync-dir .\\project /incoming/project
```
