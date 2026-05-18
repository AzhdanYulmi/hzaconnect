import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { resolve } from "node:path";

// Builds frame.html + its bundle (the iframe app) to dist/widget/
export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        frame: resolve(__dirname, "frame.html"),
      },
      output: {
        entryFileNames: "widget/frame.[hash].js",
        chunkFileNames: "widget/[name].[hash].js",
        assetFileNames: "widget/[name].[hash][extname]",
      },
    },
  },
  server: { port: 5174 },
});
