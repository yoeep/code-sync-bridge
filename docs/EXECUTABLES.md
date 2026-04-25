# Executable Packaging

This repository can be packaged into standalone Windows executables for the two CLI clients:

- `intranet-client.exe`
- `extranet-client.exe`

The generated executables embed a Node.js runtime, so the target machine does not need a separate Node.js installation.

## Current Scope

The first packaging target is the CLI layer only.

- Included: intranet CLI, extranet CLI, shared runtime/config/SFTP logic
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
2. `nexe` packaging for both CLI entrypoints

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
- Dynamic-token SFTP flows are supported, including console-entered verification codes.
- QR-code and screenshot-based token flows may require optional dependencies to be present in the packaged environment and should be validated before public release.
- `git` is not bundled; repository commands still require a working Git executable on the target machine.
- The first packaging run downloads a prebuilt Node runtime through `nexe`, so it depends on external network access to the binary host.
