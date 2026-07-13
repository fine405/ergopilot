import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = defineConfig(({ mode }) => ({
  build: { outDir: mode === "desktop" ? "dist-desktop" : "dist" },
  envDir: "../..",
  resolve: { tsconfigPaths: true },
  server: { port: 3000, strictPort: true },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart(
      mode === "desktop"
        ? {
            spa: {
              enabled: true,
              prerender: { outputPath: "/index.html" },
            },
          }
        : {},
    ),
    viteReact(),
  ],
}));

export default config;
