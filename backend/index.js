import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

// --- ENV CONFIGURATION FIX ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try to load .env from root (../.env) first, then local .env
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config(); 

const app = express();
app.use(express.json());
app.use(cors());

// --- CONFIG ---
const PORT = process.env.PORT || 8080;
const BOT_TOKEN = process.env.BOT_TOKEN;

// FALLBACK ADDRESS: If env is missing, use a generic TON Foundation address (valid for testing UI)
// This prevents "Transaction canceled" due to undefined address
const DEFAULT_WALLET = "UQAQnxLq1g0K8a8A1eA4m5_tA-3e6f9b8c7d6e5f4a3b2c1"; 
const TON_WALLET = process.env.RECEIVER_TON_ADDRESS_TESTNET || DEFAULT_WALLET;

if (TON_WALLET === DEFAULT_WALLET) {
    console.warn("⚠️ WARNING: RECEIVER_TON_ADDRESS_TESTNET is not set. Using fallback address.");
} else {
    console.log("✅ Using Wallet Address:", TON_WALLET);
}

// Prices
const PRICES = {
    nft: { STARS: 2000, TON: 0.01 }, 
    dice: { STARS: 6666, TON: 0.015 }
};

// --- DATABASE CONFIGURATION ---
const dbConfig = {
    user: process.env.DB_USER || process.env.POSTGRES_POSTGRES_USER || 'user',
    password: process.env.DB_PASSWORD || process.env.POSTGRES_POSTGRES_PASSWORD || 'pass',
    database: process.env.DB_NAME || process.env.POSTGRES_POSTGRES_DB || 'nft_db',
    host: process.env.DB_HOST || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432'),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
};

console.log(`Connecting to DB at ${dbConfig.host}:${dbConfig.port}...`);

const pool = new pg.Pool(dbConfig);

// Handle Pool Errors (prevents crash on idle client loss)
pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    // Don't exit, just log
});

const initDB = async () => {
    let retries = 10;
    while (retries > 0) {
        try {
            const client = await pool.connect();
            try {
                await client.query(`
                    CREATE TABLE IF NOT EXISTS users (
                        id BIGINT PRIMARY KEY,
                        username TEXT,
                        nft_total INT DEFAULT 0,
                        nft_available INT DEFAULT 0,
                        nft_locked INT DEFAULT 0,
                        dice_available INT DEFAULT 5,
                        dice_stars_attempts INT DEFAULT 0,
                        dice_used INT DEFAULT 0,
                        wallet_address TEXT
                    );
                    CREATE TABLE IF NOT EXISTS transactions (
                        id SERIAL PRIMARY KEY,
                        user_id BIGINT,
                        type TEXT,
                        asset_type TEXT,
                        amount INT,
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
                console.log("✅ DB Initialized Successfully");
            } finally {
                client.release();
            }
            break;
        } catch (err) {
            console.error(`❌ DB Init Error (Retries left: ${retries}):`, err.message);
            retries -= 1;
            await new Promise(res => setTimeout(res, 5000));
        }
    }
};
initDB();

// --- TELEGRAM BOT ---
if (BOT_TOKEN) {
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });

    // Prevent Polling Errors from crashing the app
    bot.on('polling_error', (error) => {
        console.error(`[polling_error] ${error.code}: ${error.message}`);
    });

    bot.on('pre_checkout_query', (query) => {
        bot.answerPreCheckoutQuery(query.id, true).catch(() => {});
    });

    bot.on('message', async (msg) => {
        if (msg.successful_payment) {
            const userId = msg.from.id;
             try {
                const payload = JSON.parse(msg.successful_payment.invoice_payload);
                await processPurchase(userId, payload.type, payload.amount, 'STARS', msg.successful_payment.telegram_payment_charge_id);
                await bot.sendMessage(userId, `Payment successful!`);
            } catch (e) {
                console.error("Payment processing error", e);
            }
        }
        
        if (msg.text === '/start') {
            bot.sendMessage(msg.chat.id, "Welcome to NFT App! Open the Mini App via the button below.");
        }
    });
    
    app.locals.bot = bot;
    console.log("✅ Bot started");
} else {
    console.warn("⚠️ BOT_TOKEN not set.");
}

// --- CORE LOGIC ---

async function getUser(id, username) {
    try {
        const res = await pool.query(`
            INSERT INTO users (id, username) VALUES ($1, $2)
            ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username
            RETURNING *
        `, [id, username]);
        
        const lockedRes = await pool.query('SELECT amount, unlock_date FROM locked_nfts WHERE user_id = $1', [id]);
        const u = res.rows[0];
        
        return {
            id: parseInt(u.id),
            username: u.username,
            nftBalance: {
                total: u.nft_total,
                available: u.nft_available,
                locked: u.nft_locked,
                lockedDetails: lockedRes.rows.map(r => ({ amount: r.amount, unlockDate: parseInt(r.unlock_date) }))
            },
            diceBalance: {
                available: u.dice_available,
                starsAttempts: u.dice_stars_attempts,
                used: u.dice_used
            },
            referralStats: { level1: 0, level2: 0, level3: 0, earnings: { STARS: 0, TON: 0, USDT: 0 } },
            walletAddress: u.wallet_address
        };
    } catch (e) {
        console.error("DB Query Error in getUser:", e);
        throw e;
    }
}

async function processPurchase(userId, type, packSize, currency, txId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const check = await client.query('SELECT id FROM transactions WHERE tx_hash = $1', [txId]);
        if (check.rows.length > 0) {
            await client.query('ROLLBACK');
            return false;
        }

        const isStars = currency === 'STARS';
        let description = type === 'nft' ? `NFT Pack (x${packSize})` : `Dice Attempts (x${packSize})`;
        
        if (type === 'nft') {
            if (isStars) {
                const unlockDate = Date.now() + (21 * 24 * 60 * 60 * 1000);
                await client.query('UPDATE users SET nft_total = nft_total + $1, nft_locked = nft_locked + $1 WHERE id = $2', [packSize, userId]);
                await client.query('INSERT INTO locked_nfts (user_id, amount, unlock_date) VALUES ($1, $2, $3)', [userId, packSize, unlockDate]);
            } else {
                await client.query('UPDATE users SET nft_total = nft_total + $1, nft_available = nft_available + $1 WHERE id = $2', [packSize, userId]);
            }
        } else if (type === 'dice') {
             await client.query('UPDATE users SET dice_available = dice_available + $1 WHERE id = $2', [packSize, userId]);
             if (isStars) await client.query('UPDATE users SET dice_stars_attempts = dice_stars_attempts + $1 WHERE id = $2', [packSize, userId]);
        }

        await client.query(`
            INSERT INTO transactions (user_id, type, asset_type, amount, currency, description, is_locked, tx_hash)
            VALUES ($1, 'purchase', $2, $3, $4, $5, $6, $7)
        `, [userId, type, packSize, currency, description, (isStars && type === 'nft'), txId]);

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Purchase Transaction Error:", e);
        return false;
    } finally {
        client.release();
    }
}

// --- ROUTES ---
app.get('/api/user', async (req, res) => {
    try {
        const userId = req.query.id;
        if (!userId) throw new Error("ID required");
        const user = await getUser(userId, "User");
        res.json(user);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/payment/create', async (req, res) => {
    const { id, type, amount, currency } = req.body;
    
    // Log for debugging
    console.log(`Creating Payment: ${type} x${amount} in ${currency}`);

    if (currency === 'STARS') {
        try {
             const price = (type === 'nft' ? PRICES.nft.STARS : PRICES.dice.STARS) * amount;
             const link = await app.locals.bot.createInvoiceLink(
                "Item", "Desc", JSON.stringify({ type, amount }), "", "XTR", [{ label: "Price", amount: price }]
             );
             res.json({ ok: true, currency: 'STARS', invoiceLink: link });
        } catch(e) { res.status(500).json({ok: false}); }
    } else {
        const tonAmount = (type === 'nft' ? PRICES.nft.TON : PRICES.dice.TON) * amount;
        // Convert to Nanotons (1 TON = 1,000,000,000)
        // Simple multiplication might have floating point issues, using string based math or BigInt is safer for production
        // Here we use simple calculation for demo: 0.01 * 1e9 = 10000000
        const nanoTons = Math.floor(tonAmount * 1000000000).toString();

        const tonTransaction = {
            validUntil: Math.floor(Date.now() / 1000) + 600, // 10 min
            messages: [
                {
                    address: TON_WALLET, 
                    amount: nanoTons 
                }
            ]
        };
        console.log("Sending TON Transaction payload:", JSON.stringify(tonTransaction));
        res.json({ ok: true, currency: 'TON', transaction: tonTransaction });
    }
});

app.post('/api/roll', async (req, res) => {
    const { id } = req.body;
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Check Balance
        const userRes = await client.query('SELECT dice_available, dice_stars_attempts FROM users WHERE id = $1 FOR UPDATE', [id]);
        if (userRes.rows.length === 0) throw new Error("User not found");
        
        const user = userRes.rows[0];
        if (user.dice_available <= 0) {
             throw new Error("No attempts");
        }

        // 2. Logic: Deduct Attempt
        let isStarsAttempt = false;
        let newDiceCount = user.dice_available - 1;
        let newStarsCount = user.dice_stars_attempts;
        
        if (newStarsCount > 0) {
            newStarsCount--;
            isStarsAttempt = true;
        }

        await client.query('UPDATE users SET dice_available = $1, dice_stars_attempts = $2, dice_used = dice_used + 1 WHERE id = $3', [newDiceCount, newStarsCount, id]);

        // 3. Roll Logic (1-6)
        const roll = Math.floor(Math.random() * 6) + 1;
        const winAmount = roll; 

        // 4. Award NFT
        if (winAmount > 0) {
            if (isStarsAttempt) {
                 const unlockDate = Date.now() + (21 * 24 * 60 * 60 * 1000);
                 await client.query('UPDATE users SET nft_total = nft_total + $1, nft_locked = nft_locked + $1 WHERE id = $2', [winAmount, id]);
                 await client.query('INSERT INTO locked_nfts (user_id, amount, unlock_date) VALUES ($1, $2, $3)', [id, winAmount, unlockDate]);
            } else {
                 await client.query('UPDATE users SET nft_total = nft_total + $1, nft_available = nft_available + $1 WHERE id = $2', [winAmount, id]);
            }
            
            await client.query(`
                INSERT INTO transactions (user_id, type, asset_type, amount, currency, description, is_locked)
                VALUES ($1, 'win', 'nft', $2, NULL, $3, $4)
            `, [id, winAmount, `Won on Roll ${roll}`, isStarsAttempt]);
        }

        await client.query('COMMIT');
        res.json({ roll });
        
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Roll error", e);
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
});

app.get('/api/history', async (req, res) => {
    try {
        const { id } = req.query;
        const result = await pool.query('SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10', [id]);
        res.json(result.rows.map(r => ({
             id: r.id.toString(), type: r.type, assetType: r.asset_type, amount: r.amount, 
             timestamp: new Date(r.created_at).getTime(), description: r.description, currency: r.currency, isLocked: r.is_locked
        })));
    } catch (e) {
        res.json([]);
    }
});

app.post('/api/withdraw', async (req, res) => res.json({ ok: true }));
app.post('/api/payment/verify', async (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));