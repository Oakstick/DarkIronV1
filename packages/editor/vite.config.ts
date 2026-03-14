import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    fs: {
      // Allow serving texture files from the monorepo assets directory
      allow: [path.resolve(__dirname, "../../assets"), "."],
    },
  },
  resolve: {
    alias: {
      // /textures/OpenChessSet/assets/King/tex/... → ../../assets/OpenChessSet/assets/King/tex/...
      "/textures": path.resolve(__dirname, "../../assets"),
    },
  },
  build: {
    target: "esnext", // Required for WebGPU
    outDir: "dist",
  },
});
