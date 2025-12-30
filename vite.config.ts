// @ts-nocheck
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  // Default to localhost:3001 if env var is missing
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
          // Ensure we don't strip /api, or if we do, backend handles it.
          // Since backend has app.get('/api/user'), we should preserve it.
          // Vite proxy usually preserves path by default.
          configure: (proxy, options) => {
              proxy.on('error', (err, req, res) => {
                  console.error(`Proxy Error to ${apiUrl}:`, err);
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
          secure: false
        }
      } 
    }
  };
});