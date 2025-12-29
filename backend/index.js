import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import pg from 'pg';
import axios from 'axios';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// --- CONFIG ---
const PORT = process.env.PORT || 8080;
const BOT_TOKEN = process.env.BOT_TOKEN;
const TON_WALLET = process.env.RECEIVER_TON_ADDRESS_TESTNET; 
const TONAPI_KEY = process.env.TONAPI_KEY;
const TONAPI_URL = 'https://testnet.tonapi.io/v2'; // Testnet

// Prices from your constants (simplified for backend)
const PRICES = {
    nft: { STARS: 2000, TON: 0.01 }, // Using 0.01 TON for test as requested
    dice: { STARS: 6666, TON: 0.015 }
};

// --- DATABASE ---
// Fallback to localhost if DB_HOST is not set (for local dev)
const pool = new pg.Pool({
    user: process.env.DB_USER || 'user',
    host: process.env.DB_HOST || 'localhost', 
    database: process.env.DB_NAME || 'nft_db',
    password: process.env.DB_PASSWORD || 'pass',
    port: 5432,
});

// Init DB
const initDB = async () => {
    try {
        await pool.query(`
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
                type TEXT, -- 'purchase', 'win', 'withdraw'
                asset_type TEXT, -- 'nft', 'dice'
                amount INT,
                currency TEXT,
                description TEXT,
                is_locked BOOLEAN DEFAULT FALSE,
                tx_hash TEXT UNIQUE, -- For TON tx hash or Stars payment charge id
                created_at TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS locked_nfts (
                id SERIAL PRIMARY KEY,
                user_id BIGINT,
                amount INT,
                unlock_date BIGINT
            );
        `);
        console.log("DB Initialized");
    } catch (err) {
        console.error("DB Init Error:", err);
    }
};
initDB();

// --- TELEGRAM BOT (Polling for Stars) ---
// Only start bot if token is present
if (BOT_TOKEN) {
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });

    // Handle Pre-checkout (Must confirm to Telegram that we are ready to take money)
    bot.on('pre_checkout_query', (query) => {
        bot.answerPreCheckoutQuery(query.id, true).catch(() => {});
    });

    // Handle Successful Payment (Stars)
    bot.on('message', async (msg) => {
        if (msg.successful_payment) {
            const userId = msg.from.id;
            const payload = JSON.parse(msg.successful_payment.invoice_payload); 
            // payload: { type: 'nft'|'dice', amount: number }
            
            await processPurchase(userId, payload.type, payload.amount, 'STARS', msg.successful_payment.telegram_payment_charge_id);
            
            await bot.sendMessage(userId, `Payment successful! You received ${payload.amount} ${payload.type === 'nft' ? 'NFTs' : 'Attempts'}.`);
        }
    });
    
    // Add createInvoiceLink to app locals or helper if needed, but we use 'bot' directly in route
    app.locals.bot = bot;
} else {
    console.warn("BOT_TOKEN not set. Telegram features disabled.");
}

// --- CORE LOGIC ---

async function getUser(id, username) {
    const res = await pool.query(`
        INSERT INTO users (id, username) VALUES ($1, $2)
        ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username
        RETURNING *
    `, [id, username]);
    
    // Get Locked Details
    const lockedRes = await pool.query('SELECT amount, unlock_date FROM locked_nfts WHERE user_id = $1', [id]);
    
    // Convert DB row to Frontend format
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
        referralStats: { level1: 0, level2: 0, level3: 0, earnings: { STARS: 0, TON: 0, USDT: 0 } }, // Placeholder for now
        walletAddress: u.wallet_address
    };
}

async function processPurchase(userId, type, packSize, currency, txId) {
    // 1. Check if already processed
    const check = await pool.query('SELECT id FROM transactions WHERE tx_hash = $1', [txId]);
    if (check.rows.length > 0) return false;

    // 2. Update Balances
    const isStars = currency === 'STARS';
    let description = "";
    
    if (type === 'nft') {
        description = `NFT Pack (x${packSize})`;
        if (isStars) {
            // Stars NFTs are locked
            const unlockDate = Date.now() + (21 * 24 * 60 * 60 * 1000);
            await pool.query('UPDATE users SET nft_total = nft_total + $1, nft_locked = nft_locked + $1 WHERE id = $2', [packSize, userId]);
            await pool.query('INSERT INTO locked_nfts (user_id, amount, unlock_date) VALUES ($1, $2, $3)', [userId, packSize, unlockDate]);
        } else {
            await pool.query('UPDATE users SET nft_total = nft_total + $1, nft_available = nft_available + $1 WHERE id = $2', [packSize, userId]);
        }
    } else if (type === 'dice') {
        description = `Dice Attempts (x${packSize})`;
        await pool.query('UPDATE users SET dice_available = dice_available + $1 WHERE id = $2', [packSize, userId]);
        if (isStars) {
            await pool.query('UPDATE users SET dice_stars_attempts = dice_stars_attempts + $1 WHERE id = $2', [packSize, userId]);
        }
    }

    // 3. Record Transaction
    await pool.query(`
        INSERT INTO transactions (user_id, type, asset_type, amount, currency, description, is_locked, tx_hash)
        VALUES ($1, 'purchase', $2, $3, $4, $5, $6, $7)
    `, [userId, type, packSize, currency, description, (isStars && type === 'nft'), txId]);

    return true;
}

// --- API ENDPOINTS ---

// 1. Get User
app.get('/api/user', async (req, res) => {
    try {
        const userId = req.query.id; // Passed from frontend (in real Prod use initData validation)
        const username = "User"; // Simplified, ideally parse initData
        const user = await getUser(userId, username);
        res.json(user);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// 2. Create Payment
app.post('/api/payment/create', async (req, res) => {
    const { id, type, amount, currency } = req.body;
    
    if (currency === 'STARS') {
        try {
            if (!app.locals.bot) throw new Error("Bot not initialized");
            
            const price = (type === 'nft' ? PRICES.nft.STARS : PRICES.dice.STARS) * amount;
            const title = type === 'nft' ? `NFT Pack x${amount}` : `Dice Attempts x${amount}`;
            
            const link = await app.locals.bot.createInvoiceLink(
                title,
                "Purchase in App",
                JSON.stringify({ type, amount }), // Payload
                "", // Provider Token (empty for Stars)
                "XTR",
                [{ label: "Price", amount: price }]
            );
            return res.json({ ok: true, currency: 'STARS', invoiceLink: link });
        } catch (e) {
            console.error("Stars Invoice Error:", e);
            return res.status(500).json({ ok: false });
        }
    } 
    
    if (currency === 'TON') {
        // Prepare TON Transaction for Frontend
        // We ask user to send specific amount to our wallet with Comment = UserID
        const price = (type === 'nft' ? PRICES.nft.TON : PRICES.dice.TON) * amount;
        const nanoAmount = Math.floor(price * 1000000000).toString();
        
        return res.json({
            ok: true,
            currency: 'TON',
            transaction: {
                validUntil: Math.floor(Date.now() / 1000) + 600,
                messages: [
                    {
                        address: TON_WALLET,
                        amount: nanoAmount,
                        payload: Buffer.from(String(id)).toString('base64') // Comment = UserID
                    }
                ]
            }
        });
    }

    res.status(400).json({ error: "Unsupported currency" });
});

// 3. Verify Payment (TON)
app.post('/api/payment/verify', async (req, res) => {
    const { id, type, amount, currency } = req.body;
    
    if (currency !== 'TON') return res.json({ ok: true }); // Stars handled by webhook/polling

    try {
        // Check TonAPI for recent transactions to our wallet
        const response = await axios.get(`${TONAPI_URL}/blockchain/accounts/${TON_WALLET}/transactions?limit=20`, {
            headers: { 'Authorization': `Bearer ${TONAPI_KEY}` }
        });

        const txs = response.data.transactions;
        const expectedPrice = (type === 'nft' ? PRICES.nft.TON : PRICES.dice.TON) * amount;
        const expectedNano = Math.floor(expectedPrice * 1000000000);

        // Find a transaction that:
        // 1. Is incoming
        // 2. Has correct amount (approximate to handle fees if needed, but exact is better)
        // 3. Has comment == userId
        // 4. Not already processed in DB
        
        const foundTx = txs.find(tx => {
            if (tx.in_msg.value !== expectedNano.toString()) return false;
            if (!tx.in_msg.decoded_body || !tx.in_msg.decoded_body.text) return false;
            return tx.in_msg.decoded_body.text === String(id);
        });

        if (foundTx) {
            const success = await processPurchase(id, type, amount, 'TON', foundTx.hash);
            if (success) return res.json({ ok: true });
            else return res.status(400).json({ error: "Transaction already processed" });
        }

        // If strict verification fails, for TESTNET usability we might want to return 200 
        // if you are just testing UI flows, but here is REAL logic:
        res.status(400).json({ error: "Transaction not found yet. Please wait a few seconds." });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Verification error" });
    }
});

// 4. Roll Dice
app.post('/api/roll', async (req, res) => {
    const { id } = req.body;
    
    // Check balance
    const userRes = await pool.query('SELECT dice_available, dice_stars_attempts FROM users WHERE id = $1', [id]);
    const user = userRes.rows[0];

    if (!user || user.dice_available <= 0) {
        return res.status(400).json({ error: "No attempts" });
    }

    const roll = Math.floor(Math.random() * 6) + 1;
    
    // Decrement attempts
    await pool.query('UPDATE users SET dice_available = dice_available - 1, dice_used = dice_used + 1 WHERE id = $1', [id]);
    
    const isStarAttempt = user.dice_stars_attempts > 0;
    if (isStarAttempt) {
        await pool.query('UPDATE users SET dice_stars_attempts = dice_stars_attempts - 1 WHERE id = $1', [id]);
    }

    // Logic: Win NFT equal to roll? Or custom logic? 
    // Implementing logic from your mock: Win roll amount of NFTs
    const winAmount = roll; 
    
    if (isStarAttempt) {
        const unlockDate = Date.now() + (21 * 24 * 60 * 60 * 1000);
        await pool.query('UPDATE users SET nft_total = nft_total + $1, nft_locked = nft_locked + $1 WHERE id = $2', [winAmount, id]);
        await pool.query('INSERT INTO locked_nfts (user_id, amount, unlock_date) VALUES ($1, $2, $3)', [id, winAmount, unlockDate]);
    } else {
        await pool.query('UPDATE users SET nft_total = nft_total + $1, nft_available = nft_available + $1 WHERE id = $2', [winAmount, id]);
    }

    // Log Tx
    const desc = roll >= 4 ? "Dice Win: Big Roll" : "Dice Win";
    await pool.query(`INSERT INTO transactions (user_id, type, asset_type, amount, description, is_locked) VALUES ($1, 'win', 'nft', $2, $3, $4)`,
        [id, winAmount, desc, isStarAttempt]);

    res.json({ roll });
});

// 5. History
app.get('/api/history', async (req, res) => {
    const { id } = req.query;
    const result = await pool.query('SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [id]);
    
    const mapped = result.rows.map(r => ({
        id: r.id.toString(),
        type: r.type,
        assetType: r.asset_type,
        amount: r.amount,
        timestamp: new Date(r.created_at).getTime(),
        description: r.description,
        currency: r.currency,
        isLocked: r.is_locked
    }));
    
    res.json(mapped);
});

// 6. Withdraw
app.post('/api/withdraw', async (req, res) => {
    const { id, address } = req.body;
    
    const userRes = await pool.query('SELECT nft_available FROM users WHERE id = $1', [id]);
    const available = userRes.rows[0]?.nft_available || 0;

    if (available <= 0) return res.status(400).json({ error: "Nothing to withdraw" });

    // In real app, trigger NFT transfer on blockchain here.
    // For now, just reset DB balance.
    
    await pool.query('UPDATE users SET nft_total = nft_total - $1, nft_available = 0, wallet_address = $2 WHERE id = $3', [available, address, id]);
    
    await pool.query(`INSERT INTO transactions (user_id, type, asset_type, amount, description) VALUES ($1, 'withdraw', 'nft', $2, $3)`,
        [id, available, `Withdraw to ${address.slice(0,4)}...`]);

    res.json({ ok: true });
});


app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
