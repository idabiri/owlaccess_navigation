/// <reference types="vitest" />
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { reportsApiPlugin } from "./server/reportsApi";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    // Shared obstacle reports for the laptop app and the phone reviewer (/review). Local demo only.
    reportsApiPlugin({ file: here("./data/obstacle_reports.json"), graphFile: here("./public/data/unified_routing_graph.json") }),
  ],
  // Listen on the local network so a phone on the same Wi-Fi can open the reviewer. The reports plugin answers only
  // private-network addresses, and Vite's own host check stays on. Do not port-forward or tunnel this server.
  server: { host: true, port: 5173, strictPort: true },
  preview: { host: true, port: 4173, strictPort: true },
  test: { environment: "jsdom", globals: true, setupFiles: ["tests/setup.ts"], css: false },
});
