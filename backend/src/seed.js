// Seed script: creates a demo user and 2 weeks of realistic glucose readings.
// Run: npm run seed   (or: node src/seed.js)
// Deterministic (seeded PRNG) so re-seeding produces the same data.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool, initDb } = require('./db');

// mulberry32 — small deterministic PRNG
function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261111);

function around(base, spread) {
  return Math.round(base + (rand() * 2 - 1) * spread);
}

// A realistic day: fasting in the morning, after lunch, and bedtime on most days.
// Values span 64–192 mg/dL like the reference demo — mostly in range, with
// the occasional post-meal spike above 180 and a rare dip below 70.
function readingsForDay(date, dayIndex) {
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  const bump = isWeekend ? 5 : 0;
  const out = [
    { hour: 7, minute: 15, context: 'fasting', value: around(97 + bump, 10) },
    { hour: 14, minute: 30, context: 'after_meal', value: around(148 + bump, 18) },
  ];
  if (dayIndex % 2 === 0) {
    out.push({ hour: 22, minute: 10, context: 'bedtime', value: around(122 + bump, 12) });
  }
  // A couple of deliberate outliers across the two weeks, like the reference data.
  if (dayIndex === 3) out[1].value = 192; // spike after pizza
  if (dayIndex === 8) out[1].value = 186; // post-meal spike
  if (dayIndex === 11) out[0].value = 64; // low fasting morning
  if (dayIndex === 5 && out[2]) out[2].value = 178;
  return out.map((r) => ({
    ...r,
    at: new Date(date.getFullYear(), date.getMonth(), date.getDate(), r.hour, r.minute),
  }));
}

const NOTES = {
  fasting: ['Slept well', 'Woke up early', '', ''],
  after_meal: ['After lunch', 'Post-meal spike', 'Spike after pizza', 'Ate out — dosa', 'Stressful day', ''],
  bedtime: ['Evening walk done', '', 'Felt a little tired today', ''],
};

async function main() {
  await initDb();

  const email = 'demo@sweety.app';
  const passwordHash = await bcrypt.hash('demo1234', 10);
  const userRes = await pool.query(
    `INSERT INTO users (name, email, password_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name, email`,
    ['Demo User', email, passwordHash],
  );
  const user = userRes.rows[0];

  await pool.query('DELETE FROM readings WHERE user_id = $1', [user.id]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let inserted = 0;
  for (let dayOffset = 13; dayOffset >= 0; dayOffset -= 1) {
    const day = new Date(today);
    day.setDate(day.getDate() - dayOffset);
    // Do not seed readings later than "now" on the current day.
    for (const r of readingsForDay(day, 13 - dayOffset)) {
      if (r.at > new Date()) continue;
      const notesPool = NOTES[r.context] || [''];
      const note = notesPool[Math.floor(rand() * notesPool.length)];
      await pool.query(
        `INSERT INTO readings (user_id, glucose_mg_dl, measured_at, meal_context, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, r.value, r.at.toISOString(), r.context, note],
      );
      inserted += 1;
    }
  }

  console.log(`Seeded demo user ${email} (password: demo1234) with ${inserted} readings.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
