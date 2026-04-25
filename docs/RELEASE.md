# Release Process

## Goals

Each release should be reproducible, validated, and documented.

## Tag Convention

The repository release process uses Git tags in the form:

```text
v<version>
```

Example:

```text
v1.2.3
```

## Release Checklist

1. Update user-facing documentation if commands, config, or package boundaries changed.
2. Review `CHANGELOG.md` and move relevant items out of `Unreleased`.
3. If needed, update versions with one of:

```bash
npm run version:patch
npm run version:minor
npm run version:major
```

4. Generate a release summary:

```bash
npm run release:prepare
```

5. Run repository validation:

```bash
npm run release:check
```

6. Confirm package metadata is still correct:

- package names
- versions
- descriptions
- repository links
- entry points and `exports`

7. Build any release artifacts required by the package being shipped.
8. Tag and publish according to the repository's chosen versioning policy.

## Manual Release Flow

This repository currently uses a manual release flow instead of GitHub Actions automation.

Recommended release steps:

- `npm ci`
- `npm run release:check`
- `npm run release:prepare`
- `npm run package --workspace=packages/vscode-extension`
- `npm run package:exe`
- create or edit the GitHub Release manually and upload the generated assets

## Versioning

The repository intends to follow Semantic Versioning.

- patch: fixes and low-risk maintenance
- minor: backward-compatible features and non-breaking refactors
- major: breaking API, behavior, or packaging changes

## Pre-release Expectations

Do not ship a release if any of these are failing:

- `lint`
- `build:lite`
- `test`

Do not publish if runtime-state changes are still writing into the repository tree.
