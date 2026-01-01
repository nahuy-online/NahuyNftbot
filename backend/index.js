import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import pkg from 'pg';
const { Pool } = pkg;
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

// --- GLOBAL ERROR HANDLERS (PREVENT CRASH) ---
process.on('uncaughtException', (err) => {
    console.error('💥 UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 UNHANDLED REJECTION:', reason);
});

// --- ENV SETUP ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config(); 

const app = express();
app.use(express.json());
app.use(cors());

// --- CONFIG ---
const PORT = parseInt(process.env.PORT || '8080', 10);
const BOT_TOKEN = process.env.BOT_TOKEN;
// Update alias to 'start' as requested. Note: for prod, this should be the HTTPS URL.
const WEBAPP_URL = "https://t.me/nahuy_NFT_bot/start"; 
let isDbReady = false;
let dbInitError = null; 

// Prices & Constants
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
    connectionTimeoutMillis: 5000, 
});

pool.on('error', (err) => console.error('🔴 Unexpected DB Client Error', err));

// Fix BigInt JSON serialization
BigInt.prototype.toJSON = function() { return this.toString(); };

// --- DB MIGRATION ---
const initDB = async () => {
    let retries = 30; 
    while (retries > 0) {
        let client;
        try {
            client = await pool.connect();
            console.log("✅ Connected to Database");
            
            try {
                await client.query('BEGIN');
                
                // 1. Create Users
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
                
                // 2. Create Transactions
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
                
                // 3. Create Locked NFTs
                await client.query(`
                    CREATE TABLE IF NOT EXISTS locked_nfts (
                        id SERIAL PRIMARY KEY,
                        user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
                        amount INT,
                        unlock_date BIGINT
                    );
                `);

                // 4. Run Migrations
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
                    await client.query(q).catch(e => console.warn(`Migration notice: ${e.message}`));
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
            console.error(`⚠️ DB Connection Failed (Retries left: ${retries}):`, err.message);
            retries--;
            if (retries === 0) dbInitError = err.message;
            await new Promise(res => setTimeout(res, 2000));
        }
    }
};

// --- MIDDLEWARE ---
app.use((req, res, next) => {
    if (req.path === '/api/health') return next();

    if (dbInitError) {
        return res.status(500).json({ error: `DB Init Failed: ${dbInitError}` });
    }
    if (!isDbReady && req.path.startsWith('/api')) {
        return res.status(503).json({ error: 'Server initializing (DB connecting), please wait...' });
    }
    next();
});

// Start Server on 0.0.0.0 for Docker
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    initDB();
});


// --- TELEGRAM BOT ---
if (BOT_TOKEN) {
    try {
        const bot = new TelegramBot(BOT_TOKEN, { polling: true });
        bot.on('polling_error', (error) => { console.error(`[Bot Polling Error] ${error.code || error.message}`); });
        bot.onText(/\/start(.*)/, (msg, match) => {
            const chatId = msg.chat.id;
            const rawParam = match[1] ? match[1].trim() : "";
            const startParam = rawParam.replace('/', ''); // Clean it
            const opts = {
                reply_markup: {
                    inline_keyboard: [[{ text: "🚀 Open NFT App", web_app: { url: `${WEBAPP_URL}?startapp=${startParam}` } }]]
                }
            };
            bot.sendMessage(chatId, "Welcome! Tap below to enter.", opts).catch(e => console.error("SendMsg Error", e));
        });
        app.locals.bot = bot;
        console.log("✅ Telegram Bot Initialized");
    } catch (e) {
        console.error("⚠️ Telegram Bot Init Failed:", e.message);
    }
} else {
    console.log("ℹ️ No BOT_TOKEN provided, skipping bot init.");
}

// --- LOGIC ---

function generateRefCode() {
    // Generate code WITH 'ref_' prefix to avoid confusion
    return 'ref_' + crypto.randomBytes(4).toString('hex');
}

async function bindReferrer(client, userId, potentialRefCode) {
    console.log(`🔗 Binding check: User=${userId}, Param=${potentialRefCode}`);
    
    if (!potentialRefCode || potentialRefCode === "none" || potentialRefCode === "undefined") {
        return { boundId: null, reason: "No code provided" };
    }

    const cleanCode = potentialRefCode.trim();
    let referrerId = null;
    let method = "";
    
    // 1. Exact Match (Case Insensitive)
    const resByCode = await client.query('SELECT id FROM users WHERE lower(referral_code) = lower($1)', [cleanCode]);
    if (resByCode.rows.length > 0) {
        referrerId = resByCode.rows[0].id;
        method = "code";
    }

    // 2. Fallback: If code is just "ref_ID" but stored as "ref_HEX", this won't match.
    // But if the user passed just "ID" or "ref_ID" and we want to support old style:
    if (!referrerId) {
         let rawId = cleanCode;
         if (cleanCode.startsWith('ref_')) rawId = cleanCode.replace('ref_', '');
         
         // Only try to parse if it looks like a numeric ID
         if (/^\d+$/.test(rawId)) {
             const resById = await client.query('SELECT id FROM users WHERE id = $1', [rawId]);
             if (resById.rows.length > 0) {
                referrerId = resById.rows[0].id;
                method = "legacy_id";
             }
         }
    }

    // 3. Validation
    if (!referrerId) {
        console.log(`   -> ❌ Code '${cleanCode}' not found.`);
        return { boundId: null, reason: `Code '${cleanCode}' not found` };
    }

    if (String(referrerId) === String(userId)) {
        console.log("   -> ❌ Self-referral attempt.");
        return { boundId: null, reason: "Self-referral" };
    }

    // 4. Update DB
    await client.query('UPDATE users SET referrer_id = $1 WHERE id = $2', [referrerId, userId]);
    console.log(`   -> ✅ SUCCESS: Bound to ${referrerId} via ${method}`);
    
    return { boundId: referrerId, reason: `Success (${method})` };
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
        if (r3) await payReward(client, r3, amount, currency, 2, buyerId);
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

        // --- LOCKING LOGIC ---
        const isStars = (currency === 'STARS');
        const isLocked = isStars; // Explicit boolean for DB

        console.log(`[Purchase] User=${userId}, Type=${type}, Qty=${qty}, Currency=${currency}, Stars=${isStars}, Locked=${isLocked}`);

        if (type === 'nft') {
            if (isStars) {
                 const unlock = Date.now() + (21 * 86400000); // 21 days
                 // Increment TOTAL and LOCKED, do NOT increment AVAILABLE
                 await client.query('UPDATE users SET nft_total=nft_total+$1, nft_locked=nft_locked+$1 WHERE id=$2', [qty, userId]);
                 await client.query('INSERT INTO locked_nfts (user_id, amount, unlock_date) VALUES ($1, $2, $3)', [userId, qty, unlock]);
            } else {
                 await client.query('UPDATE users SET nft_total=nft_total+$1, nft_available=nft_available+$1 WHERE id=$2', [qty, userId]);
            }
        } else {
            // Dice Attempts
            await client.query('UPDATE users SET dice_available=dice_available+$1 WHERE id=$2', [qty, userId]);
            if (isStars) {
                 await client.query('UPDATE users SET dice_stars_attempts=dice_stars_attempts+$1 WHERE id=$2', [qty, userId]);
            }
        }

        await client.query(`
            INSERT INTO transactions (user_id, type, asset_type, amount, currency, description, is_locked, tx_hash)
            VALUES ($1, 'purchase', $2, $3, $4, $5, $6, $7)
        `, [userId, type, qty, currency, `Purchase ${qty} ${type}`, isLocked, txHash]);

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
    let debugInfo = "Init"; // Default value to ensure it's never undefined in response

    try {
        const { id, username, startParam } = req.body;
        if (!id) throw new Error("No ID provided in body");

        client = await pool.connect();
        await client.query('BEGIN');

        // 1. Check if user exists
        let resUser = await client.query('SELECT * FROM users WHERE id = $1', [id]);
        let user = resUser.rows[0];
        let isNew = false;

        // 2. Create user if not exists
        if (!user) {
            console.log(`Creating new user: ${id}`);
            isNew = true;
            const code = generateRefCode(); 
            await client.query('INSERT INTO users (id, username, referral_code) VALUES ($1, $2, $3)', [id, username, code]);
            
            resUser = await client.query('SELECT * FROM users WHERE id = $1', [id]);
            user = resUser.rows[0];
            debugInfo = "User Created";
        } else {
            debugInfo = "User Exists";
        }

        // 3. Bind Referrer logic
        if (!user.referrer_id && startParam && startParam !== "none") {
            try {
                const result = await bindReferrer(client, id, startParam);
                if (result.boundId) {
                    user.referrer_id = result.boundId; 
                    debugInfo = `Bound to ${result.boundId}`;
                } else {
                    debugInfo = `Bind Failed: ${result.reason}`;
                }
            } catch (err) {
                console.error("Bind Error:", err);
                debugInfo = `Bind Error: ${err.message}`;
            }
        } else if (user.referrer_id) {
            debugInfo = `Already has referrer: ${user.referrer_id}`;
        }

        await client.query('COMMIT');

        // 4. Fetch Stats
        const l1 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id = $1', [id]);
        const l2 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id = $1)', [id]);
        const l3 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id = $1))', [id]);
        
        const locks = await client.query('SELECT amount, unlock_date FROM locked_nfts WHERE user_id = $1', [id]);

        res.json({
            id: String(user.id),
            username: user.username,
            referralCode: user.referral_code,
            referrerId: user.referrer_id ? String(user.referrer_id) : null,
            referralDebug: debugInfo, // Explicitly sending debug info
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
                    TON: parseFloat(user.ref_rewards_ton || 0),
                    USDT: parseFloat(user.ref_rewards_usdt || 0)
                }
            }
        });

    } catch (e) {
        if(client) await client.query('ROLLBACK');
        console.error("❌ Auth CRASH Stack:", e.stack);
        res.status(500).json({ error: String(e.message || e) });
    } finally {
        if(client) client.release();
    }
});

app.post('/api/roll', async (req, res) => {
    let client;
    try {
        const { id } = req.body;
        client = await pool.connect();
        await client.query('BEGIN');
        
        const u = await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [id]);
        if (!u.rows[0]) throw new Error("User not found");
        if (u.rows[0].dice_available <= 0) throw new Error("No dice");

        // --- LOCKING LOGIC FOR ROLL ---
        // Check if user has 'stars' attempts
        const starsAttempts = u.rows[0].dice_stars_attempts || 0;
        const isStars = starsAttempts > 0;
        
        const roll = Math.floor(Math.random() * 6) + 1;
        const win = roll; 

        // Decrement attempts
        await client.query('UPDATE users SET dice_available=dice_available-1 WHERE id=$1', [id]);
        if (isStars) {
            await client.query('UPDATE users SET dice_stars_attempts=dice_stars_attempts-1 WHERE id=$1', [id]);
        }

        if (win > 0) {
            if (isStars) {
                const unlock = Date.now() + (21 * 86400000);
                // Lock the win
                await client.query('UPDATE users SET nft_total=nft_total+$1, nft_locked=nft_locked+$1 WHERE id=$2', [win, id]);
                await client.query('INSERT INTO locked_nfts (user_id, amount, unlock_date) VALUES ($1, $2, $3)', [id, win, unlock]);
            } else {
                // Available
                await client.query('UPDATE users SET nft_total=nft_total+$1, nft_available=nft_available+$1 WHERE id=$2', [win, id]);
            }
            
            // Log transaction with lock status
            await client.query(
                "INSERT INTO transactions (user_id, type, asset_type, amount, description, is_locked) VALUES ($1, 'win', 'nft', $2, $3, $4)", 
                [id, win, `Rolled ${roll}`, isStars]
            );
        }
        await client.query('COMMIT');
        res.json({ roll });
    } catch (e) {
        if(client) await client.query('ROLLBACK');
        console.error("Roll Error:", e);
        res.status(500).json({ error: e.message });
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
                if (!app.locals.bot) throw new Error("Bot not initialized");
                const link = await app.locals.bot.createInvoiceLink(
                    type === 'nft' ? "NFT Pack" : "Dice Attempts", 
                    `Qty: ${amount}`, 
                    JSON.stringify({ type, amount }),
                    "", "XTR", 
                    [{ label: `${amount} items`, amount: total }]
                );
                res.json({ ok: true, invoiceLink: link });
            } catch(e) { 
                console.warn("Bot Invoice Failed (Fallback):", e.message);
                res.json({ ok: true, invoiceLink: "https://t.me/$" });
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

app.get('/api/history', async (req, res) => {
    try {
        const { id } = req.query;
        const client = await pool.connect();
        try {
            const r = await client.query('SELECT * FROM transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [id]);
            res.json(r.rows.map(x => ({
                id: x.id, type: x.type, amount: x.amount, description: x.description, 
                timestamp: new Date(x.created_at).getTime(), currency: x.currency, isLocked: x.is_locked, assetType: x.asset_type
            })));
        } finally { client.release(); }
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