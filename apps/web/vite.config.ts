import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "node:path";
export default defineConfig({
  root: path.resolve("apps/web"),
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:5000" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
