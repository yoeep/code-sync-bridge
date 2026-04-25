# Portable Deployment

## Overview

Portable deployment is intended for environments where the target machine should not compile native modules or fetch dependencies from the public network.

The idea is simple:

1. build and validate the repository in a stable environment
2. package the required outputs
3. transfer that package into the restricted environment
4. run a lightweight installation or startup flow there

## When to Use It

Portable deployment is a good fit when:

- the target environment has no npm registry access
- native module compilation is blocked or impractical
- multiple isolated environments need the same validated build
- you need a repeatable handoff package for controlled environments

## Recommended Build-Side Workflow

From a connected build machine:

```bash
npm install
npm run lint
npm run build:lite
npm test
```

Then gather the required deliverables:

- built package outputs under `packages/*/dist`
- repository docs needed by operators
- example configuration templates
- version metadata

## Target Environment Expectations

The target machine should still have:

- Node.js 18 or later
- permission to read the transferred package
- a writable runtime-home location outside the source tree

The target machine should not need:

- a TypeScript toolchain
- native module build tooling
- direct npm registry access

## Portable Package Contents

A practical portable bundle should include:

- `packages/shared/dist`
- `packages/intranet-client/dist`
- `packages/extranet-client/dist`
- `packages/vscode-extension/dist` when the extension is needed
- selected docs
- selected config examples
- a version manifest or release note snapshot

## Validation Before Transfer

Do not transfer a portable bundle unless these pass:

```bash
npm run release:check
```

And:

```bash
npm run release:prepare
```

## Runtime Rules

Even in portable mode:

- logs must stay outside the repository
- caches must stay outside the repository
- transfer sessions must stay outside the repository
- config should come from explicit files or environment variables

## Suggested Operator Checklist

- confirm the package version
- confirm build validation passed before transfer
- confirm target Node.js version
- confirm the runtime-home path is writable
- confirm the SFTP bridge is reachable from the target environment

## Related Docs

- [Installation](./INSTALLATION.md)
- [Deployment](./DEPLOYMENT.md)
- [Configuration](./CONFIGURATION.md)
- [Release process](./RELEASE.md)
