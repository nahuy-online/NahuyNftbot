
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import pkg from 'pg';
const { Pool } = pkg;
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { TonClient, WalletContractV4, internal, beginCell } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";

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

const PORT = parseInt(process.env.PORT || '8080', 10);
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = "https://t.me/nahuy_NFT_bot/start"; 
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

// --- TON CONFIGURATION ---
const ENABLE_CHAIN = process.env.ENABLE_CHAIN === 'true'; // Set to 'true' in .env to enable real minting
const COLLECTION_ADDRESS = process.env.COLLECTION_ADDRESS; // Your NFT Collection Address
const MNEMONIC = process.env.MNEMONIC; // Admin Wallet Mnemonic (24 words)
const METADATA_BASE_URL = process.env.METADATA_BASE_URL || "https://nft.example.com/meta/"; 

let tonClient = null;
let adminWallet = null;
let adminKey = null;

async function initTon() {
    if (!ENABLE_CHAIN || !MNEMONIC) {
        console.log("ℹ️ Blockchain interaction disabled (Mock Mode only). Set ENABLE_CHAIN=true and MNEMONIC in .env");
        return;
    }
    try {
        // Connect to TON Mainnet (or testnet if configured)
        const endpoint = await import("@ton/ton").then(m => "https://toncenter.com/api/v2/jsonRPC"); 
        tonClient = new TonClient({ endpoint });
        
        adminKey = await mnemonicToPrivateKey(MNEMONIC.split(" "));
        adminWallet = WalletContractV4.create({ workchain: 0, publicKey: adminKey.publicKey });
        console.log(`✅ TON Wallet Initialized: ${adminWallet.address.toString()}`);
    } catch (e) {
        console.error("⚠️ Failed to init TON Client:", e.message);
    }
}
initTon();

let isDbReady = false;
let dbInitError = null; 

const PRICES = {
    nft: { STARS: 2000, TON: 0.011, USDT: 36.6 },
    dice: { STARS: 6666, TON: 0.036, USDT: 121 }
};
const REF_LEVELS = [0.07, 0.05, 0.03]; 

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

const initDB = async () => {
    let retries = 30; 
    while (retries > 0) {
        let client;
        try {
            client = await pool.connect();
            console.log("✅ Connected to Database");
            
            try {
                await client.query('BEGIN');
                
                // Users Table
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
                
                // Transactions Table
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
                        is_refunded BOOLEAN DEFAULT FALSE,
                        tx_hash TEXT UNIQUE,
                        serials JSONB DEFAULT '[]'::jsonb,
                        created_at TIMESTAMP DEFAULT NOW()
                    );
                `);
                
                // Specific NFT Items
                await client.query(`
                    CREATE TABLE IF NOT EXISTS user_nfts (
                        serial_number BIGINT PRIMARY KEY,
                        user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
                        is_locked BOOLEAN DEFAULT FALSE,
                        is_withdrawn BOOLEAN DEFAULT FALSE,
                        is_seized BOOLEAN DEFAULT FALSE,
                        unlock_date BIGINT DEFAULT 0,
                        source TEXT, -- 'shop', 'dice', 'seized'
                        created_at TIMESTAMP DEFAULT NOW()
                    );
                `);

                const alterQueries = [
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer_id BIGINT",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_rewards_stars INT DEFAULT 0",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_rewards_ton NUMERIC(18, 9) DEFAULT 0",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_rewards_usdt NUMERIC(18, 2) DEFAULT 0",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS dice_stars_attempts INT DEFAULT 0",
                    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE",
                    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_refunded BOOLEAN DEFAULT FALSE",
                    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tx_hash TEXT UNIQUE",
                    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS serials JSONB DEFAULT '[]'::jsonb",
                    "ALTER TABLE user_nfts ADD COLUMN IF NOT EXISTS is_seized BOOLEAN DEFAULT FALSE"
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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    initDB();
});

// --- HELPER: MINT ON CHAIN ---
async function mintNftOnChain(destinationAddress, serialNumber) {
    if (!tonClient || !adminWallet || !adminKey) {
        console.warn("Skipping chain mint: TON Client not ready.");
        return null;
    }

    const itemContent = beginCell()
        .storeUint(1, 8) 
        .storeStringTail(`${serialNumber}.json`) 
        .endCell();

    const body = beginCell()
        .storeUint(1, 32) // OpCode: Mint
        .storeUint(0, 64) // QueryID
        .storeUint(serialNumber, 64) 
        .storeCoins(toNano("0.02")) 
        .storeRef(
             beginCell()
             .storeAddress(internal(destinationAddress)) 
             .storeRef(itemContent) 
             .endCell()
        )
        .endCell();

    const contract = tonClient.open(adminWallet);
    const seqno = await contract.getSeqno();
    
    await contract.sendTransfer({
        seqno,
        secretKey: adminKey.secretKey,
        messages: [
            internal({
                to: COLLECTION_ADDRESS,
                value: "0.05",
                body: body,
                bounce: false
            })
        ]
    });
    
    return seqno;
}

function toNano(amount) {
    return (parseFloat(amount) * 1e9).toFixed(0);
}


if (BOT_TOKEN) {
    try {
        const bot = new TelegramBot(BOT_TOKEN, { polling: true });
        bot.on('polling_error', (error) => { console.error(`[Bot Polling Error] ${error.code || error.message}`); });
        
        bot.onText(/\/start(.*)/, (msg, match) => {
            const chatId = msg.chat.id;
            const rawParam = match[1] ? match[1].trim() : "";
            const startParam = rawParam.replace('/', '');
            const opts = {
                reply_markup: {
                    inline_keyboard: [[{ text: "🚀 Open NFT App", web_app: { url: `${WEBAPP_URL}?startapp=${startParam}` } }]]
                }
            };
            bot.sendMessage(chatId, "Welcome! Tap below to enter.", opts).catch(e => console.error("SendMsg Error", e));
        });

        bot.onText(/\/(refund|chargeback) (\d+) (nft|dice)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (ADMIN_IDS.length > 0 && !ADMIN_IDS.includes(chatId)) return bot.sendMessage(chatId, "⛔ Access Denied");

            const targetUserId = match[2];
            const assetType = match[3];

            bot.sendMessage(chatId, `⏳ Processing CHARGEBACK seizure for User ${targetUserId} (${assetType})...`);
            try {
                const result = await processSeizure(targetUserId, assetType);
                if (result.ok) {
                    bot.sendMessage(chatId, `✅ SUCCESS: ${result.message}`);
                    bot.sendMessage(targetUserId, `⚠️ Alert: Assets revoked due to payment chargeback/refund. Details: ${result.message}`).catch(() => {});
                } else {
                    bot.sendMessage(chatId, `❌ FAILED: ${result.message}`);
                }
            } catch (e) {
                bot.sendMessage(chatId, `💥 ERROR: ${e.message}`);
            }
        });
        
        app.locals.bot = bot;
        console.log("✅ Telegram Bot Initialized");
    } catch (e) {
        console.error("⚠️ Telegram Bot Init Failed:", e.message);
    }
} else {
    console.log("ℹ️ No BOT_TOKEN provided, skipping bot init.");
}

function generateRefCode() {
    return 'ref_' + crypto.randomBytes(4).toString('hex');
}

async function bindReferrer(client, userId, potentialRefCode) {
    if (!potentialRefCode || potentialRefCode === "none" || potentialRefCode === "undefined") {
        return { boundId: null, reason: "No code provided" };
    }
    const cleanCode = potentialRefCode.trim();
    let referrerId = null;
    let method = "";
    
    const resByCode = await client.query('SELECT id FROM users WHERE lower(referral_code) = lower($1)', [cleanCode]);
    if (resByCode.rows.length > 0) {
        referrerId = resByCode.rows[0].id;
        method = "code";
    }

    if (!referrerId) {
         let rawId = cleanCode;
         if (cleanCode.startsWith('ref_')) rawId = cleanCode.replace('ref_', '');
         if (/^\d+$/.test(rawId)) {
             const resById = await client.query('SELECT id FROM users WHERE id = $1', [rawId]);
             if (resById.rows.length > 0) {
                referrerId = resById.rows[0].id;
                method = "legacy_id";
             }
         }
    }

    if (!referrerId) return { boundId: null, reason: `Code '${cleanCode}' not found` };
    if (String(referrerId) === String(userId)) return { boundId: null, reason: "Self-referral" };

    await client.query('UPDATE users SET referrer_id = $1 WHERE id = $2', [referrerId, userId]);
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

async function reserveNfts(client, userId, quantity, isLocked, source) {
    await client.query('LOCK TABLE user_nfts IN EXCLUSIVE MODE');
    
    const maxRes = await client.query('SELECT MAX(serial_number) as max_sn FROM user_nfts');
    let startSn = (parseInt(maxRes.rows[0].max_sn) || 0) + 1;
    
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

async function handlePurchaseSuccess(userId, type, qty, currency, txHash, useRewardBalance, paidFromRewards, paidFromWallet) {
    if (!isDbReady) return false;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const dup = await client.query('SELECT id FROM transactions WHERE tx_hash = $1', [txHash]);
        if (dup.rows.length > 0) { await client.query('ROLLBACK'); return false; }

        const isStars = (currency === 'STARS');
        const isLocked = isStars; 
        let reservedSerials = [];

        // 1. Update Assets
        if (type === 'nft') {
            reservedSerials = await reserveNfts(client, userId, qty, isLocked, 'shop');

            if (isStars) {
                 await client.query('UPDATE users SET nft_total=nft_total+$1, nft_locked=nft_locked+$1 WHERE id=$2', [qty, userId]);
            } else {
                 await client.query('UPDATE users SET nft_total=nft_total+$1, nft_available=nft_available+$1 WHERE id=$2', [qty, userId]);
            }
        } else {
            await client.query('UPDATE users SET dice_available=dice_available+$1 WHERE id=$2', [qty, userId]);
            if (isStars) {
                 await client.query('UPDATE users SET dice_stars_attempts=dice_stars_attempts+$1 WHERE id=$2', [qty, userId]);
            }
        }

        // 2. Deduct Rewards
        if (paidFromRewards > 0) {
            let colName = 'ref_rewards_ton';
            if (currency === 'STARS') colName = 'ref_rewards_stars';
            else if (currency === 'USDT') colName = 'ref_rewards_usdt';
            
            await client.query(`UPDATE users SET ${colName} = ${colName} - $1 WHERE id = $2`, [paidFromRewards, userId]);
            
            await client.query(`
                INSERT INTO transactions (user_id, type, asset_type, amount, currency, description)
                VALUES ($1, 'purchase', 'currency', $2, $3, $4)
            `, [userId, paidFromRewards, currency, `Spent on ${type}`]);
        }

        // 3. Record Main Tx
        let desc = `Purchase ${qty} ${type}`;
        if (paidFromRewards > 0) {
            desc += ` (Wallet: ${paidFromWallet}, Bonus: ${paidFromRewards})`;
        } else {
            desc += ` (Wallet: ${paidFromWallet})`;
        }

        const serialsJson = reservedSerials.length > 0 ? JSON.stringify(reservedSerials) : '[]';

        await client.query(`
            INSERT INTO transactions (user_id, type, asset_type, amount, currency, description, is_locked, tx_hash, serials)
            VALUES ($1, 'purchase', $2, $3, $4, $5, $6, $7, $8)
        `, [userId, type, qty, currency, desc, isLocked, txHash, serialsJson]);

        // 4. Distribute Rewards
        if (paidFromWallet > 0) {
            await distributeRewards(client, userId, paidFromWallet, currency);
        }

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

async function processSeizure(userId, assetType = 'nft') {
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        
        console.log(`🔍 DEBUG [Backend]: Processing Chargeback Seizure for user ${userId}, type: ${assetType}`);
        const txRes = await client.query(`
            SELECT * FROM transactions 
            WHERE user_id = $1 AND currency = 'STARS' AND type = 'purchase' AND asset_type = $2 AND is_refunded = FALSE 
            ORDER BY created_at DESC LIMIT 1
        `, [userId, assetType]);

        if (txRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return { ok: false, message: `No active Stars ${assetType} purchase found to seize for Chargeback.` };
        }

        const tx = txRes.rows[0];
        const purchaseAmount = parseInt(tx.amount);

        if (assetType === 'dice') {
            const uRes = await client.query('SELECT dice_stars_attempts, dice_available FROM users WHERE id=$1', [userId]);
            const currentStarsAttempts = uRes.rows[0].dice_stars_attempts || 0;
            
            const unusedAttempts = Math.min(currentStarsAttempts, purchaseAmount);
            const usedAttempts = purchaseAmount - unusedAttempts;
            let seizureLog = `Revoked ${unusedAttempts} Attempts`;

            if (unusedAttempts > 0) {
                await client.query(`
                    UPDATE users 
                    SET dice_available = GREATEST(0, dice_available - $1),
                        dice_stars_attempts = GREATEST(0, dice_stars_attempts - $1)
                    WHERE id = $2
                `, [unusedAttempts, userId]);
                
                await client.query(`
                    INSERT INTO transactions (user_id, type, asset_type, amount, description)
                    VALUES ($1, 'seizure', 'dice', $2, $3)
                `, [userId, unusedAttempts, `Revoked Attempts (Chargeback Tx #${tx.id})`]);
            }

            if (usedAttempts > 0) {
                const allLockedWins = await client.query(`
                   SELECT * FROM transactions WHERE user_id=$1 AND type='win' AND is_locked=TRUE ORDER BY created_at DESC
                `, [userId]);

                let totalSeizedNFTs = 0;
                let allSeizedSerials = [];
                let attemptsToSeize = usedAttempts;

                for (const winTx of allLockedWins.rows) {
                    if (attemptsToSeize <= 0) break;
                    const serials = winTx.serials || [];
                    if (serials.length === 0) continue;
                    const checkSeized = await client.query(`SELECT count(*) FROM user_nfts WHERE serial_number=ANY($1) AND is_seized=TRUE`, [serials]);
                    if (parseInt(checkSeized.rows[0].count) > 0) continue;

                    await client.query(`
                        UPDATE user_nfts 
                        SET is_seized = TRUE, source = 'seized' 
                        WHERE serial_number = ANY($1) AND user_id = $2
                    `, [serials, userId]);

                    allSeizedSerials.push(...serials);
                    totalSeizedNFTs += serials.length;
                    attemptsToSeize--;
                }

                if (totalSeizedNFTs > 0) {
                    await client.query(`
                        UPDATE users 
                        SET nft_total = GREATEST(0, nft_total - $1),
                            nft_locked = GREATEST(0, nft_locked - $1)
                        WHERE id = $2
                    `, [totalSeizedNFTs, userId]);
                    
                    seizureLog += ` and ${totalSeizedNFTs} NFTs`;
                    
                    await client.query(`
                        INSERT INTO transactions (user_id, type, asset_type, amount, description, serials)
                        VALUES ($1, 'seizure', 'nft', $2, $3, $4)
                    `, [userId, totalSeizedNFTs, `Revoked Winnings (Chargeback Dice Tx #${tx.id})`, JSON.stringify(allSeizedSerials)]);
                }
            }

            await client.query(`UPDATE transactions SET is_refunded = TRUE WHERE id = $1`, [tx.id]);
            await client.query('COMMIT');
            return { ok: true, message: seizureLog };
        }

        const serials = tx.serials || [];
        if (serials.length === 0) {
            await client.query('ROLLBACK');
            return { ok: false, message: "Transaction has no serials attached." };
        }

        await client.query(`
            UPDATE user_nfts 
            SET is_seized = TRUE, source = 'seized' 
            WHERE serial_number = ANY($1) AND user_id = $2
        `, [serials, userId]);

        await client.query(`UPDATE transactions SET is_refunded = TRUE WHERE id = $1`, [tx.id]);

        await client.query(`
            UPDATE users 
            SET nft_total = GREATEST(0, nft_total - $1), 
                nft_locked = GREATEST(0, nft_locked - $1) 
            WHERE id = $2
        `, [purchaseAmount, userId]);

        await client.query(`
            INSERT INTO transactions (user_id, type, asset_type, amount, description, serials)
            VALUES ($1, 'seizure', 'nft', $2, $3, $4)
        `, [userId, purchaseAmount, `Revoked (Chargeback Tx #${tx.id})`, JSON.stringify(serials)]);

        await client.query('COMMIT');
        return { ok: true, message: `Revoked ${purchaseAmount} NFTs due to Chargeback` };

    } catch (e) {
        if(client) await client.query('ROLLBACK');
        console.error("Seizure Error", e);
        return { ok: false, message: e.message };
    } finally {
        if(client) client.release();
    }
}

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', dbReady: isDbReady, dbError: dbInitError });
});

app.post('/api/auth', async (req, res) => {
    let client;
    let debugInfo = "Init";
    try {
        const { id, username, startParam } = req.body;
        if (!id) throw new Error("No ID provided");

        client = await pool.connect();
        await client.query('BEGIN');

        let resUser = await client.query('SELECT * FROM users WHERE id = $1', [id]);
        let user = resUser.rows[0];
        let isNew = false;

        if (!user) {
            isNew = true;
            const code = generateRefCode(); 
            await client.query('INSERT INTO users (id, username, referral_code) VALUES ($1, $2, $3)', [id, username, code]);
            resUser = await client.query('SELECT * FROM users WHERE id = $1', [id]);
            user = resUser.rows[0];
            debugInfo = "User Created";
        } else {
            debugInfo = "User Exists";
        }

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
                debugInfo = `Bind Error: ${err.message}`;
            }
        }

        await client.query('COMMIT');

        const l1 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id = $1', [id]);
        const l2 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id = $1)', [id]);
        const l3 = await client.query('SELECT COUNT(*) FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id IN (SELECT id FROM users WHERE referrer_id = $1))', [id]);
        
        const locks = await client.query(`
            SELECT COUNT(*) as amount, unlock_date, is_seized, array_agg(serial_number) as serials 
            FROM user_nfts 
            WHERE user_id = $1 AND is_locked = TRUE AND is_withdrawn = FALSE 
            GROUP BY unlock_date, is_seized
        `, [id]);
        
        const serials = await client.query(`
            SELECT serial_number 
            FROM user_nfts 
            WHERE user_id = $1 AND is_withdrawn = FALSE AND is_seized = FALSE 
            ORDER BY serial_number DESC 
            LIMIT 500
        `, [id]);
        
        const isAdmin = ADMIN_IDS.includes(parseInt(id));

        res.json({
            id: String(user.id),
            username: user.username,
            isAdmin: isAdmin,
            referralCode: user.referral_code,
            referrerId: user.referrer_id ? String(user.referrer_id) : null,
            referralDebug: debugInfo, 
            isNewUser: isNew,
            nftBalance: {
                total: user.nft_total || 0,
                available: user.nft_available || 0,
                locked: user.nft_locked || 0,
                lockedDetails: locks.rows.map(r => ({ 
                    amount: parseInt(r.amount), 
                    unlockDate: parseInt(r.unlock_date),
                    serials: r.serials || [],
                    isSeized: r.is_seized || false
                }))
            },
            reservedSerials: serials.rows.map(r => parseInt(r.serial_number)),
            diceBalance: {
                available: user.dice_available || 0,
                starsAttempts: user.dice_stars_attempts || 0
            },
            referralStats: {
                level1: parseInt(l1.rows[0].count),
                level2: parseInt(l2.rows[0].count),
                level3: parseInt(l3.rows[0].count),
                bonusBalance: {
                    STARS: user.ref_rewards_stars || 0,
                    TON: parseFloat(user.ref_rewards_ton || 0),
                    USDT: parseFloat(user.ref_rewards_usdt || 0)
                }
            }
        });

    } catch (e) {
        if(client) await client.query('ROLLBACK');
        res.status(500).json({ error: String(e.message || e) });
    } finally {
        if(client) client.release();
    }
});

app.post('/api/admin/stats', async (req, res) => {
    const { id } = req.body;
    if (!ADMIN_IDS.includes(parseInt(id))) return res.status(403).json({ error: "Access Denied" });

    let client;
    try {
        client = await pool.connect();
        
        const usersCount = await client.query('SELECT count(*) FROM users');
        const activeUsersCount = await client.query("SELECT count(DISTINCT user_id) FROM transactions WHERE type='purchase'");
        
        const nftSold = await client.query("SELECT SUM(amount) FROM transactions WHERE type='purchase' AND asset_type='nft'");
        
        const dicePlays = await client.query("SELECT count(*) FROM transactions WHERE type='win'");
        const diceNftWon = await client.query("SELECT SUM(amount) FROM transactions WHERE type='win' AND asset_type='nft'");
        
        // --- Revenue Calculation (Estimated based on quantities * current price) ---
        // Ideally this should use historical price data from tx, but current schema doesn't store price snapshot.
        const getQtySum = async (type, currency) => {
             const res = await client.query("SELECT SUM(amount) FROM transactions WHERE type='purchase' AND asset_type=$1 AND currency=$2", [type, currency]);
             return parseFloat(res.rows[0].sum || '0');
        };

        const nft_ton = await getQtySum('nft', 'TON');
        const nft_stars = await getQtySum('nft', 'STARS');
        const nft_usdt = await getQtySum('nft', 'USDT');

        const dice_ton = await getQtySum('dice', 'TON');
        const dice_stars = await getQtySum('dice', 'STARS');
        const dice_usdt = await getQtySum('dice', 'USDT');

        // BONUS STATS CALCULATION
        const earnedRes = await client.query("SELECT currency, SUM(amount) as total FROM transactions WHERE type='referral_reward' GROUP BY currency");
        const spentRes = await client.query("SELECT currency, SUM(amount) as total FROM transactions WHERE type='purchase' AND asset_type='currency' GROUP BY currency");

        const formatStats = (rows) => {
            const res = { TON: 0, STARS: 0, USDT: 0 };
            rows.forEach(r => {
                if (res[r.currency] !== undefined) res[r.currency] = parseFloat(r.total || 0);
            });
            return res;
        };
        const spent = formatStats(spentRes.rows);

        // Revenue = (Sales * Price) - Bonuses Spent
        const revenue = {
            TON: Math.max(0, ((nft_ton * PRICES.nft.TON) + (dice_ton * PRICES.dice.TON)) - spent.TON),
            STARS: Math.max(0, ((nft_stars * PRICES.nft.STARS) + (dice_stars * PRICES.dice.STARS)) - spent.STARS),
            USDT: Math.max(0, ((nft_usdt * PRICES.nft.USDT) + (dice_usdt * PRICES.dice.USDT)) - spent.USDT)
        };
        
        const recentTx = await client.query("SELECT * FROM transactions ORDER BY created_at DESC LIMIT 5");

        res.json({
            totalUsers: parseInt(usersCount.rows[0].count),
            activeUsers: parseInt(activeUsersCount.rows[0].count),
            totalNftSold: parseInt(nftSold.rows[0].sum || 0),
            totalDicePlays: parseInt(dicePlays.rows[0].count || 0),
            totalNftWonInDice: parseInt(diceNftWon.rows[0].sum || 0),
            revenue: revenue,
            bonusStats: {
                earned: formatStats(earnedRes.rows),
                spent: spent
            },
            recentTransactions: recentTx.rows.map(x => ({
                id: x.id, type: x.type, amount: x.amount, description: x.description, 
                timestamp: new Date(x.created_at).getTime(), currency: x.currency, assetType: x.asset_type
            }))
        });

    } catch (e) {
        res.status(500).json({ error: e.message });
    } finally {
        if(client) client.release();
    }
});
