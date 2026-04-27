# Executable Packaging

This repository can be packaged into standalone Windows executables for the three CLI clients:

- `intranet-client.exe`
- `extranet-client.exe`
- `sftp-bridge.exe`

It can also package the minimal `sftp-bridge` CLI as a standalone macOS binary:

- `sftp-bridge-mac-x64-14.15.3`
- `sftp-bridge-mac-arm64-14.15.3` when the target is available

The generated executables embed a Node.js runtime, so the target machine does not need a separate Node.js installation.

## Current Scope

The first packaging target is the CLI layer only.

- Included: intranet CLI, extranet CLI, minimal SFTP bridge CLI, shared runtime/config/SFTP logic
- Not included: VS Code extension
- External runtime dependencies still required on the target machine:
  - `git` for repository operations
  - network access to the configured SFTP server
  - any external tools explicitly used by optional workflows

## Build Steps

1. Install dependencies in the repository root.
2. Run:

```bash
npm run package:exe
```

This performs:

1. `npm run build:lite`
2. `nexe` packaging for all CLI entrypoints

For the minimal SFTP bridge on macOS:

```bash
npm run package:macos:sftp-bridge
```

Or specify a target explicitly:

```bash
set NEXE_TARGET=mac-arm64-14.15.3
npm run package:macos:sftp-bridge
```

Artifacts are written to:

```text
artifacts/macos/
```

Artifacts are written to:

```text
artifacts/exe/
```

## Runtime Notes

- Runtime state still lives under `CODE_SYNC_BRIDGE_HOME` when set, or the default app home directory otherwise.
- Temporary upload archives are created in the system temp directory, not the current working directory.
- Config paths can still be passed explicitly with CLI flags.

## Known Constraints

- Packaging is currently targeted at `windows-x64-14.15.3` by default.
- The macOS CLI build currently targets `mac-x64-14.15.3` by default.
- Dynamic-token SFTP flows are supported, including console-entered verification codes.
- QR-code and screenshot-based token flows may require optional dependencies to be present in the packaged environment and should be validated before public release.
- `git` is not bundled; repository commands still require a working Git executable on the target machine.
- The first packaging run downloads a prebuilt Node runtime through `nexe`, so it depends on external network access to the binary host.
- The macOS artifact produced here is a CLI binary, not a `.app` bundle and not a `.dmg`.
