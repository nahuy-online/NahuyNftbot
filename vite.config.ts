// @ts-nocheck
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Default to localhost for local dev, or use env var.
// In Docker, you can set VITE_API_TARGET=http://backend:8080
const apiUrl = process.env.VITE_API_TARGET || 'http://localhost:8080';

const proxyConfig = {
  '/api': {
    target: apiUrl,
    changeOrigin: true,
    secure: false,
    configure: (proxy, options) => {
        proxy.on('error', (err, req, res) => {
            console.error("Proxy Connection Error to", apiUrl, ":", err);
        });
    }
  }
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  // Dev server settings
  server: {
    port: 3000,
    host: true,
    proxy: proxyConfig,
    allowedHosts: true
  },
  // Production preview settings (Important for Docker)
  preview: {
    port: 80, // We serve on port 80 in the container
    host: true,
    allowedHosts: true, // Allow dynamic Dockhost domains
    proxy: proxyConfig // Use the same proxy logic
  }
});