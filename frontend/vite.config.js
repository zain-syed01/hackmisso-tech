import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    /** jsPDF + html2canvas bundle is large; initial route no longer includes it (dynamic import on export). */
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("framer-motion")) return "motion";
          if (id.includes("jspdf") || id.includes("html2canvas") || id.includes("canvg") || id.includes("dompurify")) {
            return "pdf-libs";
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    // Proxy API to FastAPI so the browser uses same-origin `/api/*` (no CORS, works when backend is on :8000)
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
