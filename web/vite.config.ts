import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api 代理到后端 3000，开发期免跨域配置
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
