import { defineConfig } from 'vitest/config';

/**
 * Separate from vite.config.ts on purpose: Vitest 2 ships its own Vite 5, which
 * cannot load the project's Vite 8 / ESM-only plugins. These tests only cover
 * the pure service layer, so they need no React or Tailwind plugins.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // PBKDF2 at 600k iterations is deliberately slow; the crypto suite needs room.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
