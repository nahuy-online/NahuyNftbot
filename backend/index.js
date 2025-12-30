import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import pg from 'pg';
import path from 'path';
import crypto from 'crypto'; 
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
    dotenv.config({ path: path.resolve(__dirname, '../.env') });
} catch (e) { console.log("[Backend] Could not load ../.env"); }
dotenv.config(); 

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3001;
const BOT_TOKEN = process.env.BOT_TOKEN;
const TON_WALLET = process.env.RECEIVER_TON_ADDRESS_TESTNET || "0QBycgJ7cxTLe4Y84HG6tOGQgf-284Es4zJzVJM8R2h1U_av";

// Prices
const PRICES = {
    nft: { STARS: 2000, TON: 0.011 },
    dice: { STARS: 6666, TON: 0.036 }
};
const REF_LEVELS = [0.05, 0.03, 0.01];

// Logging
app.use((req, res, next) => {
    console.log(`[Backend] ${req.method} ${req.url}`);
    next();
});

// --- DATABASE ---
const dbConfig = {
    user: process.env.DB_USER || 'user',
    password: process.env.DB_PASSWORD || 'pass',
    database: process.env.DB_NAME || 'nft_db',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
};

const pool = new pg.Pool(dbConfig);
pool.on('error', (err) => console.error('Unexpected error on idle client', err));

const initDB = async () => {
    let retries = 5;
    while(retries > 0) {
        try {
            const client = await pool.connect();
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
            console.log("✅ DB Connected & Initialized");
            client.release();
            break;
        } catch (err) {
            console.error(`❌ DB Init Error (Remaining Retries: ${retries}):`, err.message);
            retries--;
            await new Promise(res => setTimeout(res, 2000));
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
            try {
                const payload = JSON.parse(msg.successful_payment.invoice_payload);
                await processPurchase(msg.from.id, payload.type, payload.amount, 'STARS', msg.successful_payment.telegram_payment_charge_id);
                bot.sendMessage(msg.from.id, "Payment successful!");
            } catch (e) { console.error(e); }
        }
    });
    app.locals.bot = bot;
}

// --- LOGIC HELPER FUNCTIONS ---

function generateReferralCode() {
    return crypto.randomBytes(4).toString('hex');
}

async function getUser(idStr, username, incomingRefCode) {
    const client = await pool.connect();
    let debugLog = [];
    let isNewUser = false;
    
    // Convert to String to avoid BigInt JS issues
    const userId = String(idStr); 

    try {
        debugLog.push(`Processing User ${userId}. Ref: "${incomingRefCode}"`);
        
        // 1. Get User (Cast IDs to TEXT)
        const checkRes = await client.query('SELECT id::TEXT, referral_code, referrer_id::TEXT FROM users WHERE id = $1', [userId]);
        const existingUser = checkRes.rows[0];
        isNewUser = !existingUser;
        
        let actualReferrerId = null;
        let myReferralCode = existingUser?.referral_code;

        // 2. Resolve Referrer
        if (incomingRefCode && incomingRefCode !== "none" && incomingRefCode !== "") {
            const codeStr = String(incomingRefCode).trim();
            
            // Self-referral check
            let isSelf = false;
            if (existingUser && existingUser.referral_code === codeStr) isSelf = true;
            if (codeStr === userId) isSelf = true;

            if (!isSelf) {
                // A. Try by Code
                let refCheck = await client.query('SELECT id::TEXT FROM users WHERE referral_code = $1', [codeStr]);
                if (refCheck.rows.length > 0) {
                     actualReferrerId = refCheck.rows[0].id;
                     debugLog.push(`Found Ref by Code: ${actualReferrerId}`);
                } else {
                     // B. Try by ID (Fallback)
                     if (/^\d+$/.test(codeStr)) {
                         refCheck = await client.query('SELECT id::TEXT FROM users WHERE id = $1', [codeStr]);
                         if (refCheck.rows.length > 0) {
                             actualReferrerId = refCheck.rows[0].id;
                             debugLog.push(`Found Ref by ID: ${actualReferrerId}`);
                         }
                     }
                }
                
                // Double check self
                if (actualReferrerId === userId) actualReferrerId = null;
            }
        }

        if (!myReferralCode) {
            myReferralCode = generateReferralCode();
        }

        // 3. UPSERT Logic
        if (isNewUser) {
            debugLog.push(`INSERT User. Ref: ${actualReferrerId || 'NULL'}`);
            await client.query(`
                INSERT INTO users (id, username, referral_code, referrer_id) VALUES ($1, $2, $3, $4)
            `, [userId, username, myReferralCode, actualReferrerId]);
        } else {
            // Late Binding: Only update referrer if I don't have one, but a valid one was passed
            if (!existingUser.referrer_id && actualReferrerId) {
                debugLog.push(`UPDATE User (Late Binding). Set Ref: ${actualReferrerId}`);
                await client.query(`
                    UPDATE users SET username = $1, referral_code = $2, referrer_id = $3 WHERE id = $4
                `, [username, myReferralCode, actualReferrerId, userId]);
            } else {
                await client.query(`UPDATE users SET username = $1, referral_code = $2 WHERE id = $3`, [username, myReferralCode, userId]);
            }
        }

        // 4. Return Data
        const res = await client.query('SELECT *, id::TEXT, referrer_id::TEXT FROM users WHERE id = $1', [userId]);
        const u = res.rows[0];
        const locked = await client.query('SELECT amount, unlock_date FROM locked_nfts WHERE user_id = $1', [userId]);
        
        // Stats
        const lvl1 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id = $1', [userId]);
        const lvl2 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id = $1)', [userId]);
        const lvl3 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id = $1))', [userId]);

        return {
            id: u.id, // String
            username: u.username,
            referralCode: u.referral_code,
            isNewUser: isNewUser,
            referrerId: u.referrer_id, // String or Null
            referralDebug: debugLog.join(" | "),
            nftBalance: {
                total: parseInt(u.nft_total || 0),
                available: parseInt(u.nft_available || 0),
                locked: parseInt(u.nft_locked || 0),
                lockedDetails: locked.rows.map(r => ({ amount: r.amount, unlockDate: parseInt(r.unlock_date) }))
            },
            diceBalance: { available: parseInt(u.dice_available||0), starsAttempts: parseInt(u.dice_stars_attempts||0), used: parseInt(u.dice_used||0) },
            referralStats: { 
                level1: parseInt(lvl1.rows[0].count), 
                level2: parseInt(lvl2.rows[0].count), 
                level3: parseInt(lvl3.rows[0].count), 
                earnings: { STARS: parseInt(u.ref_rewards_stars||0), TON: parseFloat(u.ref_rewards_ton||0), USDT: parseFloat(u.ref_rewards_usdt||0) } 
            },
            walletAddress: u.wallet_address
        };
    } finally { client.release(); }
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

async function processPurchase(userId, type, packSize, currency, txId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const check = await client.query('SELECT id FROM transactions WHERE tx_hash = $1', [txId]);
        if (check.rows.length > 0) { await client.query('ROLLBACK'); return false; }

        const isStars = currency === 'STARS';

        if (type === 'nft') {
            if (isStars) {
                const unlock = Date.now() + (21 * 86400000);
                await client.query('UPDATE users SET nft_total=nft_total+$1, nft_locked=nft_locked+$1 WHERE id=$2', [packSize, userId]);
                await client.query('INSERT INTO locked_nfts (user_id, amount, unlock_date) VALUES ($1,$2,$3)', [userId, packSize, unlock]);
            } else {
                await client.query('UPDATE users SET nft_total=nft_total+$1, nft_available=nft_available+$1 WHERE id=$2', [packSize, userId]);
            }
        } else {
            await client.query('UPDATE users SET dice_available=dice_available+$1 WHERE id=$2', [packSize, userId]);
            if (isStars) await client.query('UPDATE users SET dice_stars_attempts=dice_stars_attempts+$1 WHERE id=$2', [packSize, userId]);
        }

        let desc = type === 'nft' ? `NFT Pack (x${packSize})` : `Dice (x${packSize})`;
        await client.query('INSERT INTO transactions (user_id, type, asset_type, amount, currency, description, is_locked, tx_hash) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [userId, 'purchase', type, packSize, currency, desc, (isStars && type==='nft'), txId]);

        // Referral Rewards
        const uRes = await client.query('SELECT referrer_id::TEXT FROM users WHERE id = $1', [userId]);
        const referrerId = uRes.rows[0]?.referrer_id;

        if (referrerId) {
             const purchaseAmount = (type === 'nft' ? PRICES.nft[currency] : PRICES.dice[currency]) * packSize;
             await distributeReward(client, referrerId, currency, purchaseAmount, 0); // Lvl 1
             
             const r2Res = await client.query('SELECT referrer_id::TEXT FROM users WHERE id = $1', [referrerId]);
             if (r2Res.rows[0]?.referrer_id) {
                 await distributeReward(client, r2Res.rows[0].referrer_id, currency, purchaseAmount, 1); // Lvl 2
                 
                 const r3Res = await client.query('SELECT referrer_id::TEXT FROM users WHERE id = $1', [r2Res.rows[0].referrer_id]);
                 if (r3Res.rows[0]?.referrer_id) {
                     await distributeReward(client, r3Res.rows[0].referrer_id, currency, purchaseAmount, 2); // Lvl 3
                 }
             }
        }

        await client.query('COMMIT');
        return true;
    } catch(e) { await client.query('ROLLBACK'); console.error(e); return false; } finally { client.release(); }
}

// --- API ROUTER ---
const apiRouter = express.Router();

apiRouter.get('/health', (req, res) => res.json({ status: "ok", port: PORT }));

apiRouter.get('/user', async (req, res) => {
    try {
        const { id, refId } = req.query;
        if (!id) return res.status(400).json({ error: "No ID" });
        
        // Strip prefix if present in the raw query param
        const cleanedRef = refId ? String(refId).replace(/^ref_/, '') : null;
        
        const user = await getUser(id, "User", cleanedRef);
        res.json(user);
    } catch (e) { 
        console.error("Get User Error:", e);
        res.status(500).json({ error: e.message }); 
    }
});

apiRouter.post('/payment/create', async (req, res) => {
    const { id, type, amount, currency } = req.body;
    if (currency === 'STARS') {
        try {
            const price = (type === 'nft' ? PRICES.nft.STARS : PRICES.dice.STARS) * amount;
            if (app.locals.bot) {
                const link = await app.locals.bot.createInvoiceLink("Item", "Purchase", JSON.stringify({ type, amount }), "", "XTR", [{ label: "Item", amount: price }]);
                res.json({ ok: true, currency: 'STARS', invoiceLink: link });
            } else {
                res.status(503).json({ ok: false, error: "Bot not initialized" });
            }
        } catch(e) { 
            console.error("Payment Create Error:", e);
            res.status(500).json({ ok: false }); 
        }
    } else {
        const price = (type === 'nft' ? PRICES.nft.TON : PRICES.dice.TON) * amount;
        res.json({ ok: true, currency: 'TON', transaction: { validUntil: Math.floor(Date.now()/1000)+3600, messages: [{ address: TON_WALLET, amount: (price*1e9).toFixed(0) }] } });
    }
});

apiRouter.post('/payment/verify', async (req, res) => {
    const { id, type, amount, currency } = req.body;
    const txId = `manual_${Date.now()}_${Math.random()}`; 
    const success = await processPurchase(id, type, amount, currency, txId);
    if (success) res.json({ ok: true });
    else res.status(500).json({ error: "Verification failed" });
});

apiRouter.post('/roll', async (req, res) => {
    const { id } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const u = await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [id]);
        if (!u.rows[0]) throw new Error("User not found");
        if (u.rows[0].dice_available <= 0) throw new Error("No dice attempts");
        
        await client.query('UPDATE users SET dice_available=dice_available-1, dice_used=dice_used+1 WHERE id=$1', [id]);
        const roll = Math.floor(Math.random() * 6) + 1;
        
        if (roll > 0) { 
             const isStar = u.rows[0].dice_stars_attempts > 0;
             if (isStar) {
                 await client.query('UPDATE users SET dice_stars_attempts=dice_stars_attempts-1, nft_total=nft_total+$1, nft_locked=nft_locked+$1 WHERE id=$2', [roll, id]);
                 await client.query('INSERT INTO locked_nfts (user_id, amount, unlock_date) VALUES ($1,$2,$3)', [id, roll, Date.now() + 21*86400000]);
             } else {
                 await client.query('UPDATE users SET nft_total=nft_total+$1, nft_available=nft_available+$1 WHERE id=$2', [roll, id]);
             }
             await client.query('INSERT INTO transactions (user_id, type, asset_type, amount, description, is_locked) VALUES ($1, $2, $3, $4, $5, $6)',
                [id, 'win', 'nft', roll, `Rolled ${roll}`, isStar]);
        }
        await client.query('COMMIT');
        res.json({ roll });
    } catch(e) { 
        await client.query('ROLLBACK'); 
        res.status(500).json({ error: e.message }); 
    } finally { client.release(); }
});

apiRouter.get('/history', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10', [req.query.id]);
        res.json(r.rows.map(x => ({ ...x, timestamp: new Date(x.created_at).getTime() })));
    } catch (e) { res.json([]); }
});

apiRouter.post('/withdraw', async (req, res) => res.json({ ok: true }));
apiRouter.post('/debug/reset', async (req, res) => {
    try {
        await pool.query('TRUNCATE users, transactions, locked_nfts RESTART IDENTITY CASCADE');
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Dual Mount
app.use('/', apiRouter);
app.use('/api', apiRouter);

app.use((req, res) => {
    res.status(404).json({ error: "Not Found", path: req.url });
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Backend running on port ${PORT}`));