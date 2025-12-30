import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 80;

// Default to 'http://backend:3001' for Docker environments.
// For local development using 'npm start', set VITE_API_TARGET=http://localhost:3001
const API_TARGET = process.env.VITE_API_TARGET || 'http://backend:3001';

console.log(`[Server] Starting on port ${PORT}...`);
console.log(`[Server] Proxying /api requests to ${API_TARGET}`);

// PROXY CONFIGURATION
// Use context matching: createProxyMiddleware(context, options)
// This mounts the middleware at root, but only activates for paths starting with '/api'.
// Crucially, it PRESERVES the path. Request '/api/user' -> Backend receives '/api/user'.
// This avoids Express's default behavior of stripping the mount path.
const apiProxy = createProxyMiddleware('/api', {
    target: API_TARGET,
    changeOrigin: true,
    onProxyReq: (proxyReq, req, res) => {
        // console.log(`[Proxy] ${req.method} ${req.url} -> ${API_TARGET}${req.url}`);
    },
    onError: (err, req, res) => {
        console.error(`[Proxy Error] ${req.method} ${req.url}: ${err.message}`);
        if (!res.headersSent) {
            res.status(502).json({ 
                error: "Backend Connection Failed", 
                message: `Could not connect to backend at ${API_TARGET}`,
                details: err.message
            });
        }
    }
});

app.use(apiProxy);

const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// SPA Fallback
app.get('*', (req, res) => {
    // If request starts with /api but wasn't handled by proxy (shouldn't happen if proxy matches /api), return 404
    if (req.url.startsWith('/api')) {
        return res.status(404).json({ error: "API Endpoint Not Found" });
    }
    // Otherwise serve index.html for client-side routing
    res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Frontend ready at http://0.0.0.0:${PORT}`);
});