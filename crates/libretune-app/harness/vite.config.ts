import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

// Standalone config for the screenshot harness (root = this directory).
// `@tauri-apps/api/core` is aliased to a local stub so the real dashboard can be
// rendered without the Tauri IPC bridge.
export default defineConfig({
  root: here,
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@tauri-apps/api/core': fileURLToPath(new URL('./tauri-stub.ts', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist-harness',
    emptyOutDir: true,
  },
});
