import { defineConfig } from 'vite';
import { serviceWorker } from './scripts/sw-plugin.mjs';

export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  server: { port: 5173 },
});
