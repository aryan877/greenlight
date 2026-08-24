import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.GREENLIGHT_STUDIO_PORT ?? 4173),
    proxy: {
      "/greenlight-api": {
        target: "http://localhost:8941",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/greenlight-api/, "/api"),
      },
      "/trueforge": {
        target: "http://localhost:8790",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/trueforge/, ""),
      },
    },
  },
});
