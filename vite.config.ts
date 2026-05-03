import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const buildDate = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).replace(" ", "");

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_LABEL__: JSON.stringify(`v${buildDate}`),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client/src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
});
