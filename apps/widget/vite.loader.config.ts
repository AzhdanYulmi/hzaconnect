import { defineConfig } from "vite";
import { resolve } from "node:path";

// Builds the IIFE loader: dist/widget.js
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/loader.ts"),
      formats: ["iife"],
      name: "HZAConnectLoader",
      fileName: () => "widget.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        extend: false,
      },
    },
    target: "es2017",
  },
});
