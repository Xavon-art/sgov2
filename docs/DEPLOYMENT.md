# Deployment and credential handling

This project should never read, print, or store credentials in source control,
in chat, or in local notes. Secrets belong in the platform that uses them.

## Immediate action required

The git `origin` remote contained a GitHub Personal Access Token embedded in
its URL. Treat it as compromised:

1. Revoke/rotate that token at **GitHub → Settings → Developer settings →
   Personal access tokens**.
2. Remove it from local git config:

   ```bash
   git remote set-url origin https://github.com/dreamerdev-SYS/smartgov.git
   ```

3. Authenticate with a credential helper (`git config --global credential.helper manager`)
   or an SSH key instead of a token in the URL.
4. Keep `.env*`, `.vercel`, and `*MUST-IGNORE*` out of git (already in `.gitignore`).

## How automated deploy-to-test works

No credentials are needed inside the repository. Connect the GitHub repo to
Vercel once through the **Vercel GitHub App (OAuth)** — not a PAT:

- Vercel dashboard → **Add New → Project → Import** the `smartgov` repository.
- Every push/PR to a branch produces a **Preview deployment** (test).
- Merging to `main` produces the **Production deployment**.
- `.github/workflows/ci.yml` runs lint and build on every push and PR.

## Where secrets go

Set these in **Vercel → Project → Settings → Environment Variables**, with
separate values for **Preview** and **Production**. Never commit them.

| Variable | Scope | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Preview + Production | Public by design |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Preview + Production | Publishable key only; never a `service_role` key |
| `POSTGRES_URL` / `DATABASE_URL` | Preview + Production | Server-only; point Preview at a **separate test database** |
| `AUTH_PEPPER` | Preview + Production | Server-only |
| `CRON_SECRET` | Preview + Production | Protects `/api/cron/tick` |
| `NEXT_PUBLIC_SITE_URL` | Preview + Production | Must match the deployed origin |
| `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`, `AI_VISION_MODEL`, `AI_JSON_MODE`, `AI_TIMEOUT_MS`, `AI_MAX_OUTPUT_TOKENS` | As needed | Server-only |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` or `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`, `MAIL_FROM_NAME` | As needed | Server-only |

Rules:

- Only `NEXT_PUBLIC_*` values are exposed to the browser. Everything else must
  remain server-only.
- Use a **different Supabase project** (or at least a different schema/database)
  for Preview than for Production so test data cannot touch live data.
- Apply `supabase/migrations/*` to each environment deliberately; do not run
  production migrations from a local machine against the test database by accident.

## CI

`.github/workflows/ci.yml` runs `npm ci`, `npm run lint`, and `npm run build`.
If you later add integration checks that need live data, add the values as
**GitHub → Settings → Secrets and variables → Actions** and reference them with
`${{ secrets.NAME }}` — never inline them in the workflow file.
