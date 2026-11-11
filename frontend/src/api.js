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
  monthlyReport: (year, month) => request(`/reports/monthly?year=${year}&month=${month}`),
};

export const MEAL_LABELS = {
  fasting: 'Fasting',
  before_meal: 'Before meal',
  after_meal: 'After meal',
  bedtime: 'Bedtime',
  other: 'Other',
};

export function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export function toLocalInputValue(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function todayISODate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
