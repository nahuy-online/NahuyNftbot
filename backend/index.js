
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'pg';
const { Pool } = pkg;
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { TonClient, Address } from '@ton/ton';

process.on('uncaughtException', (err) => console.error('💥 UNCAUGHT EXCEPTION:', err));
process.on('unhandledRejection', (reason, promise) => console.error('💥 UNHANDLED REJECTION:', reason));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config(); 

const app = express();
app.use(express.json());
// Allow CORS for all origins in this demo setup to ensure frontend works seamlessly
app.use(cors());
app.set('trust proxy', true);

// --- STATIC FRONTEND SERVING (Monolith Setup) ---
// Serve static files from the 'dist' directory built by Vite
app.use(express.static(path.resolve(__dirname, '../dist')));

// --- CONFIG ---
const PORT = parseInt(process.env.PORT || '8080', 10);
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
const RECEIVER_ADDRESS = process.env.RECEIVER_ADDRESS || 'UQD__________________________________________'; // PUT YOUR WALLET HERE
const TON_ENDPOINT = process.env.TON_ENDPOINT || 'https://toncenter.com/api/v2/json';
const TON_API_KEY = process.env.TON_API_KEY || ''; // Optional but recommended

// --- TON CLIENT ---
const tonClient = new TonClient({ 
    endpoint: TON_ENDPOINT, 
    apiKey: TON_API_KEY 
});

// --- DB CONFIGURATION (RENDER COMPATIBLE) ---
const getDbConfig = () => {
    // If DATABASE_URL is provided (Render/Heroku/Cloud), use it
    if (process.env.DATABASE_URL) {
        return {
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }, // Required for Render Postgres
            connectionTimeoutMillis: 5000,
        };
    }

    // Fallback to individual params (Local/Docker)
    return {
        user: process.env.DB_USER || 'user',
        password: process.env.DB_PASSWORD || 'pass',
        database: process.env.DB_NAME || 'nft_db',
        host: process.env.DB_HOST || 'localhost', 
        port: parseInt(process.env.DB_PORT || '5432'),
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
        connectionTimeoutMillis: 5000, 
    };
};

const pool = new Pool(getDbConfig());

// --- HEALTH CHECK ---
app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/api/health', (req, res) => res.status(200).send('OK'));

// --- DB INIT ---
const initDB = async () => {
    console.log(`[DB] Attempting connection to ${process.env.DATABASE_URL ? 'Cloud DB (URL masked)' : (process.env.DB_HOST || 'localhost')}...`);
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        
        // Users Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id BIGINT PRIMARY KEY,
                username TEXT,
                referral_code TEXT UNIQUE,
                referrer_id BIGINT,
                ip_address TEXT,
                joined_at TIMESTAMP DEFAULT NOW(),
                last_active TIMESTAMP DEFAULT NOW(),
                nft_total INTEGER DEFAULT 0,
                nft_available INTEGER DEFAULT 0,
                nft_locked INTEGER DEFAULT 0,
                dice_available INTEGER DEFAULT 2,
                dice_stars_attempts INTEGER DEFAULT 0,
                ref_rewards_ton NUMERIC(10, 4) DEFAULT 0,
                ref_rewards_usdt NUMERIC(10, 4) DEFAULT 0,
                ref_rewards_stars INTEGER DEFAULT 0
            );
        `);
        
        // User NFTs (Specific items)
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_nfts (
                serial_number INTEGER PRIMARY KEY,
                user_id BIGINT REFERENCES users(id),
                is_locked BOOLEAN DEFAULT FALSE,
                unlock_date BIGINT DEFAULT 0,
                is_withdrawn BOOLEAN DEFAULT FALSE,
                is_seized BOOLEAN DEFAULT FALSE,
                source TEXT
            );
        `);

        // Transactions
        await client.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                user_id BIGINT REFERENCES users(id),
                type TEXT NOT NULL,
                asset_type TEXT NOT NULL,
                amount NUMERIC(10, 4) NOT NULL,
                currency TEXT,
                description TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                is_locked BOOLEAN DEFAULT FALSE,
                serials JSONB DEFAULT '[]'::jsonb,
                tx_hash TEXT UNIQUE 
            );
        `);
        
        // Indices for performance
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_referrer ON users(referrer_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_nfts_user ON user_nfts(user_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_tx_hash ON transactions(tx_hash)`);

        await client.query('COMMIT');
        console.log("✅ Database initialized successfully");
    } catch (e) {
        if (client) await client.query('ROLLBACK');
        console.error("❌ DB Init failed. Is the database running and credentials correct?");
        console.error(`Error details: ${e.message}`);
        // Do not exit process, let the health check live so logs can be read
    } finally {
        if (client) client.release();
    }
};
initDB();

// --- SECURITY MIDDLEWARE ---
const validateTelegramData = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('tma ')) {
        // STRICTER: Only allow bypass if explicitly locally testing, otherwise strict
        if (process.env.NODE_ENV === 'development' && !process.env.STRICT_AUTH) {
            req.user = { id: req.body.id || 99999, username: 'DevUser' };
            return next();
        }
        return res.status(401).json({ error: 'Missing Authorization header. Please open in Telegram.' });
    }

    const initData = authHeader.split(' ')[1];
    try {
        const urlParams = new URLSearchParams(initData);
        const hash = urlParams.get('hash');
        urlParams.delete('hash');
        
        const params = Array.from(urlParams.entries());
        params.sort((a, b) => a[0].localeCompare(b[0]));
        const dataCheckString = params.map(([key, value]) => `${key}=${value}`).join('\n');

        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (calculatedHash !== hash) return res.status(403).json({ error: 'Integrity check failed' });

        const userStr = urlParams.get('user');
        if (!userStr) return res.status(400).json({ error: 'No user data' });
        
        const authDate = parseInt(urlParams.get('auth_date') || '0');
        if ((Date.now() / 1000) - authDate > 86400) return res.status(403).json({ error: 'Session expired' });

        req.user = JSON.parse(userStr);
        next();
    } catch (e) {
        return res.status(500).json({ error: 'Auth Verification Failed' });
    }
};

const isAdmin = (req, res, next) => {
    if (ADMIN_IDS.includes(req.user.id)) return next();
    res.status(403).json({ error: 'Admin access required' });
};

// --- HELPERS ---
async function reserveNfts(client, userId, quantity, isLocked, source) {
    await client.query('LOCK TABLE user_nfts IN EXCLUSIVE MODE');
    const maxRes = await client.query('SELECT MAX(serial_number) as max_sn FROM user_nfts');
    let startSn = (parseInt(maxRes.rows[0]?.max_sn) || 0) + 1;
    const unlockDate = isLocked ? Date.now() + (21 * 86400000) : 0;
    const serialList = [];
    for (let i = 0; i < quantity; i++) {
        const sn = startSn + i;
        serialList.push(sn);
        await client.query(
            `INSERT INTO user_nfts (serial_number, user_id, is_locked, unlock_date, source) VALUES ($1, $2, $3, $4, $5)`,
            [sn, userId, isLocked, unlockDate, source]
        );
    }
    return serialList;
}

// --- API ROUTES ---

// 1. AUTH
app.post('/api/auth', validateTelegramData, async (req, res) => {
    const id = req.user.id;
    const username = req.user.username || 'Anon';
    const { startParam } = req.body;
    const ip = req.ip || req.socket.remoteAddress;

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        let resUser = await client.query('SELECT * FROM users WHERE id = $1', [id]);
        let user = resUser.rows[0];
        let isNew = false;

        if (!user) {
            isNew = true;
            const code = 'ref_' + crypto.randomBytes(4).toString('hex');
            let referrerId = null;
            
            if (startParam && startParam.startsWith('ref_')) {
                 const refCheck = await client.query('SELECT id FROM users WHERE referral_code = $1', [startParam]);
                 if (refCheck.rows.length > 0 && refCheck.rows[0].id !== id) {
                     referrerId = refCheck.rows[0].id;
                 }
            } else if (startParam && startParam.startsWith('ref_') === false && !isNaN(parseInt(startParam))) {
                 const refIdInt = parseInt(startParam);
                 if (refIdInt !== id) referrerId = refIdInt;
            }

            await client.query(
                'INSERT INTO users (id, username, referral_code, ip_address, referrer_id) VALUES ($1, $2, $3, $4, $5)', 
                [id, username, code, ip, referrerId]
            );
            resUser = await client.query('SELECT * FROM users WHERE id = $1', [id]);
            user = resUser.rows[0];
        } else {
            await client.query('UPDATE users SET last_active = NOW(), ip_address = $1, username = $2 WHERE id = $3', [ip, username, id]);
        }

        await client.query('COMMIT');

        // Fetch Stats
        const locks = await client.query(`
            SELECT COUNT(*) as amount, unlock_date, is_seized, array_agg(serial_number) as serials 
            FROM user_nfts WHERE user_id = $1 AND is_locked = TRUE AND is_withdrawn = FALSE GROUP BY unlock_date, is_seized
        `, [id]);
        
        // Active Serials (Owned)
        const serials = await client.query(`
            SELECT serial_number FROM user_nfts WHERE user_id = $1 AND is_withdrawn = FALSE AND is_seized = FALSE ORDER BY serial_number DESC LIMIT 500
        `, [id]);

        // Withdrawn Serials (New)
        const withdrawnSerials = await client.query(`
            SELECT serial_number FROM user_nfts WHERE user_id = $1 AND is_withdrawn = TRUE ORDER BY serial_number DESC LIMIT 500
        `, [id]);
        
        const withdrawnCount = parseInt(withdrawnSerials.rowCount || '0');

        const refCounts = await client.query(`SELECT COUNT(*) FROM users WHERE referrer_id = $1`, [id]);

        res.json({
            id: String(user.id),
            username: user.username,
            isAdmin: ADMIN_IDS.includes(parseInt(id)),
            isNewUser: isNew,
            referralCode: user.referral_code,
            nftBalance: {
                total: user.nft_total,
                available: user.nft_available,
                locked: user.nft_locked,
                lockedDetails: locks.rows.map(r => ({ amount: parseInt(r.amount), unlockDate: parseInt(r.unlock_date), serials: r.serials || [], isSeized: r.is_seized })),
                withdrawn: withdrawnCount
            },
            reservedSerials: serials.rows.map(r => parseInt(r.serial_number)),
            withdrawnSerials: withdrawnSerials.rows.map(r => parseInt(r.serial_number)),
            diceBalance: { available: user.dice_available, starsAttempts: user.dice_stars_attempts },
            referralStats: {
                level1: parseInt(refCounts.rows[0].count),
                level2: 0, level3: 0,
                bonusBalance: { STARS: user.ref_rewards_stars, TON: parseFloat(user.ref_rewards_ton), USDT: parseFloat(user.ref_rewards_usdt) }
            }
        });

    } catch (e) {
        if (client) await client.query('ROLLBACK');
        console.error("Auth Error:", e.message); 
        res.status(500).json({ error: `Database Error: ${e.message}` });
    } finally {
        if (client) client.release();
    }
});

// 2. PAYMENTS
app.post('/api/payment/create', validateTelegramData, (req, res) => {
    const { type, amount, currency } = req.body;
    const uniqueId = crypto.randomBytes(3).toString('hex');
    const comment = `buy:${req.user.id}:${type}:${amount}:${uniqueId}`;
    
    res.json({
        ok: true,
        currency,
        transaction: {
            validUntil: Math.floor(Date.now() / 1000) + 600, 
            messages: [{
                address: RECEIVER_ADDRESS,
                amount: "0", 
                payload: comment 
            }]
        },
        internalId: comment
    });
});

app.post('/api/payment/verify', validateTelegramData, async (req, res) => {
    const userId = req.user.id;
    const { type, amount, currency, useRewardBalance } = req.body; 
    let client;

    try {
        client = await pool.connect();
        await client.query('BEGIN');

        if (useRewardBalance) {
             const userRes = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
             // ... logic for deducting balance ...
        }

        let grantedCount = 0;
        let assetName = 'items';
        let wonSerials = [];
        const isLocked = (currency === 'STARS');

        if (type === 'nft') {
            grantedCount = amount; 
            assetName = 'NFTs';
            wonSerials = await reserveNfts(client, userId, grantedCount, isLocked, 'purchase');
            
            const field = isLocked ? 'nft_locked' : 'nft_available';
            await client.query(`UPDATE users SET nft_total = nft_total + $1, ${field} = ${field} + $1 WHERE id = $2`, [grantedCount, userId]);
        } else {
            grantedCount = amount;
            assetName = 'Dice Attempts';
            await client.query(`UPDATE users SET dice_available = dice_available + $1, dice_stars_attempts = dice_stars_attempts + $2 WHERE id = $3`, 
                [grantedCount, isLocked ? grantedCount : 0, userId]);
        }

        await client.query(`
            INSERT INTO transactions (user_id, type, asset_type, amount, currency, description, is_locked, serials)
            VALUES ($1, 'purchase', $2, $3, $4, $5, $6, $7)
        `, [userId, type, grantedCount, currency, `Purchased ${grantedCount} ${assetName}`, isLocked, JSON.stringify(wonSerials)]);

        await client.query('COMMIT');
        res.json({ ok: true });

    } catch (e) {
        if(client) await client.query('ROLLBACK');
        console.error("Verify Error", e);
        res.status(500).json({ error: e.message });
    } finally {
        if(client) client.release();
    }
});

// 3. GAME
app.post('/api/roll', validateTelegramData, async (req, res) => {
    const userId = req.user.id;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const userRes = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
        const user = userRes.rows[0];
        
        if (!user || user.dice_available <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No attempts left' });
        }

        const isStarsRun = user.dice_stars_attempts > 0;
        const roll = crypto.randomInt(1, 7); 
        
        let q = `UPDATE users SET dice_available = dice_available - 1`;
        if (isStarsRun) q += `, dice_stars_attempts = dice_stars_attempts - 1`;
        
        let wonSerials = [];
        if (roll > 0) { 
            wonSerials = await reserveNfts(client, userId, roll, isStarsRun, 'dice');
            const field = isStarsRun ? 'nft_locked' : 'nft_available';
            q += `, nft_total = nft_total + ${roll}, ${field} = ${field} + ${roll}`;
        }
        
        q += ` WHERE id = $1`;
        await client.query(q, [userId]);
        
        await client.query(`
            INSERT INTO transactions (user_id, type, asset_type, amount, description, is_locked, serials)
            VALUES ($1, 'win', 'nft', $2, $3, $4, $5)
        `, [userId, roll, `Rolled ${roll}`, isStarsRun, JSON.stringify(wonSerials)]);

        await client.query('COMMIT');
        res.json({ roll, wonSerials });
    } catch (e) {
        if(client) await client.query('ROLLBACK');
        res.status(500).json({ error: "Roll failed" });
    } finally {
        if(client) client.release();
    }
});

app.get('/api/history', validateTelegramData, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
        res.json(result.rows.map(x => ({
            id: x.id, type: x.type, amount: parseFloat(x.amount), description: x.description,
            timestamp: new Date(x.created_at).getTime(), currency: x.currency, assetType: x.asset_type,
            isLocked: x.is_locked, serials: x.serials
        })));
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/withdraw', validateTelegramData, async (req, res) => {
    const userId = req.user.id;
    const { address } = req.body;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const userRes = await client.query('SELECT nft_available FROM users WHERE id = $1 FOR UPDATE', [userId]);
        const available = userRes.rows[0].nft_available;
        if (available <= 0) throw new Error("No funds");
        
        // Find serials to withdraw (FIFO or simple available ones)
        const serialsRes = await client.query(`
            SELECT serial_number FROM user_nfts 
            WHERE user_id = $1 AND is_withdrawn = FALSE AND is_locked = FALSE 
            ORDER BY serial_number ASC LIMIT $2
        `, [userId, available]);
        const serials = serialsRes.rows.map(r => r.serial_number);

        await client.query(`UPDATE user_nfts SET is_withdrawn = TRUE WHERE serial_number = ANY($1::int[])`, [serials]);
        await client.query('UPDATE users SET nft_available = 0 WHERE id = $1', [userId]);
        
        await client.query('INSERT INTO transactions (user_id, type, asset_type, amount, description, serials) VALUES ($1, \'withdraw\', \'nft\', $2, $3, $4)', 
            [userId, available, `Withdraw to ${address}`, JSON.stringify(serials)]);
        
        await client.query('COMMIT');
        res.json({ ok: true });
    } catch (e) {
        if(client) await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally { if(client) client.release(); }
});

// 4. ADMIN
app.post('/api/admin/stats', validateTelegramData, isAdmin, async (req, res) => {
    try {
        const users = await pool.query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE nft_total > 0) as active FROM users');
        const sold = await pool.query('SELECT SUM(amount) FROM transactions WHERE type = \'purchase\' AND asset_type = \'nft\'');
        const dice = await pool.query('SELECT COUNT(*) as plays, SUM(amount) as won FROM transactions WHERE type = \'win\'');
        
        res.json({
            totalUsers: parseInt(users.rows[0].total),
            activeUsers: parseInt(users.rows[0].active),
            totalNftSold: parseInt(sold.rows[0].sum || 0),
            totalDicePlays: parseInt(dice.rows[0].plays),
            totalNftWonInDice: parseInt(dice.rows[0].won || 0),
            revenue: { TON: 0, USDT: 0, STARS: 0 }, 
            bonusStats: { earned: { TON: 0, STARS: 0, USDT: 0 }, spent: { TON: 0, STARS: 0, USDT: 0 } },
            recentTransactions: []
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users', validateTelegramData, isAdmin, async (req, res) => {
    const { limit, offset, sortBy, sortOrder } = req.body;
    const order = sortOrder === 'asc' ? 'ASC' : 'DESC';
    let orderBy = 'joined_at'; 
    if(sortBy === 'nft_total') orderBy = 'nft_total';
    
    const result = await pool.query(`SELECT * FROM users ORDER BY ${orderBy} ${order} LIMIT $1 OFFSET $2`, [limit, offset]);
    res.json({
        users: result.rows.map(u => ({
            id: u.id, username: u.username, joinedAt: new Date(u.joined_at).getTime(),
            nftTotal: u.nft_total, lastActive: new Date(u.last_active).getTime(),
            level1: 0 
        })),
        hasMore: result.rows.length === limit
    });
});

app.post('/api/admin/search', validateTelegramData, isAdmin, async (req, res) => {
    const { targetId } = req.body;
    const resUser = await pool.query('SELECT * FROM users WHERE id = $1', [targetId]);
    if (resUser.rows.length === 0) return res.json({ found: false });
    const u = resUser.rows[0];
    const tx = await pool.query('SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10', [targetId]);
    res.json({
        found: true,
        user: {
            id: u.id, username: u.username, nftTotal: u.nft_total, nftAvailable: u.nft_available, diceAvailable: u.dice_available,
            transactions: tx.rows.map(x => ({ id: x.id, type: x.type, amount: parseFloat(x.amount), description: x.description, serials: x.serials }))
        }
    });
});

app.post('/api/debug/seize', validateTelegramData, isAdmin, async (req, res) => {
    res.json({ ok: true, message: 'Implemented in next update' });
});

app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../dist/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
