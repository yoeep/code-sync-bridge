# Examples

This directory contains small focused examples for authentication and transport setup.

## Included Examples

- `dynamic-token-auth.js`: example of dynamic token based authentication
- `qrcode-token-auth.js`: example of QR-code based token flow
- `config/intranet-config.example.json`: starter intranet-side config
- `config/extranet-config.example.json`: starter extranet-side config

## Running an Example

From the repository root:

```bash
node examples/dynamic-token-auth.js
```

or:

```bash
node examples/qrcode-token-auth.js
```

These examples are intentionally small. They are useful for understanding isolated auth behavior, not for validating the full sync workflow.

## Full Workflow Validation

Use the main repository validation flow for that:

```bash
npm run lint
npm run build:lite
npm test
```

## Related Docs

- [Installation](../docs/INSTALLATION.md)
- [Configuration](../docs/CONFIGURATION.md)
- [Architecture](../docs/ARCHITECTURE.md)
