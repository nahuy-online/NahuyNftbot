import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 80;
// Target the backend service defined in docker-compose
const API_TARGET = process.env.VITE_API_TARGET || 'http://backend:3001';

console.log(`[Server] Starting on port ${PORT}...`);
console.log(`[Server] Proxying /api requests to ${API_TARGET}`);

// PROXY CONFIGURATION
// We mount the proxy at '/api'. Express strips '/api' from the req.url before passing it to the middleware.
// We use pathRewrite to add it back so the backend receives the full path (e.g., /api/user).
app.use('/api', createProxyMiddleware({
    target: API_TARGET,
    changeOrigin: true,
    pathRewrite: {
        '^/': '/api/', // Rewrite the root (which is stripped) back to /api/
    },
    onProxyReq: (proxyReq, req, res) => {
        // console.log(`[Proxy] Forwarding ${req.method} ${req.originalUrl} -> ${API_TARGET}/api${req.url}`);
    },
    onError: (err, req, res) => {
        console.error(`[Proxy Error] ${req.method} ${req.originalUrl}: ${err.message}`);
        
        if (!res.headersSent) {
            res.status(502).json({ 
                error: "Proxy Gateway Error", 
                message: "Cannot connect to Backend API",
                details: err.message,
                target: API_TARGET
            });
        }
    }
}));

const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// SPA Fallback
app.get('*', (req, res) => {
    // If it looks like an API call but wasn't caught above, return 404 json
    if (req.url.startsWith('/api')) {
        return res.status(404).json({ error: "API Route Not Found (Frontend)" });
    }
    res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Frontend ready at http://0.0.0.0:${PORT}`);
});