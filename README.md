# Sweety — Blood Glucose Tracker

A full-stack blood glucose tracker. Log readings, see trends on a dashboard,
and review daily and monthly reports. Built as a hiring take-home for
**Kenpath Technologies**.

> For personal tracking and trend review only — not medical advice.

## What it does

- **Authentication** — sign up, log in, log out; JWT-protected API routes
- **Readings CRUD** — add, view, edit and delete glucose readings
  (value in mg/dL, a date, and one of 4 time slots — Morning (fasting) /
  After breakfast / After lunch / After dinner — plus free-text notes)
- **Dashboard** — average / today / lowest / highest stats, 7-day average chart,
  recent readings
- **Daily report** — every reading for a chosen day, with min / max / average
  (1 decimal) and a time-slot breakdown
- **Month-to-date report** — 1st of the month up to the chosen date, with
  min / max / average, a day-by-day table and the readings list
- **Monthly report** — the whole previous month relative to the chosen date
  (e.g. pick 15 Oct → 1–30 Sep), with daily averages as a chart plus a
  day-by-day table and a month summary
- **Seed data** — a demo account with 2 weeks of realistic readings so the
  reports have content from day one

## Tech stack

| Layer    | Technology                                    |
| -------- | --------------------------------------------- |
| Frontend | React 18 + Vite                               |
| Backend  | Node.js + Express                             |
| Database | **PostgreSQL** (all readings + users live here) |
| Auth     | bcrypt password hashing + JWT                 |

## Project structure

```
sweety/
├── backend/
│   ├── src/
│   │   ├── server.js      # Express app: auth, readings CRUD, stats, reports
│   │   ├── db.js          # PostgreSQL pool + schema
│   │   ├── auth.js        # JWT sign/verify middleware
│   │   └── seed.js        # Demo user + 2 weeks of sample readings
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx        # Auth, dashboard, daily + monthly reports
│   │   ├── api.js         # API client
│   │   ├── index.css      # Clean minimal styling
│   │   └── components/    # Logo, SVG line chart, reading form
│   ├── index.html
│   ├── vite.config.js     # Dev proxy: /api -> localhost:4000
│   └── package.json
└── README.md
```

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL 14+ running locally

## Setup

### 1. Database

Create the database and user (defaults match `backend/.env.example`):

```sql
-- as the postgres superuser:
CREATE USER sweety WITH PASSWORD 'sweety';
CREATE DATABASE sweety OWNER sweety;
```

Or with one command:

```bash
sudo -u postgres psql -c "CREATE USER sweety WITH PASSWORD 'sweety';"
sudo -u postgres psql -c "CREATE DATABASE sweety OWNER sweety;"
```

Or with Docker:

```bash
docker run --name sweety-pg -e POSTGRES_USER=sweety -e POSTGRES_PASSWORD=sweety \
  -e POSTGRES_DB=sweety -p 5432:5432 -d postgres:16
```

No install at all is also possible: `pip install pgserver` bundles real
PostgreSQL binaries and can init/start a local cluster on 127.0.0.1:5432.
(This is how the app was developed and tested in this repo's sandbox, where
the Ubuntu apt mirrors were unreachable.)

Tables are created automatically when the backend first starts.

### 2. Backend

```bash
cd backend
cp ../.env.example .env     # all variables are listed in .env.example at the repo root
npm install
npm run seed                # creates demo@sweety.app / demo1234 + 2 weeks of readings
npm start                   # API on http://localhost:4000
```

### Seed data

`backend/src/seed.js` (run with `npm run seed` in `backend/`) creates the
demo user `demo@sweety.app` / `demo1234` and 2 weeks of realistic sample
readings across the 4 time slots (49 readings, values 64–192 mg/dL). It is
deterministic — re-running it wipes the demo user's readings and recreates
the same set — so it is safe to run again after resetting the database.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                 # app on http://localhost:5173
```

The Vite dev server proxies `/api` to the backend, so no CORS setup is needed
in development.

## Demo account

Seeded by `npm run seed` in `backend/`:

- Email: `demo@sweety.app`
- Password: `demo1234`

The demo account comes with 49 readings across 14 days (29 Oct–11 Nov 2026),
values 64–192 mg/dL — fasting mornings, after-breakfast, after-lunch and
after-dinner readings, with a couple of post-meal spikes above 180 and one low
morning below 70, so the dashboard, daily report and monthly report all render
with data immediately.
Every number is synthetic sample data — no real person's health data is in the repo.

## API reference

Base URL: `http://localhost:4000/api` — all routes except signup/login need
`Authorization: Bearer <token>`.

| Method | Route                    | Description                                    |
| ------ | ------------------------ | ---------------------------------------------- |
| POST   | `/auth/signup`           | Create account → `{ token, user }`             |
| POST   | `/auth/login`            | Log in → `{ token, user }`                     |
| GET    | `/auth/me`               | Current user                                   |
| GET    | `/readings?limit&offset` | List readings, newest first                    |
| POST   | `/readings`              | Add a reading                                  |
| PUT    | `/readings/:id`          | Update a reading                               |
| DELETE | `/readings/:id`          | Delete a reading                               |
| GET    | `/stats`                 | Totals, averages, last-7-days, recent readings |
| GET    | `/reports/daily?date=`   | Readings + summary for `YYYY-MM-DD`            |
| GET    | `/reports/month-to-date?date=` | Summary + days + readings, 1st → `date`  |
| GET    | `/reports/monthly?date=` | Daily averages + summary for the whole previous month |
| GET    | `/health`                | Health check                                   |

## Environment variables (backend)

| Variable     | Default   | Description                  |
| ------------ | --------- | ---------------------------- |
| `PORT`       | `4000`    | API port                     |
| `PGHOST`     | `localhost` | PostgreSQL host            |
| `PGPORT`     | `5432`    | PostgreSQL port              |
| `PGUSER`     | `sweety`  | PostgreSQL user              |
| `PGPASSWORD` | `sweety`  | PostgreSQL password          |
| `PGDATABASE` | `sweety`  | PostgreSQL database          |
| `JWT_SECRET` | —         | Secret for signing JWTs (change in production) |

## Notes

- **Validation** — readings are validated against Kenpath's rules in both
  the form and the API, with the assignment's exact error messages:
  value required ("Please enter a glucose value."), whole number 40–600
  ("Value must be between 40 and 600 mg/dl."), one reading per slot per
  day ("You already have an After lunch reading for this date."), max 4
  per day ("You can add only 4 readings per day.") and no future dates
  ("Date cannot be in the future."). The database also enforces the
  40–600 range and one-per-slot-per-day with constraints.
- Readings are strictly per-user: every query is scoped by the JWT's user id.
- No personal health data is included in this repo — the only readings are the
  synthetic seed data for the demo account.
