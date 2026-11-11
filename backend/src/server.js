// Sweety API — Express + PostgreSQL.
// Routes: auth (signup/login/me), readings CRUD, dashboard stats,
// daily / month-to-date / monthly reports. All readings live in PostgreSQL.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { pool, initDb } = require('./db');
const { signToken, requireAuth } = require('./auth');

const app = express();
app.use(cors());
app.use(express.json());

// Kenpath's 4 time slots, in the order they occur in a day.
const TIME_SLOTS = ['morning', 'after_breakfast', 'after_lunch', 'after_dinner'];
const SLOT_LABELS = {
  morning: 'Morning (fasting)',
  after_breakfast: 'After breakfast',
  after_lunch: 'After lunch',
  after_dinner: 'After dinner',
};
// Short names used in validation messages, e.g.
// "You already have an After lunch reading for this date."
const SLOT_SHORT = {
  morning: 'Morning',
  after_breakfast: 'After breakfast',
  after_lunch: 'After lunch',
  after_dinner: 'After dinner',
};
const SLOT_ORDER_SQL =
  "CASE time_slot WHEN 'morning' THEN 1 WHEN 'after_breakfast' THEN 2 WHEN 'after_lunch' THEN 3 ELSE 4 END";

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidDateString(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

// Shape validation for a reading payload. The full Kenpath validation
// rules (required value, 40–600 range, future date, one per slot per day,
// max 4 per day) live in validateReading(); this only checks the payload
// has the right shape so the DB is never hit with garbage.
function parseReadingInput(body) {
  const glucose = Number(body.glucose_mg_dl);
  const timeSlot = TIME_SLOTS.includes(body.time_slot) ? body.time_slot : null;
  const readingDate = isValidDateString(body.reading_date) ? body.reading_date : null;
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 500) : '';
  if (!Number.isInteger(glucose)) {
    return { error: 'glucose_mg_dl must be a whole number' };
  }
  if (!timeSlot) {
    return { error: 'time_slot must be one of: morning, after_breakfast, after_lunch, after_dinner' };
  }
  if (!readingDate) {
    return { error: 'reading_date must be YYYY-MM-DD' };
  }
  return { value: { glucose, timeSlot, readingDate, notes } };
}

function toReadingRow(row) {
  return {
    id: row.id,
    glucose_mg_dl: row.glucose_mg_dl,
    reading_date: row.reading_date,
    time_slot: row.time_slot,
    notes: row.notes,
    created_at: row.created_at,
  };
}

// Round an average to 1 decimal place (Kenpath's report format).
function avg1(values) {
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

function summaryOf(values) {
  if (!values.length) return { count: 0, avg: null, min: null, max: null };
  return {
    count: values.length,
    avg: avg1(values),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

// ---------------------------------------------------------------- auth
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name.trim(), email.trim().toLowerCase(), passwordHash],
    );
    const user = rows[0];
    return res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Signup failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email) || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [
    email.trim().toLowerCase(),
  ]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  return res.json({
    token: signToken(user),
    user: { id: user.id, name: user.name, email: user.email },
  });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, email, created_at FROM users WHERE id = $1',
    [req.user.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  return res.json({ user: rows[0] });
});

// ------------------------------------------------------------- readings
app.get('/api/readings', requireAuth, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const { rows } = await pool.query(
    `SELECT * FROM readings WHERE user_id = $1
     ORDER BY reading_date DESC, ${SLOT_ORDER_SQL} DESC LIMIT $2 OFFSET $3`,
    [req.user.id, limit, offset],
  );
  const total = await pool.query(
    'SELECT COUNT(*)::int AS count FROM readings WHERE user_id = $1',
    [req.user.id],
  );
  return res.json({ readings: rows.map(toReadingRow), total: total.rows[0].count });
});

app.post('/api/readings', requireAuth, async (req, res) => {
  const parsed = parseReadingInput(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { glucose, timeSlot, readingDate, notes } = parsed.value;
  try {
    const { rows } = await pool.query(
      `INSERT INTO readings (user_id, glucose_mg_dl, reading_date, time_slot, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, glucose, readingDate, timeSlot, notes],
    );
    return res.status(201).json({ reading: toReadingRow(rows[0]) });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({
        error: `You already have a${/^[AEIOU]/.test(SLOT_SHORT[timeSlot]) ? 'n' : ''} ${SLOT_SHORT[timeSlot]} reading for this date.`,
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Could not save reading' });
  }
});

app.put('/api/readings/:id', requireAuth, async (req, res) => {
  const parsed = parseReadingInput(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { glucose, timeSlot, readingDate, notes } = parsed.value;
  try {
    const { rows } = await pool.query(
      `UPDATE readings
       SET glucose_mg_dl = $1, reading_date = $2, time_slot = $3, notes = $4,
           updated_at = NOW()
       WHERE id = $5 AND user_id = $6 RETURNING *`,
      [glucose, readingDate, timeSlot, notes, req.params.id, req.user.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Reading not found' });
    return res.json({ reading: toReadingRow(rows[0]) });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({
        error: `You already have a${/^[AEIOU]/.test(SLOT_SHORT[timeSlot]) ? 'n' : ''} ${SLOT_SHORT[timeSlot]} reading for this date.`,
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Could not save reading' });
  }
});

app.delete('/api/readings/:id', requireAuth, async (req, res) => {
  const { rowCount } = await pool.query(
    'DELETE FROM readings WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id],
  );
  if (!rowCount) return res.status(404).json({ error: 'Reading not found' });
  return res.json({ deleted: true });
});

// -------------------------------------------------------------- stats
app.get('/api/stats', requireAuth, async (req, res) => {
  const agg = await pool.query(
    `SELECT COUNT(*)::int AS total,
            ROUND(AVG(glucose_mg_dl))::int AS avg,
            MIN(glucose_mg_dl)::int AS min,
            MAX(glucose_mg_dl)::int AS max
     FROM readings WHERE user_id = $1`,
    [req.user.id],
  );
  const last7 = await pool.query(
    `SELECT reading_date AS day, ROUND(AVG(glucose_mg_dl))::int AS avg,
            COUNT(*)::int AS count
     FROM readings
     WHERE user_id = $1 AND reading_date >= CURRENT_DATE - INTERVAL '6 days'
     GROUP BY day ORDER BY day`,
    [req.user.id],
  );
  const recent = await pool.query(
    `SELECT * FROM readings WHERE user_id = $1
     ORDER BY reading_date DESC, ${SLOT_ORDER_SQL} DESC LIMIT 10`,
    [req.user.id],
  );
  const today = await pool.query(
    `SELECT COUNT(*)::int AS count, ROUND(AVG(glucose_mg_dl))::int AS avg
     FROM readings
     WHERE user_id = $1 AND reading_date = CURRENT_DATE`,
    [req.user.id],
  );
  const last7agg = await pool.query(
    `SELECT COUNT(*)::int AS count, ROUND(AVG(glucose_mg_dl))::int AS avg,
            MIN(glucose_mg_dl)::int AS min, MAX(glucose_mg_dl)::int AS max
     FROM readings
     WHERE user_id = $1 AND reading_date >= CURRENT_DATE - INTERVAL '6 days'`,
    [req.user.id],
  );
  return res.json({
    total: agg.rows[0].total,
    avg: agg.rows[0].avg,
    min: agg.rows[0].min,
    max: agg.rows[0].max,
    todayCount: today.rows[0].count,
    todayAvg: today.rows[0].avg,
    sevenDay: last7agg.rows[0],
    latest: recent.rows[0] ? toReadingRow(recent.rows[0]) : null,
    last7Days: last7.rows,
    recent: recent.rows.map(toReadingRow),
  });
});

// ------------------------------------------------------------- reports
app.get('/api/reports/daily', requireAuth, async (req, res) => {
  const date = req.query.date; // YYYY-MM-DD
  if (!isValidDateString(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  const { rows } = await pool.query(
    `SELECT * FROM readings
     WHERE user_id = $1 AND reading_date = $2
     ORDER BY ${SLOT_ORDER_SQL} ASC`,
    [req.user.id, date],
  );
  return res.json({
    date,
    readings: rows.map(toReadingRow),
    summary: summaryOf(rows.map((r) => r.glucose_mg_dl)),
  });
});

app.get('/api/reports/monthly', requireAuth, async (req, res) => {
  const year = Number(req.query.year);
  const month = Number(req.query.month); // 1-12
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'year and month (1-12) are required' });
  }
  const { rows } = await pool.query(
    `SELECT reading_date AS day,
            COUNT(*)::int AS count,
            ROUND(AVG(glucose_mg_dl), 1)::float AS avg,
            MIN(glucose_mg_dl)::int AS min,
            MAX(glucose_mg_dl)::int AS max
     FROM readings
     WHERE user_id = $1
       AND EXTRACT(YEAR FROM reading_date) = $2
       AND EXTRACT(MONTH FROM reading_date) = $3
     GROUP BY day ORDER BY day`,
    [req.user.id, year, month],
  );
  const all = await pool.query(
    `SELECT COUNT(*)::int AS count, ROUND(AVG(glucose_mg_dl), 1)::float AS avg,
            MIN(glucose_mg_dl)::int AS min, MAX(glucose_mg_dl)::int AS max
     FROM readings
     WHERE user_id = $1
       AND EXTRACT(YEAR FROM reading_date) = $2
       AND EXTRACT(MONTH FROM reading_date) = $3`,
    [req.user.id, year, month],
  );
  const outOfRange = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE glucose_mg_dl > 180)::int AS above180,
            COUNT(*) FILTER (WHERE glucose_mg_dl < 70)::int AS below70
     FROM readings
     WHERE user_id = $1
       AND EXTRACT(YEAR FROM reading_date) = $2
       AND EXTRACT(MONTH FROM reading_date) = $3`,
    [req.user.id, year, month],
  );
  return res.json({
    year,
    month,
    days: rows,
    summary: {
      count: all.rows[0].count,
      avg: all.rows[0].avg,
      min: all.rows[0].min,
      max: all.rows[0].max,
      daysTracked: rows.length,
      above180: outOfRange.rows[0].above180,
      below70: outOfRange.rows[0].below70,
    },
  });
});

// ---------------------------------------------------------------- misc
app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'sweety' }));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

const PORT = Number(process.env.PORT || 4000);

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Sweety API listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialise database:', err);
    process.exit(1);
  });
