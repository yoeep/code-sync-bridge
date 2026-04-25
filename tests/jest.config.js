module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@code-sync-bridge/shared$': '<rootDir>/../packages/shared/src/index.ts',
    '^@code-sync-bridge/shared/config$': '<rootDir>/../packages/shared/src/config/index.ts',
    '^@code-sync-bridge/shared/runtime$': '<rootDir>/../packages/shared/src/runtime/index.ts',
    '^@code-sync-bridge/shared/sftp$': '<rootDir>/../packages/shared/src/sftp/index.ts',
    '^@code-sync-bridge/intranet-client$': '<rootDir>/../packages/intranet-client/src/index.ts',
    '^@code-sync-bridge/extranet-client$': '<rootDir>/../packages/extranet-client/src/index.ts',
  },
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/test-utils/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 60000, // 60 seconds for integration tests
  setupFilesAfterEnv: ['<rootDir>/src/test-utils/setup.ts'],
  maxWorkers: 1, // Run tests sequentially to avoid SFTP conflicts
};
