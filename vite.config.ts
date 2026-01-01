// @ts-nocheck
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '');

  // PRIORITIZE Docker Environment Variable (process.env) over .env file (env)
  // Check if process.env.VITE_API_TARGET is actually defined and not empty string
  let apiTarget = process.env.VITE_API_TARGET;
  
  if (!apiTarget) {
     apiTarget = env.VITE_API_TARGET;
  }
  
  // Default fallback
  if (!apiTarget) {
      apiTarget = 'http://localhost:8080';
  }

  console.log(`[Config] Raw process.env.VITE_API_TARGET: '${process.env.VITE_API_TARGET}'`);
  console.log(`[Config] .env file VITE_API_TARGET: '${env.VITE_API_TARGET}'`);
  console.log(`[Vite Proxy] Final /api forwarding target: ${apiTarget}`);

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
          // Handle proxy errors to prevent generic 500s masking the issue
          configure: (proxy, options) => {
            proxy.on('error', (err, _req, _res) => {
              console.log('[Proxy Error] Connecting to backend:', err);
            });
          }
        }
      }
    }
  };
});