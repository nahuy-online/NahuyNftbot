import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import pg from 'pg';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

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

// Prices & Settings
const PRICES = {
    nft: { STARS: 2000, TON: 0.011, USDT: 36.6 },
    dice: { STARS: 6666, TON: 0.036, USDT: 121 }
};
const REF_LEVELS = [0.07, 0.05, 0.03]; // 7%, 5%, 3%

// --- DATABASE POOL ---
const pool = new pg.Pool({
    user: process.env.DB_USER || 'user',
    password: process.env.DB_PASSWORD || 'pass',
    database: process.env.DB_NAME || 'nft_db',
    host: process.env.DB_HOST || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432'),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

// --- DB INITIALIZATION ---
const initDB = async () => {
    let retries = 5;
    while (retries > 0) {
        try {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                
                // 1. Create Tables
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
                    CREATE TABLE IF NOT EXISTS transactions (
                        id SERIAL PRIMARY KEY,
                        user_id BIGINT,
                        type TEXT,
                        asset_type TEXT,
                        amount NUMERIC(18, 9),
                        currency TEXT,
                        description TEXT,
                        is_locked BOOLEAN DEFAULT FALSE,
                        tx_hash TEXT UNIQUE,
                        created_at TIMESTAMP DEFAULT NOW()
                    );
                    CREATE TABLE IF NOT EXISTS locked_nfts (
                        id SERIAL PRIMARY KEY,
                        user_id BIGINT,
                        amount INT,
                        unlock_date BIGINT
                    );
                `);

                // 2. Run Migrations (Safe ADD COLUMN)
                // This ensures old DBs get the new columns required for the logic to work
                const columns = [
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer_id BIGINT",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_rewards_stars INT DEFAULT 0",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_rewards_ton NUMERIC(18, 9) DEFAULT 0",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_rewards_usdt NUMERIC(18, 2) DEFAULT 0",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS dice_stars_attempts INT DEFAULT 0",
                    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE",
                    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tx_hash TEXT UNIQUE"
                ];

                for (const query of columns) {
                    await client.query(query);
                }

                await client.query('COMMIT');
                console.log("✅ Database Initialized & Migrated");
                break;
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        } catch (err) {
            console.error(`❌ DB Init Error (Retrying in 3s...):`, err.message);
            retries--;
            await new Promise(res => setTimeout(res, 3000));
        }
    }
};
initDB();

// --- TELEGRAM BOT ---
if (BOT_TOKEN) {
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });
    
    // Handle /start command
    bot.onText(/\/start(.*)/, (msg, match) => {
        const chatId = msg.chat.id;
        const startParam = match[1] ? match[1].trim() : "";
        const opts = {
            reply_markup: {
                inline_keyboard: [[{ 
                    text: "🚀 Open NFT App", 
                    web_app: { url: `${WEBAPP_URL}?startapp=${startParam}` } 
                }]]
            }
        };
        bot.sendMessage(chatId, "Welcome to the NFT Ecosystem! Tap below to start.", opts);
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
                // Optional: Send receipt message
            } catch (e) {
                console.error("Payment Error:", e);
            }
        }
    });
    app.locals.bot = bot;
}

// --- REFERRAL LOGIC ---

function generateRefCode(userId) {
    return `ref_${userId}`;
}

async function bindReferrer(client, userId, potentialRefCode) {
    if (!potentialRefCode || potentialRefCode === "none") return null;

    let referrerId = null;
    
    // Strategy A: Check by full code
    const resByCode = await client.query('SELECT id FROM users WHERE referral_code = $1', [potentialRefCode]);
    if (resByCode.rows.length > 0) referrerId = resByCode.rows[0].id;

    // Strategy B: Fallback
    if (!referrerId && /^\d+$/.test(potentialRefCode.replace('ref_', ''))) {
        const rawId = potentialRefCode.replace('ref_', '');
        const resById = await client.query('SELECT id FROM users WHERE id = $1', [rawId]);
        if (resById.rows.length > 0) referrerId = resById.rows[0].id;
    }

    if (referrerId && String(referrerId) !== String(userId)) {
        await client.query('UPDATE users SET referrer_id = $1 WHERE id = $2', [referrerId, userId]);
        return referrerId;
    }
    return null;
}

async function distributeRewards(client, buyerId, amount, currency) {
    console.log(`💸 Distributing Rewards for purchase of ${amount} ${currency} by ${buyerId}`);
    
    const u1 = await client.query('SELECT referrer_id FROM users WHERE id = $1', [buyerId]);
    if (!u1.rows[0]?.referrer_id) return;

    const level1_ID = u1.rows[0].referrer_id;
    await payReward(client, level1_ID, amount, currency, 0, buyerId);

    const u2 = await client.query('SELECT referrer_id FROM users WHERE id = $1', [level1_ID]);
    if (u2.rows[0]?.referrer_id) {
        const level2_ID = u2.rows[0].referrer_id;
        await payReward(client, level2_ID, amount, currency, 1, buyerId);

        const u3 = await client.query('SELECT referrer_id FROM users WHERE id = $1', [level2_ID]);
        if (u3.rows[0]?.referrer_id) {
            const level3_ID = u3.rows[0].referrer_id;
            await payReward(client, level3_ID, amount, currency, 2, buyerId);
        }
    }
}

async function payReward(client, recipientId, totalPurchaseAmount, currency, levelIdx, sourceUserId) {
    const percent = REF_LEVELS[levelIdx];
    const reward = totalPurchaseAmount * percent;
    
    if (reward <= 0) return;

    let colName = 'ref_rewards_ton';
    if (currency === 'STARS') colName = 'ref_rewards_stars';
    if (currency === 'USDT') colName = 'ref_rewards_usdt';

    const finalAmount = currency === 'STARS' ? Math.floor(reward) : reward;
    
    if (finalAmount <= 0) return;

    await client.query(`UPDATE users SET ${colName} = ${colName} + $1 WHERE id = $2`, [finalAmount, recipientId]);
    
    await client.query(`
        INSERT INTO transactions (user_id, type, asset_type, amount, currency, description)
        VALUES ($1, 'referral_reward', 'currency', $2, $3, $4)
    `, [recipientId, finalAmount, currency, `Lvl ${levelIdx + 1} Reward from user ${sourceUserId}`]);
}

// --- API ROUTES ---

app.post('/api/auth', async (req, res) => {
    const { id, username, startParam } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        let userRes = await client.query('SELECT * FROM users WHERE id = $1', [id]);
        let user = userRes.rows[0];
        let isNew = false;

        if (!user) {
            isNew = true;
            const myRefCode = generateRefCode(id);
            await client.query(
                'INSERT INTO users (id, username, referral_code) VALUES ($1, $2, $3)', 
                [id, username, myRefCode]
            );
            user = { id, username, referral_code: myRefCode, referrer_id: null };
            
            // Re-fetch to get defaults
            userRes = await client.query('SELECT * FROM users WHERE id = $1', [id]);
            user = userRes.rows[0];
        }

        // Binding Logic
        if (!user.referrer_id && startParam && startParam !== "none" && startParam !== user.referral_code) {
            console.log(`🔗 Binding User ${id} to referrer code: ${startParam}`);
            const boundId = await bindReferrer(client, id, startParam);
            if (boundId) {
                user.referrer_id = boundId;
                // Update local object for response
            }
        }

        await client.query('COMMIT');

        // Stats
        const lvl1 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id = $1', [id]);
        const lvl2 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id = $1)', [id]);
        const lvl3 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id = $1))', [id]);

        const lockedRes = await client.query('SELECT amount, unlock_date FROM locked_nfts WHERE user_id = $1', [id]);

        res.json({
            id: parseInt(user.id),
            username: user.username,
            referralCode: user.referral_code,
            referrerId: user.referrer_id ? parseInt(user.referrer_id) : null,
            isNewUser: isNew,
            nftBalance: {
                total: user.nft_total || 0,
                available: user.nft_available || 0,
                locked: user.nft_locked || 0,
                lockedDetails: lockedRes.rows.map(r => ({ amount: r.amount, unlockDate: parseInt(r.unlock_date) }))
            },
            diceBalance: {
                available: user.dice_available || 0,
                starsAttempts: user.dice_stars_attempts || 0
            },
            referralStats: {
                level1: parseInt(lvl1.rows[0].count),
                level2: parseInt(lvl2.rows[0].count),
                level3: parseInt(lvl3.rows[0].count),
                earnings: {
                    STARS: user.ref_rewards_stars || 0,
                    TON: user.ref_rewards_ton || 0,
                    USDT: user.ref_rewards_usdt || 0
                }
            }
        });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Auth Error:", e);
        res.status(500).json({ error: "Auth failed: " + e.message });
    } finally {
        client.release();
    }
});

app.post('/api/payment/create', async (req, res) => {
    const { id, type, amount, currency } = req.body;
    const priceMap = type === 'nft' ? PRICES.nft : PRICES.dice;
    const unitPrice = priceMap[currency];
    const totalPrice = unitPrice * amount;

    if (currency === 'STARS') {
        try {
            const link = await app.locals.bot.createInvoiceLink(
                type === 'nft' ? "NFT Pack" : "Dice Attempts", 
                `Qty: ${amount}`, 
                JSON.stringify({ type, amount }),
                "", "XTR", 
                [{ label: `${amount} items`, amount: totalPrice }]
            );
            res.json({ ok: true, invoiceLink: link });
        } catch(e) { 
            console.error("Invoice Error:", e);
            res.status(500).json({error: "Bot Error"}); 
        }
    } else {
        const nanoTons = Math.round(totalPrice * 1e9).toString();
        const TARGET_WALLET = "0QBycgJ7cxTLe4Y84HG6tOGQgf-284Es4zJzVJM8R2h1U_av"; 
        res.json({ 
            ok: true, 
            transaction: {
                validUntil: Math.floor(Date.now() / 1000) + 600,
                messages: [{ address: TARGET_WALLET, amount: nanoTons }]
            }
        });
    }
});

app.post('/api/payment/verify', async (req, res) => {
    const { id, type, amount, currency } = req.body;
    await handlePurchaseSuccess(id, type, amount, currency, `manual_${Date.now()}`);
    res.json({ ok: true });
});

async function handlePurchaseSuccess(userId, type, qty, currency, txHash) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const dup = await client.query('SELECT id FROM transactions WHERE tx_hash = $1', [txHash]);
        if (dup.rows.length > 0) { await client.query('ROLLBACK'); return; }

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

        // DISTRIBUTE REWARDS
        const priceMap = type === 'nft' ? PRICES.nft : PRICES.dice;
        const totalPaid = priceMap[currency] * qty;
        await distributeRewards(client, userId, totalPaid, currency);

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Purchase Handler Error:", e);
        return false;
    } finally {
        client.release();
    }
}

app.post('/api/roll', async (req, res) => {
    const { id } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const u = await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [id]);
        if (!u.rows[0] || u.rows[0].dice_available <= 0) throw new Error("No dice");

        let isStars = false;
        if (u.rows[0].dice_stars_attempts > 0) isStars = true;

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
        await client.query('ROLLBACK');
        res.status(500).json({error: e.message});
    } finally {
        client.release();
    }
});

app.get('/api/history', async (req, res) => {
    const { id } = req.query;
    try {
        const r = await pool.query('SELECT * FROM transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [id]);
        res.json(r.rows.map(x => ({
            id: x.id, type: x.type, amount: x.amount, description: x.description, 
            timestamp: new Date(x.created_at).getTime(), currency: x.currency, isLocked: x.is_locked, assetType: x.asset_type
        })));
    } catch(e) { res.json([]); }
});

app.post('/api/withdraw', async (req, res) => {
    const { id, address } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const u = await client.query('SELECT nft_available FROM users WHERE id=$1 FOR UPDATE', [id]);
        const avail = u.rows[0].nft_available;
        if (avail <= 0) throw new Error("No balance");

        await client.query('UPDATE users SET nft_available=0, nft_total=nft_total-$1 WHERE id=$2', [avail, id]);
        await client.query("INSERT INTO transactions (user_id, type, asset_type, amount, description) VALUES ($1, 'withdraw', 'nft', $2, $3)", [id, avail, `Withdraw to ${address}`]);
        
        await client.query('COMMIT');
        res.json({ok: true});
    } catch(e) {
        await client.query('ROLLBACK');
        res.status(500).json({error: e.message});
    } finally {
        client.release();
    }
});

app.post('/api/debug/reset', async (req, res) => {
    await pool.query('TRUNCATE users, transactions, locked_nfts RESTART IDENTITY CASCADE');
    res.json({ok:true});
});

app.listen(PORT, () => console.log(`Backend Active on ${PORT}`));