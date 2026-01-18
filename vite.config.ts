import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';

// Simulate __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Cast process to any to avoid TS error 'Property cwd does not exist on type Process'
  const env = loadEnv(mode, (process as any).cwd(), '');

  // PRIORITIZE Docker/System Environment Variable over .env file
  // Default to localhost for local dev if not set
  const apiTarget = process.env.VITE_API_TARGET || env.VITE_API_TARGET || 'http://localhost:8080';

  console.log(`[Vite] Proxying /api requests to: ${apiTarget}`);

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
    // Production preview settings
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