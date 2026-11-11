// Tiny API client for the Sweety backend. Token lives in localStorage.
const API = '/api';

function getToken() {
  return localStorage.getItem('sweety_token');
}

export function setToken(token) {
  if (token) localStorage.setItem('sweety_token', token);
  else localStorage.removeItem('sweety_token');
}

export function isLoggedIn() {
  return Boolean(getToken());
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  signup: (name, email, password) =>
    request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }),
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => request('/auth/me'),
  listReadings: (limit = 50, offset = 0) =>
    request(`/readings?limit=${limit}&offset=${offset}`),
  addReading: (reading) =>
    request('/readings', { method: 'POST', body: JSON.stringify(reading) }),
  updateReading: (id, reading) =>
    request(`/readings/${id}`, { method: 'PUT', body: JSON.stringify(reading) }),
  deleteReading: (id) => request(`/readings/${id}`, { method: 'DELETE' }),
  stats: () => request('/stats'),
  dailyReport: (date) => request(`/reports/daily?date=${date}`),
  monthToDateReport: (date) => request(`/reports/month-to-date?date=${date}`),
  // Monthly report covers the whole previous month relative to the date.
  monthlyReport: (date) => request(`/reports/monthly?date=${date}`),
};

// Kenpath's 4 time slots.
export const TIME_SLOTS = ['morning', 'after_breakfast', 'after_lunch', 'after_dinner'];

export const SLOT_LABELS = {
  morning: 'Morning (fasting)',
  after_breakfast: 'After breakfast',
  after_lunch: 'After lunch',
  after_dinner: 'After dinner',
};

// Short names used in validation messages, e.g.
// "You already have an After lunch reading for this date."
export const SLOT_SHORT = {
  morning: 'Morning',
  after_breakfast: 'After breakfast',
  after_lunch: 'After lunch',
  after_dinner: 'After dinner',
};

// "a" vs "an" for a slot name, e.g. "a Morning reading", "an After lunch reading".
export function slotArticle(slot) {
  return /^[AEIOU]/i.test(SLOT_SHORT[slot] || '') ? 'an' : 'a';
}

// Format a YYYY-MM-DD date (or an ISO timestamp) as e.g. "11 Nov 2026".
// Parses the date parts directly so the displayed day never shifts with timezone.
export function formatDay(value) {
  if (!value) return '';
  const datePart = String(value).slice(0, 10);
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return datePart;
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDate(iso) {
  return formatDay(iso);
}

export function todayISODate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
