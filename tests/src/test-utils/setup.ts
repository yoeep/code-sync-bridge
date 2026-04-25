import { TestEnvironment } from './TestEnvironment';
import * as path from 'path';

process.env.CODE_SYNC_BRIDGE_HOME = path.resolve(__dirname, '../../.runtime');

// Global test setup
beforeAll(async () => {
  // Initialize test environment
  await TestEnvironment.initialize();
});

afterAll(async () => {
  // Cleanup test environment
  await TestEnvironment.cleanup();
});

// Increase timeout for integration tests
jest.setTimeout(60000);
