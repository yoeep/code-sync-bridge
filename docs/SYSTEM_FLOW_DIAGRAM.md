# System Flow Diagram

## Overview

The repository consists of a shared core, two CLI clients, an optional VS Code extension, and an SFTP bridge that transports code-stream payloads between isolated environments.

## High-Level Flow

```mermaid
flowchart LR
    IntranetRepo[Intranet Repository] --> IntranetClient[Intranet Client]
    IntranetClient --> SftpBridge[SFTP Bridge]
    SftpBridge --> ExtranetClient[Extranet Client]
    ExtranetClient --> DeveloperWorkspace[Developer Workspace]
    DeveloperWorkspace --> VscodeExtension[VS Code Extension]
```

## Package Relationship

```mermaid
graph TB
    Shared[@code-sync-bridge/shared]
    Intranet[@code-sync-bridge/intranet-client]
    Extranet[@code-sync-bridge/extranet-client]
    VSCode[code-sync-bridge-vscode]
    Tests[@code-sync-bridge/integration-tests]

    Shared --> Intranet
    Shared --> Extranet
    Shared --> VSCode
    Intranet --> Tests
    Extranet --> Tests
    Shared --> Tests
    Extranet --> VSCode
```

## Runtime Boundary

```mermaid
flowchart TB
    Repo[Repository Source Tree] --> BuildOutputs[dist Outputs]
    RuntimeHome[~/.code-sync-bridge] --> Logs[Logs]
    RuntimeHome --> Cache[Cache]
    RuntimeHome --> Sessions[Transfer Sessions]
    RuntimeHome --> Config[Runtime Config]
```

## CLI Flow

```mermaid
sequenceDiagram
    participant User
    participant CLI
    participant Shared
    participant SFTP

    User->>CLI: run command
    CLI->>Shared: load config and runtime helpers
    CLI->>SFTP: authenticate and transfer metadata or payloads
    SFTP-->>CLI: status or payload result
    CLI-->>User: command output
```

## Validation Flow

```mermaid
flowchart LR
    Lint[lint] --> Build[build:lite]
    Build --> Tests[test]
    Tests --> ReleaseCheck[release:check]
```

## Notes

- The CLI entry points are intentionally thin and delegate to command modules or services.
- Shared functionality should be consumed through documented package entry points or subpath exports.
- Runtime state should stay outside the repository tree.
