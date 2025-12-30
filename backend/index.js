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
const PORT = process.env.PORT || 8080;
const BOT_TOKEN = process.env.BOT_TOKEN;

// Default Testnet Wallet
const USER_TESTNET_WALLET = "0QBycgJ7cxTLe4Y84HG6tOGQgf-284Es4zJzVJM8R2h1U_av"; 
const TON_WALLET = process.env.RECEIVER_TON_ADDRESS_TESTNET || USER_TESTNET_WALLET;

console.log(`✅ Using Payment Wallet Address: ${TON_WALLET}`);

// Prices - Synced with Frontend Constants generally, but TON kept low for Testnet
const PRICES = {
    nft: { STARS: 2000, TON: 0.011 }, // 0.05 TON for testnet usability
    dice: { STARS: 6666, TON: 0.036 }
};

// Referral Percentages (Level 1, Level 2, Level 3)
const REF_LEVELS = [0.05, 0.03, 0.01]; 

// --- DATABASE CONFIGURATION ---
const dbConfig = {
    user: process.env.DB_USER || process.env.POSTGRES_POSTGRES_USER || 'user',
    password: process.env.DB_PASSWORD || process.env.POSTGRES_POSTGRES_PASSWORD || 'pass',
    database: process.env.DB_NAME || process.env.POSTGRES_POSTGRES_DB || 'nft_db',
    host: process.env.DB_HOST || 'postgres',
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
                // 1. Create Base Tables
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

                // 2. Add Columns if they don't exist (Migration)
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
            console.error(`❌ DB Init Error:`, err.message);
            retries -= 1;
            await new Promise(res => setTimeout(res, 5000));
        }
    }
};
initDB();

// --- TELEGRAM BOT ---
if (BOT_TOKEN) {
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });
    bot.on('polling_error', (error) => console.error(`[polling_error] ${error.code}: ${error.message}`));
    
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
            // Handle Start Link directly in bot for better UX (optional)
            bot.sendMessage(msg.chat.id, "Welcome! Open the Mini App to start.", {
                reply_markup: {
                    inline_keyboard: [[{ text: "Open App", web_app: { url: "https://t.me/nahuy_NFT_bot/app" } }]]
                }
            });
        }
    });
    app.locals.bot = bot;
}

// --- CORE LOGIC ---

function generateReferralCode() {
    return crypto.randomBytes(4).toString('hex'); // 8 char random string
}

async function getUser(id, username, incomingRefCode) {
    const client = await pool.connect();
    let debugLog = [];
    
    try {
        debugLog.push(`Processing User ${id}. Incoming Code: "${incomingRefCode}"`);
        
        // 1. Check if user exists (Select referrer_id too!)
        const checkRes = await client.query('SELECT id, referral_code, referrer_id FROM users WHERE id = $1', [id]);
        const existingUser = checkRes.rows[0];
        const isNewUser = !existingUser;
        
        let actualReferrerId = null;
        let myReferralCode = existingUser?.referral_code;

        // 2. Resolve Referral Code if present
        if (incomingRefCode && incomingRefCode !== "none" && incomingRefCode !== "") {
            const codeStr = String(incomingRefCode).trim();
            
            // Check self-referral (Code match)
            let isSelf = false;
            if (existingUser && existingUser.referral_code === codeStr) isSelf = true;
            if (codeStr === String(id)) isSelf = true;

            if (!isSelf) {
                // A. Try finding by unique Referral Code
                let refCheck = await client.query('SELECT id FROM users WHERE referral_code = $1', [codeStr]);
                
                if (refCheck.rows.length > 0) {
                     actualReferrerId = refCheck.rows[0].id;
                     debugLog.push(`Found referrer by Code: ${actualReferrerId}`);
                } else {
                     // B. If not found, try finding by User ID (Legacy)
                     // STRICT CHECK: Only if string is pure digits
                     if (/^\d+$/.test(codeStr)) {
                         refCheck = await client.query('SELECT id FROM users WHERE id = $1', [codeStr]);
                         if (refCheck.rows.length > 0) {
                             actualReferrerId = refCheck.rows[0].id;
                             debugLog.push(`Found referrer by ID: ${actualReferrerId}`);
                         } else {
                             debugLog.push(`Ref ID ${codeStr} not found in DB`);
                         }
                     } else {
                         debugLog.push(`Ref Code ${codeStr} not found in DB`);
                     }
                }
    
                if (actualReferrerId && String(actualReferrerId) === String(id)) {
                    actualReferrerId = null; 
                    debugLog.push("Self-referral detected after ID resolution");
                }
            } else {
                debugLog.push("Self-referral rejected early");
            }
        } else {
            debugLog.push("No valid incoming ref code");
        }

        // 3. Generate Referral Code for this user if missing
        if (!myReferralCode) {
            myReferralCode = generateReferralCode();
        }

        // 4. UPSERT LOGIC
        if (isNewUser) {
            debugLog.push(`Creating NEW user. RefID: ${actualReferrerId}`);
            await client.query(`
                INSERT INTO users (id, username, referral_code, referrer_id) VALUES ($1, $2, $3, $4)
            `, [id, username, myReferralCode, actualReferrerId]);
        } else {
            // User Exists - Check Late Binding
            // We use loose comparison for null checks to be safe
            if (!existingUser.referrer_id && actualReferrerId) {
                debugLog.push(`LATE BINDING: Linking ${id} to ${actualReferrerId}`);
                await client.query(`
                    UPDATE users SET username = $1, referral_code = $2, referrer_id = $3 WHERE id = $4
                `, [username, myReferralCode, actualReferrerId, id]);
            } else {
                debugLog.push(`User exists. Current Ref: ${existingUser.referrer_id}. New Ref candidate: ${actualReferrerId}`);
                await client.query(`
                    UPDATE users SET username = $1, referral_code = $2 WHERE id = $3
                `, [username, myReferralCode, id]);
            }
        }

        // 5. Fetch Full User Data
        const res = await client.query('SELECT * FROM users WHERE id = $1', [id]);
        const u = res.rows[0];
        const lockedRes = await client.query('SELECT amount, unlock_date FROM locked_nfts WHERE user_id = $1', [id]);

        // 6. Calculate Referral Stats
        const lvl1 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id = $1', [id]);
        const lvl2 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id = $1)', [id]);
        const lvl3 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id = $1))', [id]);

        return {
            id: parseInt(u.id),
            username: u.username,
            referralCode: u.referral_code,
            referrerId: u.referrer_id ? parseInt(u.referrer_id) : null,
            referralDebug: debugLog.join(" | "), // SEND DEBUG LOGS TO FRONTEND
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
        } else {
            console.log(`ℹ️ Buyer ${userId} has no referrer. No rewards distributed.`);
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

    console.log(`   -> Reward Lvl ${levelIndex+1}: User ${referrerId} gets ${reward} ${currency}`);

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

// ADMIN DEBUG ROUTE
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
        // Just take the raw refId parameter (now a string code)
        // Ensure we strip 'ref_' if frontend sent it, but 'abc' stays 'abc'
        const rawRef = req.query.refId;
        const refCode = rawRef ? rawRef.replace(/^ref_/, '') : null;
        
        if (!userId) throw new Error("ID required");
        
        const user = await getUser(userId, "User", refCode);
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
        
        // 1 TON = 1e9 nanotons.
        const nanoTons = Math.round(totalTonAmount * 1000000000).toString();

        console.log(`Payment: ${quantity} x ${unitPrice} = ${totalTonAmount} TON`);

        const tonTransaction = {
            validUntil: Math.floor(Date.now() / 1000) + 3600, 
            messages: [{ address: TON_WALLET, amount: nanoTons }]
        };
        res.json({ ok: true, currency: 'TON', transaction: tonTransaction });
    }
});

// IMPORTANT: This was previously a stub. Now it processes the purchase.
app.post('/api/payment/verify', async (req, res) => {
    const { id, type, amount, currency } = req.body;
    
    if (!id || !amount) {
        return res.status(400).json({ error: "Missing data" });
    }

    try {
        console.log(`✅ Verifying TON Payment for User ${id}: ${amount} ${type}`);
        
        // In a real production environment, you should verify the transaction on blockchain
        // using the user's wallet address or a comment/payload attached to the tx.
        // For this demo, we assume the frontend (TonConnect) was successful.
        
        // Generate a pseudo-unique hash for this transaction since we don't have the real hash from frontend here
        const txId = `ton_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const success = await processPurchase(id, type, parseInt(amount), currency, txId);
        
        if (success) {
            res.json({ ok: true });
        } else {
            res.status(500).json({ error: "Processing failed" });
        }
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

app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));