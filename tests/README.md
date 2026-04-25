# Integration Tests

This workspace contains end-to-end and failure-path coverage for the main sync flows.

## Covered Areas

- Complete sync flow from stream registration to change delivery
- Concurrent stream operations
- Network exception and retry behavior

## Commands

```bash
npm run test:integration
npm run test:integration:coverage
```

You can also run the workspace directly:

```bash
cd tests
npm test
```

## Environment Notes

- Node.js 18 or later is required.
- Tests use a mock SFTP server by default.
- Set `TEST_USE_REAL_SFTP=true` to validate against a real server.
