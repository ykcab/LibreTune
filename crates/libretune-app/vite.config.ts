import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/** Split large vendor libraries so no single chunk exceeds ~500 kB. */
function manualChunks(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;

  // Never bucket Vite's lazy-load runtime into a heavy vendor chunk — that forces
  // the entry bundle to synchronously import ~1 MB of three.js before React boots.
  if (id.includes("vite") && id.includes("preload")) {
    return undefined;
  }

  // three.js is lazy-loaded via TableEditor3D only — do not manual-chunk it or
  // Rollup co-locates __vitePreload there and blocks app startup.
  if (
    id.includes("/three/") ||
    id.includes("\\three\\") ||
    id.includes("@react-three")
  ) {
    return undefined;
  }

  if (id.includes("marked")) {
    return "vendor-marked";
  }
  if (id.includes("lucide-react")) {
    return "vendor-icons";
  }
  if (id.includes("i18next") || id.includes("react-i18next")) {
    return "vendor-i18n";
  }
  if (id.includes("@tauri-apps")) {
    return "vendor-tauri";
  }
  if (id.includes("zustand")) {
    return "vendor-state";
  }
  if (id.includes("react-dom") || id.includes("/react/")) {
    return "vendor-react";
  }

  return undefined;
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  // Tauri serves the built app from a custom protocol; absolute `/assets/...` URLs fail to load.
  base: "./",
  plugins: [react()],

  build: {
    // three.js is ~1 MB minified; it loads only when the 3D table view is opened.
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      output: {
        manualChunks,
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
