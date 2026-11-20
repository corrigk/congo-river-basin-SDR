// Single-file offline backup: the whole page (code, data, fonts) inlined into one HTML file that opens by
// double-click with no server or network.
//   npm run build:offline  ->  sdr-offline.html (and dist/sdr-offline.html when dist exists)
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'node:fs';

export default defineConfig({
  base: './',
  plugins: [
    viteSingleFile(),
    {
      name: 'copy-out',
      closeBundle() {
        fs.copyFileSync('dist-offline/index.html', 'sdr-offline.html');
        if (fs.existsSync('dist')) fs.copyFileSync('dist-offline/index.html', 'dist/sdr-offline.html');
      },
    },
  ],
  build: { target: 'es2022', outDir: 'dist-offline', emptyOutDir: true },
});
