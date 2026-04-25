# Contributing

## Development Setup

1. Install Node.js 18 or later.
2. Run `npm install` in the repository root.
3. Run `npm run clean` if you need to clear local build outputs.
4. Run `npm run build:lite` to build all packages.
5. Run `npm run lint` and `npm test` before opening a pull request.

## Repository Rules

- Keep generated files, logs, caches, and local runtime data out of the source tree.
- Prefer package entry points over deep imports into `dist` or other implementation paths.
- Keep changes scoped. Refactors should preserve behavior unless the pull request explicitly changes it.
- Update documentation when commands, configuration, or architecture change.
- Keep CLI entry files thin. Command logic belongs in dedicated modules or services.
- Treat `build:lite`, `lint`, and `test` as the minimum merge gate.

## Pull Requests

- Explain the problem and the chosen solution.
- List the verification steps you ran locally.
- Call out breaking changes or follow-up work explicitly.

## Code Style

- TypeScript is the default language for all packages.
- Favor explicit types at package boundaries.
- Keep comments short and only where they add real value.
- Prefer shared package subpath exports over wide root imports when the narrower boundary is already exposed.
