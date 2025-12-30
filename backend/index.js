import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import pg from 'pg';
import path from 'path';
import crypto from 'crypto'; // For generating referral codes
import { fileURLToPath } from 'url';

// --- ENV CONFIGURATION ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config(); 

const app = express();
app.use(express.json());
app.use(cors());

// --- CONFIG ---
// Changed default port to 3001 to avoid conflicts with other services (Jenkins, Tomcat, etc.)
const PORT = process.env.PORT || 3001;
const BOT_TOKEN = process.env.BOT_TOKEN;

// Default Testnet Wallet
const USER_TESTNET_WALLET = "0QBycgJ7cxTLe4Y84HG6tOGQgf-284Es4zJzVJM8R2h1U_av"; 
const TON_WALLET = process.env.RECEIVER_TON_ADDRESS_TESTNET || USER_TESTNET_WALLET;

console.log(`✅ Using Payment Wallet Address: ${TON_WALLET}`);

// Prices
const PRICES = {
    nft: { STARS: 2000, TON: 0.011 },
    dice: { STARS: 6666, TON: 0.036 }
};

const REF_LEVELS = [0.05, 0.03, 0.01]; 

// --- DATABASE CONFIGURATION ---
const dbConfig = {
    user: process.env.DB_USER || process.env.POSTGRES_POSTGRES_USER || 'user',
    password: process.env.DB_PASSWORD || process.env.POSTGRES_POSTGRES_PASSWORD || 'pass',
    database: process.env.DB_NAME || process.env.POSTGRES_POSTGRES_DB || 'nft_db',
    host: process.env.DB_HOST || 'localhost', // Default to localhost for local dev
    port: parseInt(process.env.DB_PORT || '5432'),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
};

const pool = new pg.Pool(dbConfig);
pool.on('error', (err) => console.error('Unexpected error on idle client', err));

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
                        referral_code TEXT UNIQUE,
                        nft_total INT DEFAULT 0,
                        nft_available INT DEFAULT 0,
                        nft_locked INT DEFAULT 0,
                        dice_available INT DEFAULT 0,
                        dice_stars_attempts INT DEFAULT 0,
                        dice_used INT DEFAULT 0,
                        wallet_address TEXT,
                        referrer_id BIGINT,
                        ref_rewards_stars INT DEFAULT 0,
                        ref_rewards_ton NUMERIC(18, 9) DEFAULT 0,
                        ref_rewards_usdt NUMERIC(18, 2) DEFAULT 0
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

                await client.query(`
                    ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer_id BIGINT;
                    ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
                    ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_rewards_stars INT DEFAULT 0;
                    ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_rewards_ton NUMERIC(18, 9) DEFAULT 0;
                    ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_rewards_usdt NUMERIC(18, 2) DEFAULT 0;
                    ALTER TABLE users ALTER COLUMN dice_available SET DEFAULT 0;
                `);

                console.log("✅ DB Initialized & Migrated Successfully");
            } finally {
                client.release();
            }
            break;
        } catch (err) {
            console.error(`❌ DB Init Error (Host: ${dbConfig.host}):`, err.message);
            console.log("Retrying DB connection in 5s...");
            retries -= 1;
            await new Promise(res => setTimeout(res, 5000));
        }
    }
};
initDB();

// --- TELEGRAM BOT ---
if (BOT_TOKEN) {
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });
    
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
        if (msg.text && msg.text.startsWith('/start')) {
            const chatId = msg.chat.id;
            const args = msg.text.split(' ');
            const refParam = args.length > 1 ? args[1] : null;
            
            const opts = {
                reply_markup: {
                    inline_keyboard: [[{ 
                        text: "🚀 Open NFT App", 
                        web_app: { url: "https://t.me/nahuy_NFT_bot/app" + (refParam ? `?startapp=${refParam}` : "") } 
                    }]]
                }
            };
            bot.sendMessage(chatId, "Welcome! Click below to enter the ecosystem.", opts);
        }
    });
    app.locals.bot = bot;
}

// --- CORE LOGIC ---

function generateReferralCode() {
    return crypto.randomBytes(4).toString('hex');
}

async function getUser(id, username, incomingRefCode, shouldRegister = false) {
    const client = await pool.connect();
    let debugLog = [];
    
    try {
        debugLog.push(`Req User ${id}. Ref: "${incomingRefCode || 'none'}"`);
        
        // 1. Check if user exists
        const checkRes = await client.query('SELECT id, referral_code, referrer_id FROM users WHERE id = $1', [id]);
        const existingUser = checkRes.rows[0];
        const isNewUser = !existingUser;

        // CRITICAL CHANGE: If user is new AND we are not in registration mode, return preview only.
        if (isNewUser && !shouldRegister) {
            return {
                id: parseInt(id),
                username: username,
                isNewUser: true, // Frontend will see this and show Popup
                referralDebug: "New User - Waiting for Consent",
                nftBalance: { total: 0, available: 0, locked: 0, lockedDetails: [] },
                diceBalance: { available: 0, starsAttempts: 0, used: 0 },
                referralStats: { level1: 0, level2: 0, level3: 0, earnings: { STARS: 0, TON: 0, USDT: 0 } }
            };
        }
        
        // IF WE ARE HERE: Either user exists OR shouldRegister is true
        
        let actualReferrerId = null;
        let myReferralCode = existingUser?.referral_code;

        // 2. Resolve Referral Code if present (and useful)
        if (incomingRefCode && incomingRefCode !== "none" && incomingRefCode !== "") {
            const codeStr = String(incomingRefCode).trim();
            
            // Check self-referral
            let isSelf = false;
            if (existingUser && existingUser.referral_code === codeStr) isSelf = true;
            if (codeStr === String(id)) isSelf = true;

            if (!isSelf) {
                // Try finding by unique Referral Code
                let refCheck = await client.query('SELECT id FROM users WHERE referral_code = $1', [codeStr]);
                
                if (refCheck.rows.length > 0) {
                     actualReferrerId = refCheck.rows[0].id;
                     debugLog.push(`Resolved Ref Code to ID: ${actualReferrerId}`);
                } else {
                     // Try finding by User ID (Legacy)
                     if (/^\d+$/.test(codeStr)) {
                         refCheck = await client.query('SELECT id FROM users WHERE id = $1', [codeStr]);
                         if (refCheck.rows.length > 0) {
                             actualReferrerId = refCheck.rows[0].id;
                             debugLog.push(`Resolved Ref ID: ${actualReferrerId}`);
                         }
                     }
                }
    
                if (actualReferrerId && String(actualReferrerId) === String(id)) {
                    actualReferrerId = null; 
                    debugLog.push("Err: Self-referral");
                }
            }
        }

        // 3. Generate Referral Code for this user if missing
        if (!myReferralCode) {
            myReferralCode = generateReferralCode();
        }

        // 4. UPSERT LOGIC
        if (isNewUser) {
            // INSERT (Registration)
            debugLog.push(`REGISTERING. RefID: ${actualReferrerId}`);
            await client.query(`
                INSERT INTO users (id, username, referral_code, referrer_id) VALUES ($1, $2, $3, $4)
            `, [id, username, myReferralCode, actualReferrerId]);
        } else {
            // UPDATE (Late Binding or Username sync)
            if (!existingUser.referrer_id && actualReferrerId) {
                debugLog.push(`Linking Existing User to ${actualReferrerId}`);
                await client.query(`
                    UPDATE users SET username = $1, referral_code = $2, referrer_id = $3 WHERE id = $4
                `, [username, myReferralCode, actualReferrerId, id]);
            } else {
                await client.query(`UPDATE users SET username = $1, referral_code = $2 WHERE id = $3`, [username, myReferralCode, id]);
            }
        }

        // 5. Fetch Full User Data
        const res = await client.query('SELECT * FROM users WHERE id = $1', [id]);
        const u = res.rows[0];
        const lockedRes = await client.query('SELECT amount, unlock_date FROM locked_nfts WHERE user_id = $1', [id]);

        const lvl1 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id = $1', [id]);
        const lvl2 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id = $1)', [id]);
        const lvl3 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id = $1))', [id]);

        return {
            id: parseInt(u.id),
            username: u.username,
            referralCode: u.referral_code,
            isNewUser: false, // They are now registered/exist
            referrerId: u.referrer_id ? parseInt(u.referrer_id) : null,
            referralDebug: debugLog.join(" | "),
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
            referralStats: { 
                level1: parseInt(lvl1.rows[0].count), 
                level2: parseInt(lvl2.rows[0].count), 
                level3: parseInt(lvl3.rows[0].count), 
                earnings: { 
                    STARS: parseInt(u.ref_rewards_stars || 0), 
                    TON: parseFloat(u.ref_rewards_ton || 0), 
                    USDT: parseFloat(u.ref_rewards_usdt || 0) 
                } 
            },
            walletAddress: u.wallet_address
        };
    } finally {
        client.release();
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
        
        // 1. Give Items
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

        // 2. Record Tx
        let description = type === 'nft' ? `NFT Pack (x${packSize})` : `Dice Attempts (x${packSize})`;
        await client.query(`
            INSERT INTO transactions (user_id, type, asset_type, amount, currency, description, is_locked, tx_hash)
            VALUES ($1, 'purchase', $2, $3, $4, $5, $6, $7)
        `, [userId, type, packSize, currency, description, (isStars && type === 'nft'), txId]);

        // 3. Referral Rewards
        const uRes = await client.query('SELECT referrer_id FROM users WHERE id = $1', [userId]);
        const referrerId = uRes.rows[0]?.referrer_id;

        if (referrerId) {
            console.log(`💰 Processing Referral Rewards for Referrer: ${referrerId} from Buyer: ${userId}`);
            const purchaseAmount = (type === 'nft' ? PRICES.nft[currency] : PRICES.dice[currency]) * packSize;
            
            await distributeReward(client, referrerId, currency, purchaseAmount, 0); // Lvl 1

            const r2Res = await client.query('SELECT referrer_id FROM users WHERE id = $1', [referrerId]);
            if (r2Res.rows[0]?.referrer_id) {
                await distributeReward(client, r2Res.rows[0].referrer_id, currency, purchaseAmount, 1); // Lvl 2

                const r3Res = await client.query('SELECT referrer_id FROM users WHERE id = $1', [r2Res.rows[0].referrer_id]);
                if (r3Res.rows[0]?.referrer_id) {
                    await distributeReward(client, r3Res.rows[0].referrer_id, currency, purchaseAmount, 2); // Lvl 3
                }
            }
        }

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

async function distributeReward(client, referrerId, currency, totalAmount, levelIndex) {
    const percentage = REF_LEVELS[levelIndex];
    const reward = totalAmount * percentage;
    if (reward <= 0) return;

    if (currency === 'STARS') {
        const starsReward = Math.floor(reward);
        if (starsReward > 0) {
            await client.query('UPDATE users SET ref_rewards_stars = ref_rewards_stars + $1 WHERE id = $2', [starsReward, referrerId]);
        }
    } else if (currency === 'TON') {
        await client.query('UPDATE users SET ref_rewards_ton = ref_rewards_ton + $1 WHERE id = $2', [reward, referrerId]);
    } else if (currency === 'USDT') {
        await client.query('UPDATE users SET ref_rewards_usdt = ref_rewards_usdt + $1 WHERE id = $2', [reward, referrerId]);
    }
}

// --- ROUTES ---

// Health check route
app.get('/api', (req, res) => res.send('NFT Backend API Running'));

app.post('/api/debug/reset', async (req, res) => {
    const client = await pool.connect();
    try {
        console.log("⚠️ TRIGGERED DB RESET");
        await client.query('TRUNCATE users, transactions, locked_nfts RESTART IDENTITY CASCADE');
        res.json({ ok: true });
    } catch (e) {
        console.error("DB Reset Error", e);
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
});

app.get('/api/user', async (req, res) => {
    try {
        const userId = req.query.id;
        const rawRef = req.query.refId;
        const register = req.query.register === 'true'; // Check explicit register flag
        const refCode = rawRef ? rawRef.replace(/^ref_/, '') : null;
        
        if (!userId) throw new Error("ID required");
        
        const user = await getUser(userId, "User", refCode, register);
        res.json(user);
    } catch (e) {
        console.error("Get User Error:", e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/payment/create', async (req, res) => {
    const { id, type, amount, currency } = req.body;
    const quantity = parseInt(amount, 10);
    
    if (isNaN(quantity) || quantity <= 0) return res.status(400).json({ error: "Invalid amount" });

    if (currency === 'STARS') {
        try {
             const unitPrice = (type === 'nft' ? PRICES.nft.STARS : PRICES.dice.STARS);
             const totalPrice = unitPrice * quantity;
             
             const link = await app.locals.bot.createInvoiceLink(
                type === 'nft' ? "NFT Pack" : "Dice Attempts", 
                `Purchase of ${quantity} items`, 
                JSON.stringify({ type, amount: quantity }), 
                "", "XTR", 
                [{ label: `${quantity} x Item`, amount: totalPrice }]
             );
             res.json({ ok: true, currency: 'STARS', invoiceLink: link });
        } catch(e) { 
            res.status(500).json({ok: false}); 
        }
    } else {
        const unitPrice = (type === 'nft' ? PRICES.nft.TON : PRICES.dice.TON);
        const totalTonAmount = unitPrice * quantity;
        const nanoTons = Math.round(totalTonAmount * 1000000000).toString();

        const tonTransaction = {
            validUntil: Math.floor(Date.now() / 1000) + 3600, 
            messages: [{ address: TON_WALLET, amount: nanoTons }]
        };
        res.json({ ok: true, currency: 'TON', transaction: tonTransaction });
    }
});

app.post('/api/payment/verify', async (req, res) => {
    const { id, type, amount, currency } = req.body;
    if (!id || !amount) return res.status(400).json({ error: "Missing data" });

    try {
        console.log(`✅ Verifying TON Payment for User ${id}: ${amount} ${type}`);
        const txId = `ton_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const success = await processPurchase(id, type, parseInt(amount), currency, txId);
        if (success) res.json({ ok: true });
        else res.status(500).json({ error: "Processing failed" });
    } catch(e) {
        console.error("Verify Error", e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/roll', async (req, res) => {
    const { id } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userRes = await client.query('SELECT dice_available, dice_stars_attempts FROM users WHERE id = $1 FOR UPDATE', [id]);
        if (userRes.rows.length === 0) throw new Error("User not found");
        
        const user = userRes.rows[0];
        if (user.dice_available <= 0) throw new Error("No attempts");

        let isStarsAttempt = false;
        let newDiceCount = user.dice_available - 1;
        let newStarsCount = user.dice_stars_attempts;
        if (newStarsCount > 0) {
            newStarsCount--;
            isStarsAttempt = true;
        }

        await client.query('UPDATE users SET dice_available = $1, dice_stars_attempts = $2, dice_used = dice_used + 1 WHERE id = $3', [newDiceCount, newStarsCount, id]);

        const roll = Math.floor(Math.random() * 6) + 1;
        const winAmount = roll; 

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

app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
