// Sweety API — Express + PostgreSQL.
// Routes: auth (signup/login/me), readings CRUD, dashboard stats,
// daily + monthly reports. All readings live in PostgreSQL.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { pool, initDb } = require('./db');
const { signToken, requireAuth } = require('./auth');

const app = express();
app.use(cors());
app.use(express.json());

const MEAL_CONTEXTS = ['fasting', 'before_meal', 'after_meal', 'bedtime', 'other'];

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseReadingInput(body) {
  const glucose = Number(body.glucose_mg_dl);
  const mealContext = MEAL_CONTEXTS.includes(body.meal_context)
    ? body.meal_context
    : 'fasting';
  const measuredAt = body.measured_at ? new Date(body.measured_at) : null;
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 500) : '';
  if (!Number.isInteger(glucose) || glucose <= 0 || glucose >= 1000) {
    return { error: 'glucose_mg_dl must be an integer between 1 and 999' };
  }
  if (!measuredAt || Number.isNaN(measuredAt.getTime())) {
    return { error: 'measured_at must be a valid date/time' };
  }
  return { value: { glucose, mealContext, measuredAt, notes } };
}

function toReadingRow(row) {
  return {
    id: row.id,
    glucose_mg_dl: row.glucose_mg_dl,
    measured_at: row.measured_at,
    meal_context: row.meal_context,
    notes: row.notes,
    created_at: row.created_at,
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
     ORDER BY measured_at DESC, id DESC LIMIT $2 OFFSET $3`,
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
  const { glucose, mealContext, measuredAt, notes } = parsed.value;
  const { rows } = await pool.query(
    `INSERT INTO readings (user_id, glucose_mg_dl, measured_at, meal_context, notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.user.id, glucose, measuredAt.toISOString(), mealContext, notes],
  );
  return res.status(201).json({ reading: toReadingRow(rows[0]) });
});

app.put('/api/readings/:id', requireAuth, async (req, res) => {
  const parsed = parseReadingInput(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { glucose, mealContext, measuredAt, notes } = parsed.value;
  const { rows } = await pool.query(
    `UPDATE readings
     SET glucose_mg_dl = $1, measured_at = $2, meal_context = $3, notes = $4,
         updated_at = NOW()
     WHERE id = $5 AND user_id = $6 RETURNING *`,
    [glucose, measuredAt.toISOString(), mealContext, notes, req.params.id, req.user.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Reading not found' });
  return res.json({ reading: toReadingRow(rows[0]) });
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
    `SELECT DATE(measured_at) AS day, ROUND(AVG(glucose_mg_dl))::int AS avg,
            COUNT(*)::int AS count
     FROM readings
     WHERE user_id = $1 AND measured_at >= NOW() - INTERVAL '7 days'
     GROUP BY day ORDER BY day`,
    [req.user.id],
  );
  const recent = await pool.query(
    'SELECT * FROM readings WHERE user_id = $1 ORDER BY measured_at DESC, id DESC LIMIT 10',
    [req.user.id],
  );
  const today = await pool.query(
    `SELECT COUNT(*)::int AS count, ROUND(AVG(glucose_mg_dl))::int AS avg
     FROM readings
     WHERE user_id = $1 AND DATE(measured_at) = CURRENT_DATE`,
    [req.user.id],
  );
  const last7agg = await pool.query(
    `SELECT COUNT(*)::int AS count, ROUND(AVG(glucose_mg_dl))::int AS avg,
            MIN(glucose_mg_dl)::int AS min, MAX(glucose_mg_dl)::int AS max
     FROM readings
     WHERE user_id = $1 AND measured_at >= NOW() - INTERVAL '7 days'`,
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  const { rows } = await pool.query(
    `SELECT * FROM readings
     WHERE user_id = $1 AND DATE(measured_at) = $2
     ORDER BY measured_at ASC`,
    [req.user.id, date],
  );
  const values = rows.map((r) => r.glucose_mg_dl);
  const summary =
    values.length === 0
      ? { count: 0, avg: null, min: null, max: null }
      : {
          count: values.length,
          avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
          min: Math.min(...values),
          max: Math.max(...values),
        };
  return res.json({ date, readings: rows.map(toReadingRow), summary });
});

app.get('/api/reports/monthly', requireAuth, async (req, res) => {
  const year = Number(req.query.year);
  const month = Number(req.query.month); // 1-12
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'year and month (1-12) are required' });
  }
  const { rows } = await pool.query(
    `SELECT DATE(measured_at) AS day,
            COUNT(*)::int AS count,
            ROUND(AVG(glucose_mg_dl))::int AS avg,
            MIN(glucose_mg_dl)::int AS min,
            MAX(glucose_mg_dl)::int AS max
     FROM readings
     WHERE user_id = $1
       AND EXTRACT(YEAR FROM measured_at) = $2
       AND EXTRACT(MONTH FROM measured_at) = $3
     GROUP BY day ORDER BY day`,
    [req.user.id, year, month],
  );
  const all = await pool.query(
    `SELECT COUNT(*)::int AS count, ROUND(AVG(glucose_mg_dl))::int AS avg,
            MIN(glucose_mg_dl)::int AS min, MAX(glucose_mg_dl)::int AS max
     FROM readings
     WHERE user_id = $1
       AND EXTRACT(YEAR FROM measured_at) = $2
       AND EXTRACT(MONTH FROM measured_at) = $3`,
    [req.user.id, year, month],
  );
  const outOfRange = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE glucose_mg_dl > 180)::int AS above180,
            COUNT(*) FILTER (WHERE glucose_mg_dl < 70)::int AS below70
     FROM readings
     WHERE user_id = $1
       AND EXTRACT(YEAR FROM measured_at) = $2
       AND EXTRACT(MONTH FROM measured_at) = $3`,
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
