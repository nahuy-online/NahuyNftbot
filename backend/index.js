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
const WEBAPP_URL = "https://t.me/nahuy_NFT_bot/app"; // Your MiniApp Direct Link

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
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id BIGINT PRIMARY KEY,
                username TEXT,
                referral_code TEXT UNIQUE,
                referrer_id BIGINT,
                
                -- Balances
                nft_total INT DEFAULT 0,
                nft_available INT DEFAULT 0,
                nft_locked INT DEFAULT 0,
                dice_available INT DEFAULT 0,
                dice_stars_attempts INT DEFAULT 0,
                
                -- Referral Earnings
                ref_rewards_stars INT DEFAULT 0,
                ref_rewards_ton NUMERIC(18, 9) DEFAULT 0,
                ref_rewards_usdt NUMERIC(18, 2) DEFAULT 0,
                
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                user_id BIGINT,
                type TEXT, -- 'purchase', 'win', 'withdraw', 'referral_reward'
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
        console.log("✅ Database Schema Synced");
    } catch (e) {
        console.error("❌ DB Init Failed:", e);
    } finally {
        client.release();
    }
};
initDB();

// --- TELEGRAM BOT ---
if (BOT_TOKEN) {
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });
    
    // Handle /start command (Entry point 1)
    bot.onText(/\/start(.*)/, (msg, match) => {
        const chatId = msg.chat.id;
        // If user follows t.me/bot?start=123, match[1] will be " 123"
        const startParam = match[1] ? match[1].trim() : "";
        
        // We construct the Web App URL passing the startapp param explicitly
        // This ensures the Mini App receives the referral code in initDataUnsafe.start_param
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
            } catch (e) {
                console.error("Payment Error:", e);
            }
        }
    });
    app.locals.bot = bot;
}

// --- REFERRAL LOGIC ---

// 1. Generate unique code if not exists
function generateRefCode(userId) {
    // Simple: "ref_" + ID (Robust and collision-free)
    return `ref_${userId}`;
}

// 2. Bind Referrer
async function bindReferrer(client, userId, potentialRefCode) {
    if (!potentialRefCode || potentialRefCode === "none") return null;

    // Remove "ref_" prefix if present to find ID, or handle custom codes
    let referrerId = null;
    
    // Strategy A: Check by full code
    const resByCode = await client.query('SELECT id FROM users WHERE referral_code = $1', [potentialRefCode]);
    if (resByCode.rows.length > 0) referrerId = resByCode.rows[0].id;

    // Strategy B: Fallback, maybe code is just the ID (Legacy)
    if (!referrerId && /^\d+$/.test(potentialRefCode.replace('ref_', ''))) {
        const rawId = potentialRefCode.replace('ref_', '');
        const resById = await client.query('SELECT id FROM users WHERE id = $1', [rawId]);
        if (resById.rows.length > 0) referrerId = resById.rows[0].id;
    }

    // Validation: Cannot refer self, Circular dependency check (Level 1 only for speed)
    if (referrerId && String(referrerId) !== String(userId)) {
        await client.query('UPDATE users SET referrer_id = $1 WHERE id = $2', [referrerId, userId]);
        return referrerId;
    }
    return null;
}

// 3. Distribute Rewards (Recursive 3 Levels)
async function distributeRewards(client, buyerId, amount, currency) {
    console.log(`💸 Distributing Rewards for purchase of ${amount} ${currency} by ${buyerId}`);
    
    // Get Buyer's Referrer (Level 1)
    const u1 = await client.query('SELECT referrer_id FROM users WHERE id = $1', [buyerId]);
    if (!u1.rows[0]?.referrer_id) return; // No referrer, stop.

    const level1_ID = u1.rows[0].referrer_id;
    await payReward(client, level1_ID, amount, currency, 0, buyerId);

    // Get Level 2
    const u2 = await client.query('SELECT referrer_id FROM users WHERE id = $1', [level1_ID]);
    if (u2.rows[0]?.referrer_id) {
        const level2_ID = u2.rows[0].referrer_id;
        await payReward(client, level2_ID, amount, currency, 1, buyerId);

        // Get Level 3
        const u3 = await client.query('SELECT referrer_id FROM users WHERE id = $1', [level2_ID]);
        if (u3.rows[0]?.referrer_id) {
            const level3_ID = u3.rows[0].referrer_id;
            await payReward(client, level3_ID, amount, currency, 2, buyerId);
        }
    }
}

async function payReward(client, recipientId, totalPurchaseAmount, currency, levelIdx, sourceUserId) {
    const percent = REF_LEVELS[levelIdx]; // 0.07, 0.05, 0.03
    const reward = totalPurchaseAmount * percent;
    
    if (reward <= 0) return;

    // Update Balance
    let colName = 'ref_rewards_ton';
    if (currency === 'STARS') colName = 'ref_rewards_stars';
    if (currency === 'USDT') colName = 'ref_rewards_usdt';

    // Round DOWN for integers (Stars), keep float for crypto
    const finalAmount = currency === 'STARS' ? Math.floor(reward) : reward;
    
    if (finalAmount <= 0) return;

    await client.query(`UPDATE users SET ${colName} = ${colName} + $1 WHERE id = $2`, [finalAmount, recipientId]);
    
    // Log Transaction
    await client.query(`
        INSERT INTO transactions (user_id, type, asset_type, amount, currency, description)
        VALUES ($1, 'referral_reward', 'currency', $2, $3, $4)
    `, [recipientId, finalAmount, currency, `Lvl ${levelIdx + 1} Reward from user ${sourceUserId}`]);

    console.log(`   -> Paid ${finalAmount} ${currency} to ${recipientId} (Lvl ${levelIdx+1})`);
}

// --- API ROUTES ---

// 1. AUTH & BINDING (The most important endpoint)
app.post('/api/auth', async (req, res) => {
    const { id, username, startParam } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Upsert User
        let userRes = await client.query('SELECT * FROM users WHERE id = $1', [id]);
        let user = userRes.rows[0];
        let isNew = false;

        if (!user) {
            isNew = true;
            const myRefCode = generateRefCode(id);
            // Insert basic user
            await client.query(
                'INSERT INTO users (id, username, referral_code) VALUES ($1, $2, $3)', 
                [id, username, myRefCode]
            );
            user = { id, username, referral_code: myRefCode, referrer_id: null };
        }

        // Handle Referral Binding
        // Conditions: 
        // 1. User has no referrer yet.
        // 2. Incoming startParam exists.
        // 3. startParam is not self.
        if (!user.referrer_id && startParam && startParam !== "none" && startParam !== user.referral_code) {
            console.log(`🔗 Binding User ${id} to referrer code: ${startParam}`);
            const boundId = await bindReferrer(client, id, startParam);
            if (boundId) user.referrer_id = boundId;
        }

        await client.query('COMMIT');

        // Fetch Stats for UI
        const rewards = {
            STARS: user.ref_rewards_stars || 0,
            TON: user.ref_rewards_ton || 0,
            USDT: user.ref_rewards_usdt || 0
        };
        
        // Count Network
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
                total: user.nft_total,
                available: user.nft_available,
                locked: user.nft_locked,
                lockedDetails: lockedRes.rows.map(r => ({ amount: r.amount, unlockDate: parseInt(r.unlock_date) }))
            },
            diceBalance: {
                available: user.dice_available,
                starsAttempts: user.dice_stars_attempts
            },
            referralStats: {
                level1: parseInt(lvl1.rows[0].count),
                level2: parseInt(lvl2.rows[0].count),
                level3: parseInt(lvl3.rows[0].count),
                earnings: rewards
            }
        });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Auth Error:", e);
        res.status(500).json({ error: "Auth failed" });
    } finally {
        client.release();
    }
});

// 2. CREATE PAYMENT
app.post('/api/payment/create', async (req, res) => {
    const { id, type, amount, currency } = req.body; // amount = quantity
    const priceMap = type === 'nft' ? PRICES.nft : PRICES.dice;
    const unitPrice = priceMap[currency];
    const totalPrice = unitPrice * amount;

    if (currency === 'STARS') {
        try {
            const link = await app.locals.bot.createInvoiceLink(
                type === 'nft' ? "NFT Pack" : "Dice Attempts", 
                `Qty: ${amount}`, 
                JSON.stringify({ type, amount }), // Payload
                "", "XTR", 
                [{ label: `${amount} items`, amount: totalPrice }]
            );
            res.json({ ok: true, invoiceLink: link });
        } catch(e) { res.status(500).json({error: "Bot Error"}); }
    } else {
        // TON
        const nanoTons = Math.round(totalPrice * 1e9).toString();
        // Use a fixed wallet for testnet
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

// 3. VERIFY PAYMENT (AND DISTRIBUTE REWARDS)
app.post('/api/payment/verify', async (req, res) => {
    const { id, type, amount, currency } = req.body;
    await handlePurchaseSuccess(id, type, amount, currency, `manual_${Date.now()}`);
    res.json({ ok: true });
});

async function handlePurchaseSuccess(userId, type, qty, currency, txHash) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Check duplicate
        const dup = await client.query('SELECT id FROM transactions WHERE tx_hash = $1', [txHash]);
        if (dup.rows.length > 0) { await client.query('ROLLBACK'); return; }

        const isStars = currency === 'STARS';
        
        // Give Items
        if (type === 'nft') {
            if (isStars) {
                 const unlock = Date.now() + (21 * 86400000);
                 await client.query('UPDATE users SET nft_total=nft_total+$1, nft_locked=nft_locked+$1 WHERE id=$2', [qty, userId]);
                 await client.query('INSERT INTO locked_nfts (user_id, amount, unlock_date) VALUES ($1, $2, $3)', [userId, qty, unlock]);
            } else {
                 await client.query('UPDATE users SET nft_total=nft_total+$1, nft_available=nft_available+$1 WHERE id=$2', [qty, userId]);
            }
        } else {
            // Dice
            await client.query('UPDATE users SET dice_available=dice_available+$1 WHERE id=$2', [qty, userId]);
            if (isStars) await client.query('UPDATE users SET dice_stars_attempts=dice_stars_attempts+$1 WHERE id=$2', [qty, userId]);
        }

        // Record Tx
        await client.query(`
            INSERT INTO transactions (user_id, type, asset_type, amount, currency, description, is_locked, tx_hash)
            VALUES ($1, 'purchase', $2, $3, $4, $5, $6, $7)
        `, [userId, type, qty, currency, `Purchase ${qty} ${type}`, (isStars && type==='nft'), txHash]);

        // DISTRIBUTE REWARDS
        // Calculate Total Price paid
        const priceMap = type === 'nft' ? PRICES.nft : PRICES.dice;
        const totalPaid = priceMap[currency] * qty;
        
        // IMPORTANT: Must happen before commit
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

// 4. ROLL DICE
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
        const win = roll; // 1 to 6 NFT

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

// 5. HISTORY & MISC
app.get('/api/history', async (req, res) => {
    const { id } = req.query;
    const r = await pool.query('SELECT * FROM transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [id]);
    res.json(r.rows.map(x => ({
        id: x.id, type: x.type, amount: x.amount, description: x.description, 
        timestamp: new Date(x.created_at).getTime(), currency: x.currency, isLocked: x.is_locked, assetType: x.asset_type
    })));
});

app.post('/api/withdraw', async (req, res) => {
    // Mock withdraw
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
