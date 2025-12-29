// @ts-nocheck
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxyConfig = {
  '/api': {
    target: process.env.VITE_API_TARGET || 'http://backend:8080',
    changeOrigin: true,
    secure: false,
    configure: (proxy, options) => {
        proxy.on('error', (err, req, res) => {
            console.error("Proxy error:", err);
        });
    }
  }
};

export default defineConfig({
  plugins: [react()],
  // Dev server settings
  server: {
    port: 3000,
    host: true,
    proxy: proxyConfig
  },
  // Production preview settings (Important for Docker)
  preview: {
    port: 80, // We serve on port 80 in the container
    host: true,
    proxy: proxyConfig // Use the same proxy logic
  }
});