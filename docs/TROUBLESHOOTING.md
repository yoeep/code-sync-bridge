# Troubleshooting

## Quick Checks

Run the standard repository validation first:

```bash
npm run lint
npm run build:lite
npm test
```

If one of those fails, fix that before debugging deployment-specific issues.

## Common Problems

### PowerShell blocks `npm`

Symptom:

- PowerShell reports script execution policy errors when running `npm`

Workaround:

```powershell
npm.cmd run build:lite
npm.cmd run lint
npm.cmd test
```

### `build:lite` fails with `EPERM`

Symptom:

- TypeScript cannot write to `dist` files or `tsconfig.tsbuildinfo`

Typical cause:

- protected or stale generated files in a package output directory

Actions:

1. remove the protected generated outputs
2. rerun the build with sufficient filesystem permissions
3. confirm runtime data is not being written into source folders

### SFTP connection failure

Symptom:

- timeout
- connection refused
- authentication failure

Checks:

```bash
ping your-sftp-host
```

```bash
ssh -v your-user@your-sftp-host
```

Confirm:

- host and port are correct
- keys or credentials are valid
- the SFTP service is reachable from the current network

### Runtime data appears in the repository

Symptom:

- logs, cache files, sessions, or extracted payloads show up under the project root

Action:

- verify `CODE_SYNC_BRIDGE_HOME`
- verify package code is using runtime helpers instead of ad hoc relative paths
- move accidental runtime data out of the repository tree

### Integration tests fail locally

Checks:

- Node.js version is 18 or later
- dependencies were installed from the repository root
- no stale build artifacts are blocking package resolution

Run:

```bash
npm test
```

Tests use a mock SFTP server by default. Set `TEST_USE_REAL_SFTP=true` only when you intentionally want to validate against a real target.

## Escalation Path

When filing an issue, include:

- operating system
- Node.js version
- exact command run
- exact error message
- whether the failure happened during `lint`, `build:lite`, `test`, or runtime use

## Related Docs

- [Installation](./INSTALLATION.md)
- [Deployment](./DEPLOYMENT.md)
- [SFTP setup](./SFTP_SETUP_GUIDE.md)
- [Release process](./RELEASE.md)
