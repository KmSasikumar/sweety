// PostgreSQL connection pool + schema setup for Sweety.
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'sweety',
  password: process.env.PGPASSWORD || 'sweety',
  database: process.env.PGDATABASE || 'sweety',
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(200) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS readings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  glucose_mg_dl INTEGER NOT NULL CHECK (glucose_mg_dl > 0 AND glucose_mg_dl < 1000),
  measured_at TIMESTAMPTZ NOT NULL,
  meal_context VARCHAR(30) NOT NULL DEFAULT 'fasting'
    CHECK (meal_context IN ('fasting', 'before_meal', 'after_meal', 'bedtime', 'other')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS readings_user_measured_idx
  ON readings (user_id, measured_at DESC);
`;

async function initDb() {
  await pool.query(SCHEMA);
}

module.exports = { pool, initDb };
