import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = path.dirname(fileURLToPath(import.meta.url));

// The built UI is committed as dist/ and shipped inside the npm package, so a
// user running `npx prompt-vault` never needs a build step or a network fetch
// beyond the package download itself.
export default defineConfig({
  root: "ui",
  // Relative asset URLs — the server hands dist/ back from "/", but this keeps
  // the build independent of where it ends up being mounted.
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(here, "ui/src"),
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    // `npm run dev` serves the UI on Vite's port and forwards API calls to a
    // separately running `npm start`.
    proxy: {
      "/api": "http://127.0.0.1:8974",
    },
  },
});
