// @ts-nocheck
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '');

  // Use VITE_API_TARGET if provided (Docker), otherwise localhost (Dev)
  const apiTarget = process.env.VITE_API_TARGET || env.VITE_API_TARGET || 'http://localhost:8080';

  console.log(`[Vite Proxy] Forwarding /api requests to: ${apiTarget}`);

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './'),
      },
    },
    // Dev server settings (npm run dev)
    server: {
      port: 3000,
      host: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        }
      },
      allowedHosts: true
    },
    // Production preview settings (Docker / npm run preview)
    preview: {
      port: 80, 
      host: true,
      allowedHosts: true, 
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        }
      }
    }
  };
});
