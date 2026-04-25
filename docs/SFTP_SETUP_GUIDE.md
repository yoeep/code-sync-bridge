# SFTP Setup Guide

## Overview

Code Sync Bridge relies on an SFTP bridge that both the intranet and extranet environments can reach. This document covers the minimum configuration expectations for that bridge.

## Required Information

At minimum, each client needs:

- host
- port
- username
- authentication method

Supported authentication approaches in the project include:

- SSH key based authentication
- password based authentication
- dynamic token based authentication flows supported by the shared runtime

## Example Configuration

```json
{
  "sftp": {
    "host": "your-sftp-server.example.com",
    "port": 22,
    "username": "sync-user",
    "authMethod": "key",
    "privateKeyPath": "/path/to/private/key",
    "timeout": 30000,
    "retryAttempts": 3
  }
}
```

## Environment Variable Pattern

When you do not want credentials stored directly in config files, prefer environment variables and external secret management.

Example:

```bash
export SFTP_HOST=your-sftp-server.example.com
export SFTP_PORT=22
export SFTP_USERNAME=sync-user
export SFTP_AUTH_METHOD=key
export SFTP_PRIVATE_KEY_PATH=/path/to/private/key
```

## SSH Key Flow

1. Generate a key pair:

```bash
ssh-keygen -t rsa -b 4096 -f ~/.ssh/code_sync_bridge
```

2. Install the public key on the SFTP server for the target user.
3. Reference the private key path in client configuration.

## Validation

Basic connectivity check:

```bash
ssh -v sync-user@your-sftp-server.example.com
```

Repository-level validation:

```bash
npm run build:lite
npm test
```

Client-side validation should then be done with the appropriate CLI command or environment-specific smoke test.

## Operational Notes

- keep server-side permissions tight
- separate test and production accounts when possible
- do not commit secrets or private keys
- keep runtime config outside the source tree

## Related Docs

- [Configuration](./CONFIGURATION.md)
- [Deployment](./DEPLOYMENT.md)
- [Troubleshooting](./TROUBLESHOOTING.md)
