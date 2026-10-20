import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  plugins: [{
    name: 'pst-third-party-notices',
    generateBundle() {
      for (const filename of ['THIRD_PARTY_NOTICES.md', 'LICENSE-THIRD-PARTY.txt']) {
        this.emitFile({
          type: 'asset',
          fileName: filename,
          source: readFileSync(fileURLToPath(new URL(filename, import.meta.url)), 'utf8'),
        });
      }
    },
  }],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
