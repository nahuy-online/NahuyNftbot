import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 80;
// Ensure we point to the docker service name 'backend' and port 3001
const API_TARGET = process.env.VITE_API_TARGET || 'http://backend:3001';

console.log(`[Server] Starting on port ${PORT}...`);
console.log(`[Server] Proxying /api requests to ${API_TARGET}`);

// PROXY CONFIGURATION
// We mount at '/api' so Express handles routing.
// We use pathRewrite to ensure the '/api' prefix is preserved when sending to backend.
// Express strips '/api' from req.url, so we prepend it back.
app.use('/api', createProxyMiddleware({
    target: API_TARGET,
    changeOrigin: true,
    pathRewrite: {
        '^/': '/api/', // Rewrite root of mounted path back to /api/
    },
    onProxyReq: (proxyReq, req, res) => {
        // Optional: Log proxy requests for debugging
        // console.log(`[Proxy] ${req.method} ${req.url} -> ${API_TARGET}/api${req.url}`);
    },
    onError: (err, req, res) => {
        console.error(`[Proxy Error] ${req.method} ${req.url}: ${err.message}`);
        
        // Prevent sending headers if already sent
        if (!res.headersSent) {
            res.status(502).json({ 
                error: "Proxy Gateway Error", 
                message: "Cannot connect to Backend API",
                details: err.message,
                code: err.code,
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
        return res.status(404).json({ error: "API Route Not Found" });
    }
    res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Frontend ready at http://0.0.0.0:${PORT}`);
});