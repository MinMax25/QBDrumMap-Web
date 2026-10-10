import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages等の静的ホスティング向け。base を相対にしてサブパス配置でも動く。
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist-web', emptyOutDir: true },
});
