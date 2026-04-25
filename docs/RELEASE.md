# Release Process

## Goals

Each release should be reproducible, validated, and documented.

## Tag Convention

The repository release workflow is designed around Git tags in the form:

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

## Automation

GitHub Actions now includes a release workflow that runs on `v*` tags.

Current automated steps:

- install dependencies
- run `npm run release:check`
- run `npm run release:prepare`
- package the VS Code extension
- create a GitHub Release and upload the `.vsix` artifact

This is intentionally conservative. It establishes an automated release path without yet publishing npm packages.

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
