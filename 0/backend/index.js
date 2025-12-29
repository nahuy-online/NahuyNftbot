const express = require('express');
const cors = require('cors');
const { pool, initDb } = require('./db');
// In a real app, use verifyTelegramWebAppData from a library to check signature
// const { verifyTelegramWebAppData } = require('./utils'); 

const app = express();
const PORT = 8080;

app.use(cors());
app.use(express.json());

// Initialize DB on start
initDb();

// Middleware to simulate authentication or get user ID
const getUserId = (req) => {
  // In production, parse and verify 'req.headers.authorization' or 'initData'
  // For now, we take the query param or header 'X-Telegram-User-Id'
  const id = req.query.id || req.body.id || req.headers['x-telegram-user-id'];
  return id ? parseInt(id, 10) : null;
};

// GET /api/user - Get or Create User
app.get('/api/user', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(400).json({ error: "User ID required" });

  try {
    let result = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [userId]);
    
    if (result.rows.length === 0) {
      // Create new user
      await pool.query(
        'INSERT INTO users (telegram_id, username, dice_available) VALUES ($1, $2, $3)',
        [userId, `User${userId}`, 5] // Give 5 free attempts
      );
      result = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [userId]);
    }

    const user = result.rows[0];
    const lockedResult = await pool.query('SELECT * FROM locked_items WHERE user_id = $1', [userId]);

    const profile = {
      id: parseInt(user.telegram_id),
      username: user.username,
      nftBalance: {
        total: user.nft_total,
        available: user.nft_available,
        locked: user.nft_locked,
        lockedDetails: lockedResult.rows.map(row => ({
          amount: row.amount,
          unlockDate: parseInt(row.unlock_date)
        }))
      },
      diceBalance: {
        available: user.dice_available,
        starsAttempts: user.dice_stars_attempts,
        used: user.dice_used
      },
      referralStats: {
        level1: 0,
        level2: 0,
        level3: 0,
        earnings: { STARS: 0, TON: 0, USDT: 0 }
      },
      walletAddress: user.wallet_address
    };

    res.json(profile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// POST /api/buy - Buy Items (Mock)
app.post('/api/buy', async (req, res) => {
  const { id, type, amount, currency } = req.body;
  if (!id) return res.status(400).json({ error: "User ID required" });

  try {
    if (type === 'nft') {
      const isStars = currency === 'STARS';
      // If STARS, lock for 21 days (21 * 24 * 60 * 60 * 1000 ms)
      if (isStars) {
        const unlockDate = Date.now() + (21 * 86400000);
        await pool.query('UPDATE users SET nft_total = nft_total + $1, nft_locked = nft_locked + $1 WHERE telegram_id = $2', [amount, id]);
        await pool.query('INSERT INTO locked_items (user_id, amount, unlock_date) VALUES ($1, $2, $3)', [id, amount, unlockDate]);
      } else {
        await pool.query('UPDATE users SET nft_total = nft_total + $1, nft_available = nft_available + $1 WHERE telegram_id = $2', [amount, id]);
      }
    } else if (type === 'dice') {
      const isStars = currency === 'STARS';
      await pool.query(`
        UPDATE users SET 
        dice_available = dice_available + $1, 
        dice_stars_attempts = dice_stars_attempts + $2 
        WHERE telegram_id = $3`, 
        [amount, isStars ? amount : 0, id]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Transaction failed" });
  }
});

// POST /api/roll - Roll Dice
app.post('/api/roll', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "User ID required" });

  try {
    const userRes = await pool.query('SELECT dice_available FROM users WHERE telegram_id = $1', [id]);
    if (userRes.rows.length === 0 || userRes.rows[0].dice_available <= 0) {
      return res.status(403).json({ error: "No attempts left" });
    }

    const roll = Math.floor(Math.random() * 6) + 1; // 1-6

    // Update DB: Decrement dice, Increment used, Add NFTs (Roll amount)
    await pool.query(`
      UPDATE users SET 
      dice_available = dice_available - 1, 
      dice_used = dice_used + 1,
      nft_total = nft_total + $1,
      nft_available = nft_available + $1
      WHERE telegram_id = $2`, 
      [roll, id]
    );

    res.json({ roll });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Roll failed" });
  }
});

// POST /api/withdraw
app.post('/api/withdraw', async (req, res) => {
  const { id, address } = req.body;
  
  try {
    await pool.query('UPDATE users SET wallet_address = $1 WHERE telegram_id = $2', [address, id]);
    // Logic to initiate blockchain transfer would go here
    // For now, we just reset the available balance to 0 (mock transfer)
    await pool.query('UPDATE users SET nft_total = nft_total - nft_available, nft_available = 0 WHERE telegram_id = $1', [id]);
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Withdraw failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
