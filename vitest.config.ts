import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// 测试配置同时覆盖客户端（web/）与 feed 服务（server/）。
export default defineConfig({
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['web/src/**/*.test.ts', 'server/**/*.test.ts'],
  },
});
