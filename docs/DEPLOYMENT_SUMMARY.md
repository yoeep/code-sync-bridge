# Deployment Summary

## Status

The repository now includes a coherent set of deployment-facing documents for installation, deployment, troubleshooting, portable delivery, configuration, and release preparation.

## Core Documents

- [INSTALLATION.md](./INSTALLATION.md): local setup and repository validation
- [DEPLOYMENT.md](./DEPLOYMENT.md): deployment model and operator checklist
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md): common failures and first-line diagnosis
- [PORTABLE_DEPLOYMENT.md](./PORTABLE_DEPLOYMENT.md): deployment into restricted environments
- [SFTP_SETUP_GUIDE.md](./SFTP_SETUP_GUIDE.md): bridge setup expectations
- [CONFIGURATION.md](./CONFIGURATION.md): runtime and config boundary rules
- [RELEASE.md](./RELEASE.md): release preparation and validation

## Validation Baseline

The repository-level validation flow is:

```bash
npm run release:check
```

This expands to:

- manifest validation
- lint
- lightweight workspace build
- integration tests

## Deployment Shape

The project is designed around three operational areas:

- intranet client side
- extranet client side
- SFTP bridge

Optional tooling:

- VS Code extension on the extranet side

## Current Outcome

The deployment surface is now materially cleaner than the original repository state:

- runtime data is separated from source
- package boundaries are more explicit
- documentation has a primary English path for open source users
- release and validation scripts are present

## Remaining Operational Work

The remaining work before a public release is mostly polish:

- use a manual tag and release publication flow if desired
- expand end-to-end demo material if required
- continue improving operator examples as real deployments provide feedback
