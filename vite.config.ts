// @ts-nocheck
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  // CRITICAL: process.env.VITE_API_TARGET must be checked first for Docker runtime injection
  const apiUrl = process.env.VITE_API_TARGET || env.VITE_API_TARGET || 'http://localhost:3001';

  console.log(`[Vite Config] Proxying /api requests to: ${apiUrl}`);

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './'),
      },
    },
    server: {
      port: 3000,
      host: true,
      proxy: {
        '/api': {
          target: apiUrl,
          changeOrigin: true,
          secure: false,
          configure: (proxy, options) => {
              proxy.on('error', (err, req, res) => {
                  console.error(`Proxy Connection Error to ${apiUrl} for ${req.url}:`, err);
                  if (!res.headersSent) {
                      res.writeHead(502, { 'Content-Type': 'application/json' });
                      res.end(JSON.stringify({ error: "Proxy Error", details: err.message }));
                  }
              });
          }
        }
      }
    },
    preview: {
      port: 80,
      host: true,
      proxy: {
        '/api': {
          target: apiUrl,
          changeOrigin: true,
          secure: false,
          configure: (proxy, options) => {
              proxy.on('error', (err, req, res) => {
                  console.error(`Proxy Connection Error to ${apiUrl} for ${req.url}:`, err);
                  if (!res.headersSent) {
                      res.writeHead(502, { 'Content-Type': 'application/json' });
                      res.end(JSON.stringify({ error: "Proxy Error", details: err.message }));
                  }
              });
          }
        }
      } 
    }
  };
});