import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 80;
const API_TARGET = process.env.VITE_API_TARGET || 'http://backend:3001';

console.log(`[Server] Starting on port ${PORT}...`);
console.log(`[Server] Proxying /api requests to ${API_TARGET}`);

app.use('/api', createProxyMiddleware({
    target: API_TARGET,
    changeOrigin: true,
    onProxyReq: (proxyReq, req, res) => {
        // console.log(`[Proxy] ${req.method} ${req.originalUrl}`);
    },
    onError: (err, req, res) => {
        console.error('[Proxy Error]', err);
        // Return 502 with details to the client
        res.status(502).json({ 
            error: "Proxy Gateway Error", 
            message: "Cannot connect to Backend API",
            details: err.message,
            code: err.code 
        });
    }
}));

const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

app.get('*', (req, res) => {
    if (req.url.startsWith('/api')) {
        return res.status(404).json({ error: "API Route Not Found" });
    }
    res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Frontend ready at http://0.0.0.0:${PORT}`);
});