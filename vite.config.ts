import { defineConfig } from "vite";
import { resolve } from "path";

// Vitest reads this config for test settings.
// The actual multi-entry build is driven by build.mjs.
export default defineConfig({
  test: {
    environment: "node",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        content_script: resolve(__dirname, "src/content_script.ts"),
        popup: resolve(__dirname, "src/popup/popup.ts"),
        options: resolve(__dirname, "src/options/options.ts"),
      },
    },
  },
});
