import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 80;
// Fallback to http://backend:3001 if env var is missing in Docker
const API_TARGET = process.env.VITE_API_TARGET || 'http://backend:3001';

console.log(`[Server] Starting on port ${PORT}...`);
console.log(`[Server] Proxying /api requests to ${API_TARGET}`);

// 1. Proxy API requests BEFORE serving static files
app.use('/api', createProxyMiddleware({
    target: API_TARGET,
    changeOrigin: true,
    onProxyReq: (proxyReq, req, res) => {
        // Log proxy attempts to help debugging
        console.log(`[Proxy] ${req.method} ${req.originalUrl} -> ${API_TARGET}${req.originalUrl}`);
    },
    onError: (err, req, res) => {
        console.error('[Proxy Error]', err);
        res.status(502).json({ error: "Proxy Gateway Error", details: err.message });
    }
}));

// 2. Serve static files from the build directory
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// 3. Handle SPA routing: return index.html for any unknown route (except /api)
app.get('*', (req, res) => {
    if (req.url.startsWith('/api')) {
        // Should have been caught by proxy, but just in case
        return res.status(404).json({ error: "API Route Not Found" });
    }
    res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Frontend ready at http://0.0.0.0:${PORT}`);
});