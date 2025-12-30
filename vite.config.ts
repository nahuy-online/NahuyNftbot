// @ts-nocheck
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Default to localhost:3001 for local dev.
// In Docker, VITE_API_TARGET should be set to http://backend:3001
const apiUrl = process.env.VITE_API_TARGET || 'http://localhost:3001';

console.log(`Using API Proxy Target: ${apiUrl}`);

const proxyConfig = {
  '/api': {
    target: apiUrl,
    changeOrigin: true,
    secure: false,
    configure: (proxy, options) => {
        proxy.on('error', (err, req, res) => {
            console.error(`Proxy Connection Error to ${apiUrl} for ${req.url}:`, err);
            // Send a response to the client so it doesn't fall through to static 404
            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Proxy Error", details: err.message }));
            }
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
    proxy: proxyConfig
  },
  // Production preview settings (Important for Docker)
  preview: {
    port: 80, // We serve on port 80 in the container
    host: true,
    proxy: proxyConfig 
  }
});