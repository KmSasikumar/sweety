// PostgreSQL connection pool + schema setup for Sweety.
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'sweety',
  password: process.env.PGPASSWORD || 'sweety',
  database: process.env.PGDATABASE || 'sweety',
});

// Kenpath's model: each reading has a date, one of 4 time slots and a
// value in mg/dL. No free-form time of day — the slot is the time.
// The UNIQUE constraint enforces "only one reading per slot per day"
// at the database level as well as in the API.
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
  glucose_mg_dl INTEGER NOT NULL CHECK (glucose_mg_dl >= 40 AND glucose_mg_dl <= 600),
  reading_date DATE NOT NULL,
  time_slot VARCHAR(20) NOT NULL
    CHECK (time_slot IN ('morning', 'after_breakfast', 'after_lunch', 'after_dinner')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, reading_date, time_slot)
);

CREATE INDEX IF NOT EXISTS readings_user_date_idx
  ON readings (user_id, reading_date DESC);
`;

async function initDb() {
  await pool.query(SCHEMA);
}

module.exports = { pool, initDb };
