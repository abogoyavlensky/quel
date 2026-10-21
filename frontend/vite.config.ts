import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The app is served by Wails from resources/public, not by a Vite dev
// server: the page has to share Wails' origin to reach the bridge. `npm run
// watch` rebuilds on every change and the running app reloads the window.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  base: "/",
  build: {
    outDir: "../resources/public",
    emptyOutDir: true,
  },
});
