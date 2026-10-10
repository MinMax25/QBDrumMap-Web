import { defineConfig } from 'vitest/config';

// Core のテストは node、UI のテストはファイル先頭の docblock（@vitest-environment jsdom）で切り替える。
export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
