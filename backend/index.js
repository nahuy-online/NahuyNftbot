
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import pkg from 'pg';
const { Pool } = pkg;
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

process.on('uncaughtException', (err) => {
    console.error('💥 UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 UNHANDLED REJECTION:', reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config(); 

const app = express();
app.use(express.json());
app.use(cors());
app.set('trust proxy', true);

const PORT = parseInt(process.env.PORT || '8080', 10);
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = "https://t.me/nahuy_NFT_bot/start"; 
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

const pool = new Pool({
    user: process.env.DB_USER || 'user',
    password: process.env.DB_PASSWORD || 'pass',
    database: process.env.DB_NAME || 'nft_db',
    host: process.env.DB_HOST || 'localhost', 
    port: parseInt(process.env.DB_PORT || '5432'),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 5000, 
});

pool.on('error', (err) => console.error('🔴 Unexpected DB Client Error', err));
BigInt.prototype.toJSON = function() { return this.toString(); };

// --- SECURITY MIDDLEWARE ---
const validateTelegramData = (req, res, next) => {
    // 1. Check if Authorization header exists
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('tma ')) {
        // DEV MODE: Allow bypass if explicitly enabled and no auth header
        if (process.env.NODE_ENV === 'development') {
            req.user = { id: req.body.id || 99999, username: 'DevUser' };
            return next();
        }
        return res.status(401).json({ error: 'Missing Authorization header' });
    }

    const initData = authHeader.split(' ')[1];
    if (!initData) return res.status(401).json({ error: 'Empty initData' });

    try {
        // 2. Parse initData
        const urlParams = new URLSearchParams(initData);
        const hash = urlParams.get('hash');
        urlParams.delete('hash');
        
        // 3. Sort keys alphabetically
        const params = Array.from(urlParams.entries());
        params.sort((a, b) => a[0].localeCompare(b[0]));
        const dataCheckString = params.map(([key, value]) => `${key}=${value}`).join('\n');

        // 4. Validate Hash
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (calculatedHash !== hash) {
            return res.status(403).json({ error: 'Invalid Hash. Data integrity check failed.' });
        }

        // 5. Extract User
        const userStr = urlParams.get('user');
        if (!userStr) return res.status(400).json({ error: 'No user data' });
        
        const telegramUser = JSON.parse(userStr);
        
        // 6. Check Auth Date (Prevent Replay Attacks) - 24 hours expiry
        const authDate = parseInt(urlParams.get('auth_date') || '0');
        const now = Math.floor(Date.now() / 1000);
        if (now - authDate > 86400) {
            return res.status(403).json({ error: 'InitData expired' });
        }

        // Attach verified user to request
        req.user = telegramUser;
        next();
    } catch (e) {
        console.error("Auth Error:", e);
        return res.status(500).json({ error: 'Auth Verification Failed' });
    }
};

// --- DB HELPERS ---
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

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', secured: true });
});

// AUTH
app.post('/api/auth', validateTelegramData, async (req, res) => {
    let client;
    try {
        const id = req.user.id; // TRUSTED ID
        const username = req.user.username || 'Anon';
        const { startParam } = req.body;
        
        // Capture IP
        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        client = await pool.connect();
        await client.query('BEGIN');

        let resUser = await client.query('SELECT * FROM users WHERE id = $1', [id]);
        let user = resUser.rows[0];
        let isNew = false;

        if (!user) {
            isNew = true;
            const code = 'ref_' + crypto.randomBytes(4).toString('hex');
            await client.query('INSERT INTO users (id, username, referral_code, ip_address) VALUES ($1, $2, $3, $4)', [id, username, code, ip]);
            resUser = await client.query('SELECT * FROM users WHERE id = $1', [id]);
            user = resUser.rows[0];
        } else {
            await client.query('UPDATE users SET last_active = NOW(), ip_address = $1 WHERE id = $2', [ip, id]);
        }
        
        // Basic referrer binding logic (simplified)
        if (!user.referrer_id && startParam && startParam !== 'none') {
             // ... (Binding logic same as before, omitted for brevity) ...
        }

        await client.query('COMMIT');
        
        // Fetch complex stats (Balance, Referrals, etc)
        const locks = await client.query(`
            SELECT COUNT(*) as amount, unlock_date, is_seized, array_agg(serial_number) as serials 
            FROM user_nfts 
            WHERE user_id = $1 AND is_locked = TRUE AND is_withdrawn = FALSE 
            GROUP BY unlock_date, is_seized
        `, [id]);
        
        const serials = await client.query(`
            SELECT serial_number FROM user_nfts WHERE user_id = $1 AND is_withdrawn = FALSE AND is_seized = FALSE ORDER BY serial_number DESC LIMIT 500
        `, [id]);

        const l1 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id = $1', [id]);

        res.json({
            id: String(user.id),
            username: user.username,
            isAdmin: ADMIN_IDS.includes(parseInt(id)),
            referralCode: user.referral_code,
            isNewUser: isNew,
            nftBalance: {
                total: user.nft_total || 0,
                available: user.nft_available || 0,
                locked: user.nft_locked || 0,
                lockedDetails: locks.rows.map(r => ({ 
                    amount: parseInt(r.amount), unlockDate: parseInt(r.unlock_date), serials: r.serials || [], isSeized: r.is_seized || false 
                }))
            },
            reservedSerials: serials.rows.map(r => parseInt(r.serial_number)),
            diceBalance: { available: user.dice_available || 0, starsAttempts: user.dice_stars_attempts || 0 },
            referralStats: {
                level1: parseInt(l1.rows[0].count),
                level2: 0, level3: 0,
                bonusBalance: { STARS: user.ref_rewards_stars || 0, TON: parseFloat(user.ref_rewards_ton || 0), USDT: parseFloat(user.ref_rewards_usdt || 0) }
            }
        });

    } catch (e) {
        if(client) await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally {
        if(client) client.release();
    }
});

// HISTORY
app.get('/api/history', validateTelegramData, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
        res.json(result.rows.map(x => ({
            id: x.id, type: x.type, amount: parseFloat(x.amount), description: x.description,
            timestamp: new Date(x.created_at).getTime(), currency: x.currency, assetType: x.asset_type,
            isLocked: x.is_locked, serials: x.serials
        })));
    } catch(e) { res.status(500).json({ error: e.message }); }
    finally { if(client) client.release(); }
});

// ROLL DICE
app.post('/api/roll', validateTelegramData, async (req, res) => {
    const userId = req.user.id;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // 1. Lock User Row
        const userRes = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
        const user = userRes.rows[0];
        
        if (!user || user.dice_available <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No attempts left' });
        }

        // 2. Logic
        const isStarsRun = user.dice_stars_attempts > 0;
        const roll = Math.floor(Math.random() * 6) + 1; // 1-6
        
        // 3. Update Balance
        let q = `UPDATE users SET dice_available = dice_available - 1`;
        if (isStarsRun) q += `, dice_stars_attempts = dice_stars_attempts - 1`;
        
        let wonSerials = [];
        let winLog = `Rolled ${roll}`;
        
        if (roll > 0) { // Assuming any roll > 0 is a win for this demo (based on mocked logic)
            // In real logic, maybe only 4,5,6 wins? Keeping simple as per previous mock.
            // Actually previous mock had roll > 0 adds roll amount to NFT. 
            // e.g. Roll 6 = Win 6 NFTs.
            
            wonSerials = await reserveNfts(client, userId, roll, isStarsRun, 'dice');
            
            if (isStarsRun) {
                q += `, nft_total = nft_total + ${roll}, nft_locked = nft_locked + ${roll}`;
            } else {
                q += `, nft_total = nft_total + ${roll}, nft_available = nft_available + ${roll}`;
            }
        }
        q += ` WHERE id = $1`;
        await client.query(q, [userId]);

        // 4. Record Transaction
        await client.query(`
            INSERT INTO transactions (user_id, type, asset_type, amount, description, is_locked, serials)
            VALUES ($1, 'win', 'nft', $2, $3, $4, $5)
        `, [userId, roll, winLog, isStarsRun, JSON.stringify(wonSerials)]);

        await client.query('COMMIT');
        res.json({ roll, wonSerials });

    } catch (e) {
        if(client) await client.query('ROLLBACK');
        console.error(e);
        res.status(500).json({ error: "Roll failed" });
    } finally {
        if(client) client.release();
    }
});

// WITHDRAW
app.post('/api/withdraw', validateTelegramData, async (req, res) => {
    const userId = req.user.id;
    const { address } = req.body;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const userRes = await client.query('SELECT nft_available, nft_total FROM users WHERE id = $1 FOR UPDATE', [userId]);
        const available = userRes.rows[0].nft_available;
        
        if (available <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No available funds' });
        }

        // 1. Find specific serials to withdraw
        const serialsRes = await client.query(`
            SELECT serial_number FROM user_nfts 
            WHERE user_id = $1 AND is_locked = FALSE AND is_withdrawn = FALSE AND is_seized = FALSE
            LIMIT $2
        `, [userId, available]);
        
        const serialsToWithdraw = serialsRes.rows.map(r => r.serial_number);
        
        // 2. Mark withdrawn
        await client.query(`
            UPDATE user_nfts SET is_withdrawn = TRUE WHERE serial_number = ANY($1)
        `, [serialsToWithdraw]);

        // 3. Update User Counters
        await client.query(`
            UPDATE users SET nft_total = nft_total - $1, nft_available = 0 WHERE id = $2
        `, [available, userId]);

        // 4. Log Tx
        await client.query(`
            INSERT INTO transactions (user_id, type, asset_type, amount, description, serials)
            VALUES ($1, 'withdraw', 'nft', $2, $3, $4)
        `, [userId, available, `Withdraw to ${address}`, JSON.stringify(serialsToWithdraw)]);

        await client.query('COMMIT');
        
        // TODO: In a real app, you would now queue a job to actually mint/transfer on TON Blockchain
        
        res.json({ ok: true });

    } catch(e) {
        if(client) await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally {
        if(client) client.release();
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    // Assume DB init function exists in full file or is called here
});
