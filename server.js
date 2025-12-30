import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 80;
// Target the backend service. Default to docker service name 'backend'
const API_TARGET = process.env.VITE_API_TARGET || 'http://backend:3001';

console.log(`[Server] Starting on port ${PORT}...`);
console.log(`[Server] Proxying /api requests to ${API_TARGET}`);

// PROXY CONFIGURATION
// Mount the proxy middleware at '/api'.
// Express strips the '/api' prefix from req.url before passing it to the middleware.
// We use pathRewrite to prepend '/api' so the backend receives the full intended path.
app.use('/api', createProxyMiddleware({
    target: API_TARGET,
    changeOrigin: true,
    pathRewrite: {
        '^/': '/api/' // Rewrite the root (which is effectively /api/ from client view) back to /api/
    },
    onProxyReq: (proxyReq, req, res) => {
        // console.log(`[Proxy] Forwarding ${req.method} ${req.originalUrl} -> ${API_TARGET}/api${req.url}`);
    },
    onError: (err, req, res) => {
        console.error(`[Proxy Error] ${req.method} ${req.originalUrl}: ${err.message}`);
        
        if (!res.headersSent) {
            res.status(502).json({ 
                error: "Proxy Gateway Error", 
                message: "Cannot connect to Backend API. Ensure backend service is running.",
                details: err.message,
                target: API_TARGET
            });
        }
    }
}));

const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// SPA Fallback for non-API routes
app.get('*', (req, res) => {
    // If it looks like an API call but wasn't caught above, return 404 json
    if (req.url.startsWith('/api')) {
        return res.status(404).json({ error: "API Route Not Found (Frontend)" });
    }
    
    // Check if index.html exists before trying to send it to avoid "Error: ENOENT" or similar
    // causing confusing 404s
    res.sendFile(path.join(distPath, 'index.html'), (err) => {
        if (err) {
            console.error("[Server] Error sending index.html:", err);
            res.status(500).send("Server Error: Unable to load application.");
        }
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Frontend ready at http://0.0.0.0:${PORT}`);
});