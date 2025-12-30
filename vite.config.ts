// @ts-nocheck
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '');
  
  // Default to localhost:3001 for local dev.
  // In Docker, VITE_API_TARGET should be set to http://backend:3001
  const apiUrl = env.VITE_API_TARGET || 'http://localhost:3001';

  console.log(`Using API Proxy Target: ${apiUrl}`);

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