import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    env: {
      NODE_ENV: 'test',
      // Unit tests never open a connection; a placeholder satisfies config validation.
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    },
  },
});
