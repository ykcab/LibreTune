import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  build: {
    rollupOptions: {
      output: {
        /**
         * Keep the heavy vendor groups in their own chunks.
         *
         * Three alone is ~37 MB of source; with the react-three bindings it was
         * the single largest thing in the entry chunk, and it is only reachable
         * from one tab (the 3D table view). `marked` only renders the user
         * manual. Splitting them here — rather than relying on the dynamic
         * imports alone — keeps them out of the vendor chunk that every window
         * loads, and lets a rebuild re-download only what changed.
         */
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules\/(three|@react-three)\//.test(id)) return "three";
          if (id.includes("node_modules/marked")) return "markdown";
          return undefined;
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
