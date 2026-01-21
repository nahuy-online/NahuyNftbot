
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

// --- CONSTANTS (Must match frontend constants.ts for validation) ---
const PRICES = {
    NFT: { STARS: 2000, TON: 0.011, USDT: 36.6 },
    DICE: { STARS: 6666, TON: 0.0366, USDT: 121 }
};
const REFERRAL_PERCENTAGES = [0.11, 0.09, 0.07]; // Level 1, 2, 3

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

        // Locked Bonus Stars Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS bonus_locks (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                user_id BIGINT REFERENCES users(id),
                amount INTEGER NOT NULL,
                currency TEXT DEFAULT 'STARS',
                unlock_date BIGINT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
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
                is_revoked BOOLEAN DEFAULT FALSE,
                serials JSONB DEFAULT '[]'::jsonb,
                tx_hash TEXT UNIQUE,
                price_amount NUMERIC(10, 4) DEFAULT 0,
                bonus_used NUMERIC(10, 4) DEFAULT 0
            );
        `);
        
        // Migration for existing tables (Safe)
        try {
            await client.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS price_amount NUMERIC(10, 4) DEFAULT 0`);
            await client.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bonus_used NUMERIC(10, 4) DEFAULT 0`);
        } catch(e) { /* Ignore if exists */ }
        
        // Indices for performance
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_referrer ON users(referrer_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_nfts_user ON user_nfts(user_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_tx_hash ON transactions(tx_hash)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_bonus_locks_user ON bonus_locks(user_id)`);

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

// Recursively find uplines and distribute rewards
async function distributeReferralRewards(client, buyerId, amountSpent, currency) {
    // 1. Find chain of referrers: User -> L1 -> L2 -> L3
    // We only need 3 levels up
    
    // Level 1
    const l1Res = await client.query('SELECT referrer_id FROM users WHERE id = $1', [buyerId]);
    const l1Id = l1Res.rows[0]?.referrer_id;
    if (!l1Id) return; // No referrer

    // Level 2
    const l2Res = await client.query('SELECT referrer_id FROM users WHERE id = $1', [l1Id]);
    const l2Id = l2Res.rows[0]?.referrer_id;

    // Level 3
    let l3Id = null;
    if (l2Id) {
        const l3Res = await client.query('SELECT referrer_id FROM users WHERE id = $1', [l2Id]);
        l3Id = l3Res.rows[0]?.referrer_id;
    }

    const uplines = [l1Id, l2Id, l3Id].filter(id => !!id);
    const rewardField = currency === 'STARS' ? 'ref_rewards_stars' : currency === 'TON' ? 'ref_rewards_ton' : 'ref_rewards_usdt';
    const isStars = currency === 'STARS';

    for (let i = 0; i < uplines.length; i++) {
        const uplineId = uplines[i];
        const percent = REFERRAL_PERCENTAGES[i]; // 0.11, 0.09, 0.07
        const reward = amountSpent * percent;
        
        if (reward > 0) {
            // Update Balance
            const roundedReward = isStars ? Math.floor(reward) : reward; // Stars are integers
            
            if (roundedReward > 0) {
                // 1. Add to total Ledger
                await client.query(
                    `UPDATE users SET ${rewardField} = ${rewardField} + $1 WHERE id = $2`,
                    [roundedReward, uplineId]
                );

                // 2. If STARS, create a Lock record (Vesting)
                if (isStars) {
                    const unlockDate = Date.now() + (21 * 24 * 60 * 60 * 1000); // 21 Days
                    await client.query(`
                        INSERT INTO bonus_locks (user_id, amount, currency, unlock_date)
                        VALUES ($1, $2, 'STARS', $3)
                    `, [uplineId, roundedReward, unlockDate]);
                }

                // 3. Log Transaction
                await client.query(`
                    INSERT INTO transactions (user_id, type, asset_type, amount, currency, description, is_locked)
                    VALUES ($1, 'referral_reward', 'currency', $2, $3, $4, $5)
                `, [uplineId, roundedReward, currency, `Referral Reward (L${i+1}) from user ${buyerId}`, isStars]);
            }
        }
    }
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
            
            // Referral Logic
            if (startParam && startParam.startsWith('ref_')) {
                 const refCheck = await client.query('SELECT id FROM users WHERE referral_code = $1', [startParam]);
                 if (refCheck.rows.length > 0 && refCheck.rows[0].id !== id) {
                     referrerId = refCheck.rows[0].id;
                 }
            } else if (startParam && startParam.startsWith('ref_') === false && !isNaN(parseInt(startParam))) {
                 // Try ID
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
        
        // Owned Active Serials
        const serials = await client.query(`
            SELECT serial_number FROM user_nfts WHERE user_id = $1 AND is_withdrawn = FALSE AND is_seized = FALSE ORDER BY serial_number DESC LIMIT 500
        `, [id]);

        // Withdrawn Serials
        const withdrawnSerials = await client.query(`
            SELECT serial_number FROM user_nfts WHERE user_id = $1 AND is_withdrawn = TRUE ORDER BY serial_number DESC LIMIT 500
        `, [id]);
        
        const withdrawnCount = parseInt(withdrawnSerials.rowCount || '0');

        // REFERRAL COUNTS (L1, L2, L3)
        // L1: Direct
        const l1CountRes = await client.query(`SELECT COUNT(*) FROM users WHERE referrer_id = $1`, [id]);
        const l1Count = parseInt(l1CountRes.rows[0].count);

        // L2: Children of L1
        const l2CountRes = await client.query(`
            SELECT COUNT(*) FROM users WHERE referrer_id IN (
                SELECT id FROM users WHERE referrer_id = $1
            )
        `, [id]);
        const l2Count = parseInt(l2CountRes.rows[0].count);

        // L3: Children of L2
        const l3CountRes = await client.query(`
            SELECT COUNT(*) FROM users WHERE referrer_id IN (
                SELECT id FROM users WHERE referrer_id IN (
                    SELECT id FROM users WHERE referrer_id = $1
                )
            )
        `, [id]);
        const l3Count = parseInt(l3CountRes.rows[0].count);

        // --- CALCULATE LOCKED STARS ---
        const lockedStarsRes = await client.query(`
            SELECT SUM(amount) as locked_sum 
            FROM bonus_locks 
            WHERE user_id = $1 AND unlock_date > $2
        `, [id, Date.now()]);
        const lockedStars = parseInt(lockedStarsRes.rows[0].locked_sum || '0');
        const totalStars = user.ref_rewards_stars || 0;
        const availableStars = Math.max(0, totalStars - lockedStars);

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
                level1: l1Count,
                level2: l2Count, 
                level3: l3Count,
                lockedStars: lockedStars, // NEW: Front end needs to know this
                bonusBalance: { STARS: availableStars, TON: parseFloat(user.ref_rewards_ton), USDT: parseFloat(user.ref_rewards_usdt) }
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

        // --- 1. CALCULATE PRICE & VALUE ---
        const priceMap = type === 'nft' ? PRICES.NFT : PRICES.DICE;
        const unitPrice = priceMap[currency];
        if (!unitPrice) throw new Error("Invalid currency/type");
        
        // Full Cost
        const totalValue = unitPrice * amount;
        
        // Calculate Payment Splits
        let payFromBonus = 0;
        let payFromWallet = totalValue;

        // --- 2. PAYMENT DEDUCTION LOGIC ---
        if (useRewardBalance) {
             const userRes = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
             const user = userRes.rows[0];
             
             let balance = 0;
             let field = '';
             let locked = 0;

             if (currency === 'TON') { 
                 balance = parseFloat(user.ref_rewards_ton); 
                 field = 'ref_rewards_ton'; 
             }
             else if (currency === 'USDT') { 
                 balance = parseFloat(user.ref_rewards_usdt); 
                 field = 'ref_rewards_usdt'; 
             }
             else { 
                 // STARS Logic with locking
                 const totalStars = user.ref_rewards_stars;
                 field = 'ref_rewards_stars';
                 
                 // Get locks
                 const lockedRes = await client.query(`SELECT SUM(amount) as s FROM bonus_locks WHERE user_id=$1 AND unlock_date > $2`, [userId, Date.now()]);
                 locked = parseInt(lockedRes.rows[0].s || '0');
                 balance = totalStars - locked;
             }

             // Calculate how much bonus covers
             payFromBonus = Math.min(totalValue, balance);
             payFromWallet = totalValue - payFromBonus;

             if (payFromBonus > 0) {
                 // Deduct
                 await client.query(`UPDATE users SET ${field} = ${field} - $1 WHERE id = $2`, [payFromBonus, userId]);
                 
                 // Log Deduction (Internal record of bonus usage, separate from the main Purchase tx for clarity in ledger, optional but good)
                 // NOTE: We will store the split in the MAIN transaction, so this extra logging is just for bonus history tracking
                 await client.query(`
                    INSERT INTO transactions (user_id, type, asset_type, amount, currency, description)
                    VALUES ($1, 'purchase', 'currency', $2, $3, $4)
                `, [userId, -payFromBonus, currency, `Used Bonus Balance for ${type}`]);
             }
        }

        // --- 3. GRANT ASSETS ---
        let grantedCount = 0;
        let assetName = 'items';
        let wonSerials = [];
        const isLocked = (currency === 'STARS');

        if (type === 'nft') {
            grantedCount = amount; // Pack size
            assetName = 'NFTs';
            wonSerials = await reserveNfts(client, userId, grantedCount, isLocked, 'purchase');
            
            const field = isLocked ? 'nft_locked' : 'nft_available';
            await client.query(`UPDATE users SET nft_total = nft_total + $1, ${field} = ${field} + $1 WHERE id = $2`, [grantedCount, userId]);
        } else {
            grantedCount = amount; // Attempts
            assetName = 'Dice Attempts';
            await client.query(`UPDATE users SET dice_available = dice_available + $1, dice_stars_attempts = dice_stars_attempts + $2 WHERE id = $3`, 
                [grantedCount, isLocked ? grantedCount : 0, userId]);
        }

        // --- 4. DISTRIBUTE REFERRAL REWARDS (If not paid with balance) ---
        // Rewards are calculated ONLY on the Wallet portion (Fresh Money)
        if (payFromWallet > 0) {
            await distributeReferralRewards(client, userId, payFromWallet, currency);
        }

        // --- 5. LOG TRANSACTION ---
        await client.query(`
            INSERT INTO transactions (user_id, type, asset_type, amount, currency, description, is_locked, serials, price_amount, bonus_used)
            VALUES ($1, 'purchase', $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
            userId, type, grantedCount, currency, 
            `Purchased ${grantedCount} ${assetName}`, isLocked, 
            JSON.stringify(wonSerials),
            payFromWallet, payFromBonus
        ]);

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
        const roll = crypto.randomInt(1, 7); // Secure Random 1-6
        
        let q = `UPDATE users SET dice_available = dice_available - 1`;
        if (isStarsRun) q += `, dice_stars_attempts = dice_stars_attempts - 1`;
        
        let wonSerials = [];
        if (roll > 0) { // All rolls win NFT equal to face value in this mechanic
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
            isLocked: x.is_locked, serials: x.serials,
            priceAmount: parseFloat(x.price_amount || 0),
            bonusUsed: parseFloat(x.bonus_used || 0),
            isRevoked: x.is_revoked
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

app.post('/api/admin/transactions', validateTelegramData, isAdmin, async (req, res) => {
    const { limit, offset, currency, assetType, status } = req.body;
    
    let query = `
        SELECT t.*, u.username, u.id as user_id
        FROM transactions t
        JOIN users u ON t.user_id = u.id
        WHERE t.type != 'seizure' 
    `;
    
    const params = [];
    let paramIdx = 1;

    // Filter by Currency
    if (currency && currency !== 'ALL') {
        query += ` AND t.currency = $${paramIdx}`;
        params.push(currency);
        paramIdx++;
    }

    // Filter by Asset Type (nft, dice)
    if (assetType && assetType !== 'ALL') {
        query += ` AND t.asset_type = $${paramIdx}`;
        params.push(assetType);
        paramIdx++;
    }

    // Filter by Status (active/revoked)
    if (status === 'REVOKED') {
        query += ` AND t.is_revoked = TRUE`;
    } else if (status === 'ACTIVE') {
        query += ` AND t.is_revoked = FALSE`;
    }
    
    query += ` ORDER BY t.created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx+1}`;
    params.push(limit || 20, offset || 0);

    try {
        const result = await pool.query(query, params);
        res.json({
            transactions: result.rows.map(x => ({
                id: x.id, type: x.type, amount: parseFloat(x.amount), description: x.description,
                serials: x.serials, assetType: x.asset_type, currency: x.currency,
                timestamp: new Date(x.created_at).getTime(),
                isLocked: x.is_locked, isRevoked: x.is_revoked,
                username: x.username, userId: x.user_id,
                priceAmount: parseFloat(x.price_amount || 0),
                bonusUsed: parseFloat(x.bonus_used || 0)
            })),
            hasMore: result.rows.length === limit
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/search', validateTelegramData, isAdmin, async (req, res) => {
    const { targetId } = req.body;
    
    // Check if input is ID or Username
    let query = 'SELECT * FROM users WHERE id = $1';
    let params = [targetId];
    
    // If not a number, assume username
    if (isNaN(parseInt(targetId))) {
        query = 'SELECT * FROM users WHERE username = $1';
        params = [String(targetId).replace('@', '')]; // remove @ if present
    } else {
        params = [parseInt(targetId)];
    }

    const resUser = await pool.query(query, params);
    if (resUser.rows.length === 0) return res.json({ found: false });
    const u = resUser.rows[0];
    const tx = await pool.query('SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [u.id]);
    
    // Referral Counts for Admin Detail
    const l1 = await pool.query('SELECT COUNT(*) FROM users WHERE referrer_id = $1', [u.id]);
    const l2 = await pool.query('SELECT COUNT(*) FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id = $1)', [u.id]);
    const l3 = await pool.query('SELECT COUNT(*) FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id = $1))', [u.id]);
    
    res.json({
        found: true,
        user: {
            id: u.id, username: u.username, nftTotal: u.nft_total, nftAvailable: u.nft_available, diceAvailable: u.dice_available,
            ip: u.ip_address, joinedAt: new Date(u.joined_at).getTime(),
            transactions: tx.rows.map(x => ({ 
                id: x.id, type: x.type, amount: parseFloat(x.amount), description: x.description, 
                serials: x.serials, assetType: x.asset_type, currency: x.currency, 
                timestamp: new Date(x.created_at).getTime(),
                isLocked: x.is_locked, isRevoked: x.is_revoked,
                priceAmount: parseFloat(x.price_amount || 0),
                bonusUsed: parseFloat(x.bonus_used || 0)
            })),
            rewards: { TON: parseFloat(u.ref_rewards_ton), USDT: parseFloat(u.ref_rewards_usdt), STARS: parseInt(u.ref_rewards_stars) },
            referralStats: {
                level1: parseInt(l1.rows[0].count),
                level2: parseInt(l2.rows[0].count),
                level3: parseInt(l3.rows[0].count)
            }
        }
    });
});

app.post('/api/debug/reset', validateTelegramData, isAdmin, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        await client.query('TRUNCATE TABLE transactions, user_nfts, bonus_locks, users RESTART IDENTITY CASCADE');
        await client.query('COMMIT');
        res.json({ ok: true });
    } catch (e) {
        if (client) await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally {
        if (client) client.release();
    }
});

app.post('/api/debug/seize', validateTelegramData, isAdmin, async (req, res) => {
    const { assetType, targetId, transactionId } = req.body;
    
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        
        // Lock user
        const userRes = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [targetId]);
        if (userRes.rows.length === 0) throw new Error("User not found");
        const user = userRes.rows[0];

        // LOGIC FOR TRANSACTION SPECIFIC SEIZURE
        if (transactionId) {
             const txRes = await client.query('SELECT * FROM transactions WHERE id = $1 AND user_id = $2', [transactionId, targetId]);
             if (txRes.rows.length === 0) throw new Error("Transaction not found");
             const tx = txRes.rows[0];
             
             if (tx.is_revoked) throw new Error("Transaction already revoked");

             if (tx.asset_type === 'nft') {
                 const serials = tx.serials; // JSONB array
                 if (!serials || serials.length === 0) throw new Error("No serials in transaction");
                 
                 // Mark serials seized
                 await client.query('UPDATE user_nfts SET is_seized = TRUE WHERE serial_number = ANY($1::int[])', [serials]);
                 
                 // Update Balances
                 // Determine if they were locked or available
                 // We can check the transaction is_locked flag, or check the nfts themselves. 
                 // Simple approach: deduct from total. Deduct from locked if tx was locked.
                 
                 const qty = parseInt(tx.amount);
                 const lockedDed = tx.is_locked ? qty : 0;
                 const availDed = tx.is_locked ? 0 : qty;
                 
                 await client.query(`
                     UPDATE users SET 
                        nft_total = GREATEST(0, nft_total - $1),
                        nft_locked = GREATEST(0, nft_locked - $2),
                        nft_available = GREATEST(0, nft_available - $3)
                     WHERE id = $4
                 `, [qty, lockedDed, availDed, targetId]);

             } else if (tx.asset_type === 'dice') {
                 // Revoke attempts
                 const qty = parseInt(tx.amount);
                 await client.query(`
                    UPDATE users SET 
                        dice_available = GREATEST(0, dice_available - $1),
                        dice_stars_attempts = GREATEST(0, dice_stars_attempts - $2)
                    WHERE id = $3
                 `, [qty, tx.is_locked ? qty : 0, targetId]);
             }
             
             // Mark transaction as revoked
             await client.query('UPDATE transactions SET is_revoked = TRUE WHERE id = $1', [transactionId]);
             
             // Log Seizure
             await client.query(`
                INSERT INTO transactions (user_id, type, asset_type, amount, description, is_revoked)
                VALUES ($1, 'seizure', $2, $3, $4, TRUE)
            `, [targetId, tx.asset_type, tx.amount, `Refund/Revoke Tx ${transactionId.slice(0,6)}`]);

             await client.query('COMMIT');
             return res.json({ ok: true, message: "Transaction revoked successfully" });
        }

        // --- LEGACY BULK SEIZURE (KEEP FOR COMPATIBILITY) ---
        if (assetType === 'dice') {
            const available = user.dice_available || 0;
            if (available <= 0) throw new Error("No dice attempts to seize");
            await client.query('UPDATE users SET dice_available = 0, dice_stars_attempts = 0 WHERE id = $1', [targetId]);
            await client.query(`
                INSERT INTO transactions (user_id, type, asset_type, amount, description)
                VALUES ($1, 'seizure', 'dice', $2, 'Revoked Dice Attempts (Admin Action)')
            `, [targetId, available]);
        } 
        else if (assetType === 'nft') {
            const lockedRes = await client.query(`
                SELECT serial_number FROM user_nfts 
                WHERE user_id = $1 AND is_locked = TRUE AND is_seized = FALSE AND is_withdrawn = FALSE
            `, [targetId]);
            const count = lockedRes.rowCount;
            if (count === 0) throw new Error("No locked NFTs found to seize");
            const serials = lockedRes.rows.map(r => r.serial_number);
            await client.query(`UPDATE user_nfts SET is_seized = TRUE WHERE serial_number = ANY($1::int[])`, [serials]);
            await client.query(`UPDATE users SET nft_total = GREATEST(0, nft_total - $1), nft_locked = GREATEST(0, nft_locked - $1) WHERE id = $2`, [count, targetId]);
            await client.query(`
                INSERT INTO transactions (user_id, type, asset_type, amount, description, serials)
                VALUES ($1, 'seizure', 'nft', $2, 'Revoked Locked NFTs (Admin Action)', $3)
            `, [targetId, count, JSON.stringify(serials)]);
        }

        await client.query('COMMIT');
        res.json({ ok: true, message: `Seized ${assetType === 'dice' ? 'attempts' : 'locked NFTs'}` });
    } catch (e) {
        if (client) await client.query('ROLLBACK');
        console.error("Seize error:", e);
        res.status(500).json({ error: e.message });
    } finally {
        if (client) client.release();
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../dist/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
