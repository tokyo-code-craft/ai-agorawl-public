// SPAのビルド設定。仕様: docs/04-app/README.md「画面(SPA)」
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist' },
});
