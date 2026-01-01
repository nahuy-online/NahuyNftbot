import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import pg from 'pg'; // Standard import
import path from 'path';
import { fileURLToPath } from 'url';

// Extract Pool from pg (works for both default and named exports usually)
const { Pool } = pg;

// --- ENV SETUP ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config(); 

const app = express();
app.use(express.json());
app.use(cors());

// --- CONFIG ---
const PORT = process.env.PORT || 8080;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = "https://t.me/nahuy_NFT_bot/app"; 
let isDbReady = false;
let dbInitError = null; 

// Prices
const PRICES = {
    nft: { STARS: 2000, TON: 0.011, USDT: 36.6 },
    dice: { STARS: 6666, TON: 0.036, USDT: 121 }
};
const REF_LEVELS = [0.07, 0.05, 0.03]; 

// --- DATABASE CONFIG ---
const pool = new Pool({
    user: process.env.DB_USER || 'user',
    password: process.env.DB_PASSWORD || 'pass',
    database: process.env.DB_NAME || 'nft_db',
    host: process.env.DB_HOST || 'localhost', 
    port: parseInt(process.env.DB_PORT || '5432'),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 5000, // Fail fast if DB down
});

pool.on('error', (err) => console.error('🔴 Unexpected DB Client Error', err));

// --- MIDDLEWARE ---
app.use((req, res, next) => {
    if (req.path === '/api/health') return next();

    // If DB init fatally failed, report it
    if (dbInitError) {
        return res.status(500).json({ error: `DB Init Failed: ${dbInitError}` });
    }
    // If DB is still starting, tell frontend to wait (handled by frontend retry)
    if (!isDbReady && req.path.startsWith('/api')) {
        return res.status(503).json({ error: 'Server initializing, please wait...' });
    }
    next();
});

// --- HELPER: BigInt Serialization ---
BigInt.prototype.toJSON = function() { return this.toString(); };

// --- DB MIGRATION ---
const initDB = async () => {
    let retries = 30; // Increased retries for Docker cold starts
    while (retries > 0) {
        let client;
        try {
            client = await pool.connect();
            console.log("✅ Connected to Database");
            
            try {
                await client.query("SET lock_timeout = '10s'");
                await client.query('BEGIN');
                
                // 1. Create Base Tables
                await client.query(`
                    CREATE TABLE IF NOT EXISTS users (
                        id BIGINT PRIMARY KEY,
                        username TEXT,
                        referral_code TEXT UNIQUE,
                        referrer_id BIGINT,
                        nft_total INT DEFAULT 0,
                        nft_available INT DEFAULT 0,
                        nft_locked INT DEFAULT 0,
                        dice_available INT DEFAULT 0,
                        dice_stars_attempts INT DEFAULT 0,
                        ref_rewards_stars INT DEFAULT 0,
                        ref_rewards_ton NUMERIC(18, 9) DEFAULT 0,
                        ref_rewards_usdt NUMERIC(18, 2) DEFAULT 0,
                        created_at TIMESTAMP DEFAULT NOW()
                    );
                `);
                
                await client.query(`
                    CREATE TABLE IF NOT EXISTS transactions (
                        id SERIAL PRIMARY KEY,
                        user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
                        type TEXT,
                        asset_type TEXT,
                        amount NUMERIC(18, 9),
                        currency TEXT,
                        description TEXT,
                        is_locked BOOLEAN DEFAULT FALSE,
                        tx_hash TEXT UNIQUE,
                        created_at TIMESTAMP DEFAULT NOW()
                    );
                `);
                
                await client.query(`
                    CREATE TABLE IF NOT EXISTS locked_nfts (
                        id SERIAL PRIMARY KEY,
                        user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
                        amount INT,
                        unlock_date BIGINT
                    );
                `);

                // 2. Safe Column Migrations
                const alterQueries = [
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer_id BIGINT",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_rewards_stars INT DEFAULT 0",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_rewards_ton NUMERIC(18, 9) DEFAULT 0",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_rewards_usdt NUMERIC(18, 2) DEFAULT 0",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS dice_stars_attempts INT DEFAULT 0",
                    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE",
                    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tx_hash TEXT UNIQUE"
                ];

                for (const q of alterQueries) {
                    await client.query(q);
                }

                await client.query('COMMIT');
                console.log("✅ Database Schema Synced & Ready");
                isDbReady = true;
                client.release();
                return;

            } catch (dbErr) {
                await client.query('ROLLBACK');
                client.release();
                console.error("⚠️ Migration Error:", dbErr.message);
                dbInitError = dbErr.message;
                throw dbErr; 
            }
        } catch (err) {
            console.error(`⚠️ DB Init Failed (Retries left: ${retries}):`, err.message);
            retries--;
            if (retries === 0) dbInitError = err.message;
            await new Promise(res => setTimeout(res, 2000));
        }
    }
};

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    initDB();
});


// --- TELEGRAM BOT ---
if (BOT_TOKEN) {
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });
    
    bot.on('polling_error', (error) => {
        console.error(`[Telegram Bot] Polling Error: ${error.code} - ${error.message}`);
    });

    bot.onText(/\/start(.*)/, (msg, match) => {
        const chatId = msg.chat.id;
        const rawParam = match[1] ? match[1].trim() : "";
        const startParam = rawParam.replace('/', '');
        
        const opts = {
            reply_markup: {
                inline_keyboard: [[{ 
                    text: "🚀 Open NFT App", 
                    web_app: { url: `${WEBAPP_URL}?startapp=${startParam}` } 
                }]]
            }
        };
        bot.sendMessage(chatId, "Welcome! Tap below to enter.", opts);
    });

    bot.on('pre_checkout_query', (query) => {
        bot.answerPreCheckoutQuery(query.id, true).catch(() => {});
    });

    bot.on('message', async (msg) => {
        if (msg.successful_payment) {
            const userId = msg.from.id;
            try {
                const payload = JSON.parse(msg.successful_payment.invoice_payload);
                await handlePurchaseSuccess(userId, payload.type, payload.amount, 'STARS', msg.successful_payment.telegram_payment_charge_id);
            } catch (e) {
                console.error("Payment Error:", e);
            }
        }
    });
    app.locals.bot = bot;
}

// --- LOGIC ---

function generateRefCode(userId) {
    return `ref_${userId}`;
}

async function bindReferrer(client, userId, potentialRefCode) {
    if (!potentialRefCode || potentialRefCode === "none") return null;

    let referrerId = null;
    
    // Check by Code
    const resByCode = await client.query('SELECT id FROM users WHERE referral_code = $1', [potentialRefCode]);
    if (resByCode.rows.length > 0) referrerId = resByCode.rows[0].id;

    // Check by ID (Legacy)
    if (!referrerId && potentialRefCode.startsWith('ref_')) {
        const rawId = potentialRefCode.replace('ref_', '');
        if (/^\d+$/.test(rawId)) {
             const resById = await client.query('SELECT id FROM users WHERE id = $1', [rawId]);
             if (resById.rows.length > 0) referrerId = resById.rows[0].id;
        }
    }

    if (referrerId && String(referrerId) !== String(userId)) {
        await client.query('UPDATE users SET referrer_id = $1 WHERE id = $2', [referrerId, userId]);
        return referrerId;
    }
    return null;
}

async function distributeRewards(client, buyerId, amount, currency) {
    const u1 = await client.query('SELECT referrer_id FROM users WHERE id = $1', [buyerId]);
    const r1 = u1.rows[0]?.referrer_id;
    if (!r1) return;
    
    await payReward(client, r1, amount, currency, 0, buyerId);

    const u2 = await client.query('SELECT referrer_id FROM users WHERE id = $1', [r1]);
    const r2 = u2.rows[0]?.referrer_id;
    if (r2) {
        await payReward(client, r2, amount, currency, 1, buyerId);
        
        const u3 = await client.query('SELECT referrer_id FROM users WHERE id = $1', [r2]);
        const r3 = u3.rows[0]?.referrer_id;
        if (r3) {
            await payReward(client, r3, amount, currency, 2, buyerId);
        }
    }
}

async function payReward(client, recipientId, totalPurchaseAmount, currency, levelIdx, sourceUserId) {
    const percent = REF_LEVELS[levelIdx];
    let reward = totalPurchaseAmount * percent;
    if (reward <= 0) return;

    let colName = 'ref_rewards_ton';
    let isInt = false;
    
    if (currency === 'STARS') { colName = 'ref_rewards_stars'; isInt = true; }
    else if (currency === 'USDT') { colName = 'ref_rewards_usdt'; }

    if (isInt) reward = Math.floor(reward);
    if (reward <= 0) return;

    await client.query(`UPDATE users SET ${colName} = ${colName} + $1 WHERE id = $2`, [reward, recipientId]);
    await client.query(`
        INSERT INTO transactions (user_id, type, asset_type, amount, currency, description)
        VALUES ($1, 'referral_reward', 'currency', $2, $3, $4)
    `, [recipientId, reward, currency, `Lvl ${levelIdx + 1} Reward`]);
}

async function handlePurchaseSuccess(userId, type, qty, currency, txHash) {
    if (!isDbReady) return false;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const dup = await client.query('SELECT id FROM transactions WHERE tx_hash = $1', [txHash]);
        if (dup.rows.length > 0) { await client.query('ROLLBACK'); return false; }

        const isStars = currency === 'STARS';
        
        if (type === 'nft') {
            if (isStars) {
                 const unlock = Date.now() + (21 * 86400000);
                 await client.query('UPDATE users SET nft_total=nft_total+$1, nft_locked=nft_locked+$1 WHERE id=$2', [qty, userId]);
                 await client.query('INSERT INTO locked_nfts (user_id, amount, unlock_date) VALUES ($1, $2, $3)', [userId, qty, unlock]);
            } else {
                 await client.query('UPDATE users SET nft_total=nft_total+$1, nft_available=nft_available+$1 WHERE id=$2', [qty, userId]);
            }
        } else {
            await client.query('UPDATE users SET dice_available=dice_available+$1 WHERE id=$2', [qty, userId]);
            if (isStars) await client.query('UPDATE users SET dice_stars_attempts=dice_stars_attempts+$1 WHERE id=$2', [qty, userId]);
        }

        await client.query(`
            INSERT INTO transactions (user_id, type, asset_type, amount, currency, description, is_locked, tx_hash)
            VALUES ($1, 'purchase', $2, $3, $4, $5, $6, $7)
        `, [userId, type, qty, currency, `Purchase ${qty} ${type}`, (isStars && type==='nft'), txHash]);

        const priceMap = type === 'nft' ? PRICES.nft : PRICES.dice;
        const totalPaid = priceMap[currency] * qty;
        await distributeRewards(client, userId, totalPaid, currency);

        await client.query('COMMIT');
        return true;
    } catch (e) {
        if(client) await client.query('ROLLBACK');
        console.error("Purchase Error:", e);
        return false;
    } finally {
        if(client) client.release();
    }
}

// --- ROUTES ---

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', dbReady: isDbReady, dbError: dbInitError });
});

app.post('/api/auth', async (req, res) => {
    let client;
    try {
        const { id, username, startParam } = req.body;
        if (!id) return res.status(400).json({ error: "No ID provided" });

        client = await pool.connect();
        await client.query('BEGIN');

        let resUser = await client.query('SELECT * FROM users WHERE id = $1', [id]);
        let user = resUser.rows[0];
        let isNew = false;

        if (!user) {
            isNew = true;
            const code = generateRefCode(id);
            await client.query('INSERT INTO users (id, username, referral_code) VALUES ($1, $2, $3)', [id, username, code]);
            user = { id, username, referral_code: code, referrer_id: null };
            resUser = await client.query('SELECT * FROM users WHERE id = $1', [id]);
            user = resUser.rows[0];
        }

        if (!user.referrer_id && startParam && startParam !== "none" && startParam !== user.referral_code) {
            const boundId = await bindReferrer(client, id, startParam);
            if (boundId) user.referrer_id = boundId;
        }

        await client.query('COMMIT');

        const l1 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id = $1', [id]);
        const l2 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id = $1)', [id]);
        const l3 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id = $1))', [id]);
        
        const locks = await client.query('SELECT amount, unlock_date FROM locked_nfts WHERE user_id = $1', [id]);

        res.json({
            id: String(user.id),
            username: user.username,
            referralCode: user.referral_code,
            referrerId: user.referrer_id ? String(user.referrer_id) : null,
            isNewUser: isNew,
            nftBalance: {
                total: user.nft_total || 0,
                available: user.nft_available || 0,
                locked: user.nft_locked || 0,
                lockedDetails: locks.rows.map(r => ({ amount: r.amount, unlockDate: parseInt(r.unlock_date) }))
            },
            diceBalance: {
                available: user.dice_available || 0,
                starsAttempts: user.dice_stars_attempts || 0
            },
            referralStats: {
                level1: parseInt(l1.rows[0].count),
                level2: parseInt(l2.rows[0].count),
                level3: parseInt(l3.rows[0].count),
                earnings: {
                    STARS: user.ref_rewards_stars || 0,
                    TON: user.ref_rewards_ton || 0,
                    USDT: user.ref_rewards_usdt || 0
                }
            }
        });

    } catch (e) {
        if(client) await client.query('ROLLBACK');
        console.error("Auth Error:", e);
        // Ensure error is JSON
        res.status(500).json({ error: e.message || "Unknown DB Error" });
    } finally {
        if(client) client.release();
    }
});

app.post('/api/payment/create', async (req, res) => {
    try {
        const { type, amount, currency } = req.body;
        const priceMap = type === 'nft' ? PRICES.nft : PRICES.dice;
        const total = priceMap[currency] * amount;

        if (currency === 'STARS') {
            try {
                const link = await app.locals.bot.createInvoiceLink(
                    type === 'nft' ? "NFT Pack" : "Dice Attempts", 
                    `Qty: ${amount}`, 
                    JSON.stringify({ type, amount }),
                    "", "XTR", 
                    [{ label: `${amount} items`, amount: total }]
                );
                res.json({ ok: true, invoiceLink: link });
            } catch(e) { 
                console.error(e);
                res.status(500).json({ error: "Bot Error: " + e.message }); 
            }
        } else {
            const nano = Math.round(total * 1e9).toString();
            const TARGET = "0QBycgJ7cxTLe4Y84HG6tOGQgf-284Es4zJzVJM8R2h1U_av"; 
            res.json({ 
                ok: true, 
                transaction: {
                    validUntil: Math.floor(Date.now() / 1000) + 600,
                    messages: [{ address: TARGET, amount: nano }]
                }
            });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/payment/verify', async (req, res) => {
    try {
        const { id, type, amount, currency } = req.body;
        await handlePurchaseSuccess(id, type, amount, currency, `manual_${Date.now()}_${Math.random()}`);
        res.json({ ok: true });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/roll', async (req, res) => {
    let client;
    try {
        const { id } = req.body;
        client = await pool.connect();
        await client.query('BEGIN');
        const u = await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [id]);
        if (!u.rows[0] || u.rows[0].dice_available <= 0) throw new Error("No dice");

        const isStars = u.rows[0].dice_stars_attempts > 0;
        const roll = Math.floor(Math.random() * 6) + 1;
        const win = roll;

        await client.query('UPDATE users SET dice_available=dice_available-1 WHERE id=$1', [id]);
        if (isStars) await client.query('UPDATE users SET dice_stars_attempts=dice_stars_attempts-1 WHERE id=$1', [id]);

        if (win > 0) {
            if (isStars) {
                const unlock = Date.now() + (21 * 86400000);
                await client.query('UPDATE users SET nft_total=nft_total+$1, nft_locked=nft_locked+$1 WHERE id=$2', [win, id]);
                await client.query('INSERT INTO locked_nfts (user_id, amount, unlock_date) VALUES ($1, $2, $3)', [id, win, unlock]);
            } else {
                await client.query('UPDATE users SET nft_total=nft_total+$1, nft_available=nft_available+$1 WHERE id=$2', [win, id]);
            }
            await client.query("INSERT INTO transactions (user_id, type, asset_type, amount, description, is_locked) VALUES ($1, 'win', 'nft', $2, $3, $4)", [id, win, `Rolled ${roll}`, isStars]);
        }
        await client.query('COMMIT');
        res.json({ roll });
    } catch (e) {
        if(client) await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally {
        if(client) client.release();
    }
});

app.get('/api/history', async (req, res) => {
    try {
        const { id } = req.query;
        const r = await pool.query('SELECT * FROM transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [id]);
        res.json(r.rows.map(x => ({
            id: x.id, type: x.type, amount: x.amount, description: x.description, 
            timestamp: new Date(x.created_at).getTime(), currency: x.currency, isLocked: x.is_locked, assetType: x.asset_type
        })));
    } catch (e) { res.json([]); }
});

app.post('/api/withdraw', async (req, res) => {
    let client;
    try {
        const { id, address } = req.body;
        client = await pool.connect();
        await client.query('BEGIN');
        const u = await client.query('SELECT nft_available FROM users WHERE id=$1 FOR UPDATE', [id]);
        if (u.rows[0].nft_available <= 0) throw new Error("No funds");
        
        await client.query('UPDATE users SET nft_available=0, nft_total=nft_total-$1 WHERE id=$2', [u.rows[0].nft_available, id]);
        await client.query("INSERT INTO transactions (user_id, type, asset_type, amount, description) VALUES ($1, 'withdraw', 'nft', $2, $3)", [id, u.rows[0].nft_available, `Withdraw to ${address}`]);
        
        await client.query('COMMIT');
        res.json({ ok: true });
    } catch (e) {
        if(client) await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally {
        if(client) client.release();
    }
});

app.post('/api/debug/reset', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        await client.query('TRUNCATE users, transactions, locked_nfts RESTART IDENTITY CASCADE');
        res.json({ ok: true });
    } catch(e) {
        res.status(500).json({error: e.message});
    } finally {
        if(client) client.release();
    }
});