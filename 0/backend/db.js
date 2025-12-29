const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'user',
  host: process.env.DB_HOST || 'db',
  database: process.env.DB_NAME || 'nft_db',
  password: process.env.DB_PASSWORD || 'pass',
  port: process.env.DB_PORT || 5432,
});

const initDb = async () => {
  const client = await pool.connect();
  try {
    // Create Users Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id BIGINT PRIMARY KEY,
        username TEXT,
        nft_total INT DEFAULT 0,
        nft_available INT DEFAULT 0,
        nft_locked INT DEFAULT 0,
        dice_available INT DEFAULT 5,
        dice_stars_attempts INT DEFAULT 0,
        dice_used INT DEFAULT 0,
        wallet_address TEXT
      );
    `);
    
    // Create Locked Items Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS locked_items (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(telegram_id),
        amount INT NOT NULL,
        unlock_date BIGINT NOT NULL
      );
    `);

    console.log("Database initialized successfully");
  } catch (err) {
    console.error("Error initializing database", err);
  } finally {
    client.release();
  }
};

module.exports = { pool, initDb };
