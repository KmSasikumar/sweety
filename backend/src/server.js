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

// Kenpath's validation rules, with the exact error messages from the
// assignment. Order: required -> range -> future date -> max 4 per day ->
// one per slot per day. (Max is checked before duplicate so that adding
// a 5th reading to a full day reports the max rule, not the duplicate.)
// excludeId is the reading being edited, so an edit that keeps its own
// date/slot does not trip the duplicate or max checks.
async function validateReading(body, userId, excludeId) {
  const raw = body.glucose_mg_dl;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { error: 'Please enter a glucose value.' };
  }
  const glucose = Number(raw);
  if (!Number.isInteger(glucose) || glucose < 40 || glucose > 600) {
    return { error: 'Value must be between 40 and 600 mg/dl.' };
  }
  if (!isValidDateString(body.reading_date)) {
    return { error: 'Please pick a valid date.' };
  }
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (body.reading_date > todayStr) {
    return { error: 'Date cannot be in the future.' };
  }
  if (!TIME_SLOTS.includes(body.time_slot)) {
    return { error: 'Please pick a time slot.' };
  }
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 500) : '';
  const dayCount = await pool.query(
    'SELECT COUNT(*)::int AS count FROM readings WHERE user_id = $1 AND reading_date = $2 AND id <> $3',
    [userId, body.reading_date, excludeId || 0],
  );
  if (dayCount.rows[0].count >= 4) {
    return { error: 'You can add only 4 readings per day.' };
  }
  const dup = await pool.query(
    'SELECT id FROM readings WHERE user_id = $1 AND reading_date = $2 AND time_slot = $3 AND id <> $4',
    [userId, body.reading_date, body.time_slot, excludeId || 0],
  );
  if (dup.rows[0]) {
    const short = SLOT_SHORT[body.time_slot];
    const article = /^[AEIOU]/.test(short) ? 'an' : 'a';
    return { error: `You already have ${article} ${short} reading for this date.` };
  }
  return { value: { glucose, timeSlot: body.time_slot, readingDate: body.reading_date, notes } };
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

// First and last day (YYYY-MM-DD) of a month. month is 1-12.
function monthRange(year, month) {
  const pad = (n) => String(n).padStart(2, '0');
  const start = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate(); // day 0 of next month
  return { start, end: `${year}-${pad(month)}-${pad(lastDay)}` };
}

// The month before the given year/month.
function prevMonth(year, month) {
  const d = new Date(year, month - 2, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
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
  const validated = await validateReading(req.body || {}, req.user.id, null);
  if (validated.error) return res.status(400).json({ error: validated.error });
  const { glucose, timeSlot, readingDate, notes } = validated.value;
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
  const validated = await validateReading(req.body || {}, req.user.id, req.params.id);
  if (validated.error) return res.status(400).json({ error: validated.error });
  const { glucose, timeSlot, readingDate, notes } = validated.value;
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

app.get('/api/reports/month-to-date', requireAuth, async (req, res) => {
  const date = req.query.date; // YYYY-MM-DD — the selected date
  if (!isValidDateString(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  const [year, month] = date.split('-').map(Number);
  const { start } = monthRange(year, month);
  const end = date; // 1st of the month up to the selected date
  const { rows } = await pool.query(
    `SELECT * FROM readings
     WHERE user_id = $1 AND reading_date >= $2 AND reading_date <= $3
     ORDER BY reading_date ASC, ${SLOT_ORDER_SQL} ASC`,
    [req.user.id, start, end],
  );
  const days = await pool.query(
    `SELECT reading_date AS day,
            COUNT(*)::int AS count,
            ROUND(AVG(glucose_mg_dl), 1)::float AS avg,
            MIN(glucose_mg_dl)::int AS min,
            MAX(glucose_mg_dl)::int AS max
     FROM readings
     WHERE user_id = $1 AND reading_date >= $2 AND reading_date <= $3
     GROUP BY day ORDER BY day`,
    [req.user.id, start, end],
  );
  return res.json({
    date,
    start,
    end,
    readings: rows.map(toReadingRow),
    days: days.rows,
    summary: summaryOf(rows.map((r) => r.glucose_mg_dl)),
  });
});

app.get('/api/reports/monthly', requireAuth, async (req, res) => {
  // Monthly report covers the WHOLE PREVIOUS MONTH relative to the
  // selected date: selected 15 Oct 2026 -> 1 Sep - 30 Sep 2026.
  const date = req.query.date; // YYYY-MM-DD — the selected date
  if (!isValidDateString(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  const [year, month] = date.split('-').map(Number);
  const prev = prevMonth(year, month);
  const { start, end } = monthRange(prev.year, prev.month);
  const { rows } = await pool.query(
    `SELECT reading_date AS day,
            COUNT(*)::int AS count,
            ROUND(AVG(glucose_mg_dl), 1)::float AS avg,
            MIN(glucose_mg_dl)::int AS min,
            MAX(glucose_mg_dl)::int AS max
     FROM readings
     WHERE user_id = $1 AND reading_date >= $2 AND reading_date <= $3
     GROUP BY day ORDER BY day`,
    [req.user.id, start, end],
  );
  const all = await pool.query(
    `SELECT COUNT(*)::int AS count, ROUND(AVG(glucose_mg_dl), 1)::float AS avg,
            MIN(glucose_mg_dl)::int AS min, MAX(glucose_mg_dl)::int AS max
     FROM readings
     WHERE user_id = $1 AND reading_date >= $2 AND reading_date <= $3`,
    [req.user.id, start, end],
  );
  const outOfRange = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE glucose_mg_dl > 180)::int AS above180,
            COUNT(*) FILTER (WHERE glucose_mg_dl < 70)::int AS below70
     FROM readings
     WHERE user_id = $1 AND reading_date >= $2 AND reading_date <= $3`,
    [req.user.id, start, end],
  );
  return res.json({
    date,
    year: prev.year,
    month: prev.month,
    start,
    end,
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
