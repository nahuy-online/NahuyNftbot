// @ts-nocheck
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true, // Needed for Docker
    proxy: {
      '/api': {
        target: 'http://localhost:8080', // Default to localhost for local dev
        changeOrigin: true,
        secure: false,
        // Fallback for local development (if backend running on localhost)
        configure: (proxy, options) => {
            proxy.on('error', (err, req, res) => {
                console.error("Proxy error:", err);
            });
        }
      }
    }
  }
});