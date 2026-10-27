# SmartGov

Centralized and Intelligent Governance Management System for the **federated (decentralized)** student government model: one University Student Government (USG) with many Local Student Governments (LSGs) under it.

## Tech stack

- Next.js (App Router) + TypeScript (strict)
- Tailwind CSS v4
- Supabase / Postgres (via `pg`)
- Nodemailer (SMTP) with dev Outbox fallback
- Recharts, ExcelJS, dnd-kit

## Setup

### 1. Install

```bash
npm install
```

### 2. Environment variables

Copy `.env.local.example` to `.env.local` and fill in:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
AUTH_PEPPER=<64 hex chars>
GMAIL_USER=<your gmail>
GMAIL_APP_PASSWORD=<google app password>
MAIL_FROM_NAME=SmartGov
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
NEXT_PUBLIC_SITE_URL=https://your-deploy-url
```

If SMTP is not configured, emails are stored in the `smartgov.outbox` table and viewable at `/dev/outbox` (dev only).

### 3. Database migrations

```bash
node scripts/apply-migration.mjs supabase/migrations/*.sql
```

Each migration is recorded in `smartgov.applied_migrations`; re-running is a no-op. Use `--force` to re-apply.

### 4. Run

```bash
npm run dev
```

Open http://localhost:3000.

### 5. Verification

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run check:units
```

## Architecture

- **Auth**: email + password (bcrypt via pgcrypto), httpOnly session cookie, rate limiting.
- **Storage**: files uploaded to local disk behind a storage interface (swappable for S3).
- **Scheduler**: time-based behavior (auto-close tasks, expire requests, deactivation windows, survey close) is computed lazily on read so it stays correct even if a scheduler was down.
- **Timezones**: stored as IANA names, timestamps in UTC.
- **Real-time**: polling fallback for chat and notifications.

## Swapping SQLite for Postgres

The codebase uses Postgres (Supabase) exclusively. To use a local Postgres, point `DATABASE_URL` at your local instance and run the migrations.

## Swapping local storage for S3

File uploads go through `src/lib/storage` (or the upload routes). Implement the storage interface for S3 and swap the binding.