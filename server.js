import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 80;
// Default to localhost for local runs, or use env var for Docker
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:3001';

console.log(`[Server] Starting on port ${PORT}...`);
console.log(`[Server] Proxying /api requests to ${API_TARGET}`);

// PROXY CONFIGURATION
// Mount at /api. 
// We use pathRewrite to ensure the /api prefix is preserved if the backend expects it,
// OR we rely on the backend handling the stripped path.
// Based on your backend config, it handles both /api/user and /user.
// We will send the path as-is (rewriting root of mount point to /api/) to be safe.
app.use('/api', createProxyMiddleware({
    target: API_TARGET,
    changeOrigin: true,
    pathRewrite: {
        '^/': '/api/' // Ensures backend receives /api/user when frontend requests /api/user
    },
    onProxyReq: (proxyReq, req, res) => {
        // console.log(`[Proxy] ${req.method} ${req.originalUrl} -> ${API_TARGET}${req.path}`);
    },
    onError: (err, req, res) => {
        console.error(`[Proxy Error] ${req.method} ${req.originalUrl}: ${err.message}`);
        if (!res.headersSent) {
            res.status(502).json({ 
                error: "Proxy Gateway Error", 
                message: `Cannot connect to Backend at ${API_TARGET}`,
                details: err.message
            });
        }
    }
}));

const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// SPA Fallback
app.get('*', (req, res) => {
    if (req.url.startsWith('/api')) {
        return res.status(404).json({ error: "API Route Not Found" });
    }
    res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Frontend ready at http://0.0.0.0:${PORT}`);
});