// Programmatic Vite build — runs two separate builds:
//  1. content_script  → dist/content_script.js  (IIFE, fully self-contained)
//  2. popup + options → dist/popup/popup.js, dist/options/options.js  (ES modules)
// Also copies static HTML files to dist/.

import { build } from "vite";
import { copyFile, mkdir } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  // ── Build 1: content script (IIFE) ────────────────────────────────────────
  await build({
    configFile: false,
    build: {
      outDir: resolve(__dirname, "dist"),
      emptyOutDir: true,
      lib: {
        entry: resolve(__dirname, "src/content_script.ts"),
        name: "GhLineBreakdown",
        formats: ["iife"],
        fileName: () => "content_script.js",
      },
    },
  });

  // ── Build 2: popup + options (ES modules) ─────────────────────────────────
  await build({
    configFile: false,
    build: {
      outDir: resolve(__dirname, "dist"),
      emptyOutDir: false,
      rollupOptions: {
        input: {
          popup: resolve(__dirname, "src/popup/popup.ts"),
          options: resolve(__dirname, "src/options/options.ts"),
        },
        output: {
          format: "es",
          entryFileNames: (chunk) => {
            if (chunk.name === "popup") return "popup/popup.js";
            if (chunk.name === "options") return "options/options.js";
            return "[name].js";
          },
          chunkFileNames: "chunks/[name]-[hash].js",
        },
      },
    },
  });

  // ── Copy static HTML and manifest ─────────────────────────────────────────
  await mkdir(resolve(__dirname, "dist/popup"), { recursive: true });
  await mkdir(resolve(__dirname, "dist/options"), { recursive: true });

  await Promise.all([
    copyFile(
      resolve(__dirname, "manifest.json"),
      resolve(__dirname, "dist/manifest.json")
    ),
    copyFile(
      resolve(__dirname, "src/popup/popup.html"),
      resolve(__dirname, "dist/popup/popup.html")
    ),
    copyFile(
      resolve(__dirname, "src/options/options.html"),
      resolve(__dirname, "dist/options/options.html")
    ),
    copyFile(
      resolve(__dirname, "src/options/options.css"),
      resolve(__dirname, "dist/options/options.css")
    ),
  ]);

  console.log("\nBuild complete. dist/ is ready to load as an unpacked extension.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
