import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      // Socket.IO does HTTP polling first then upgrades to WS — both must
      // be proxied on the same path. ws:true enables websocket upgrade.
      "/ws": { target: "http://localhost:3000", ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
