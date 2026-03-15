# Welday Enterprises Open Brain — Deployment Guide
**Date:** March 13, 2026 | **Status:** Live at https://welday-open-brain.vercel.app

---

## What Was Built

A full-stack AI-powered operations dashboard for Welday Enterprises (11 ventures) with:
- **React + Vite + Express + Tailwind + shadcn/ui** frontend/backend
- **Supabase** (PostgreSQL) database with 14 tables
- **3 AI agents**: Virtual CEO (Burns), Executive Assistant (Smithers/Moneypenny), GTD Filer (Radar)
- **4 Telegram bots** with role-aware personalities
- **8 dashboard pages**: Overview, Ventures, Assistant, CEO, GTD, Inbox, Search, Settings
- **Google OAuth** login via Supabase
- **Gemini 2.0 Flash Lite** for all AI (free tier, multi-key waterfall)

---

## Architecture

```
GitHub (finallyaiagency/welday-open-brain)
  └── dashboard/          ← React+Express app (Vercel root)
      ├── api/index.ts    ← Vercel serverless function (all /api/* routes)
      ├── client/         ← React frontend (Vite)
      ├── server/         ← Express routes (dev only)
      └── vercel.json     ← Build config + cron jobs
  └── agents/             ← Standalone Node.js agent scripts
      ├── ceo-agent.js
      ├── gtd-filer.js
      └── ea-agent.js
  └── schema.sql          ← Full Supabase schema (14 tables, RLS policies)
```

**Key constraint:** Vercel is a serverless platform — Express cannot run as a persistent server. All `/api/*` routes are handled by `dashboard/api/index.ts` as a single Vercel serverless function.

---

## Infrastructure

| Service | Account | Details |
|---|---|---|
| **Vercel** | finally-ais-projects org | welday-open-brain project, Hobby plan |
| **GitHub (primary)** | welday-enterprises-llc | Source of truth, push access via token |
| **GitHub (Vercel-linked)** | finallyaiagency | Vercel watches this repo |
| **Supabase** | weldayenterprises@gmail.com | Project: lqtamdgtbokewphcgwzy, East US |
| **Telegram** | @BotFather | 4 bots registered |
| **Gemini** | 3 different Google accounts | Key waterfall for quota |

---

## Why Two GitHub Accounts

Vercel requires phone number verification for new accounts. When attempting to create a second Vercel account (under `weldayenterprises@gmail.com`) to connect the `welday-enterprises-llc` GitHub repo, Vercel rejected the phone number as already used.

**Solution:**
1. Used the existing `finallyaiagency` Vercel account (already verified)
2. Created `finallyaiagency/welday-open-brain` as a mirror repo
3. Added `welday-enterprises-llc` as a collaborator with Write access to `finallyaiagency/welday-open-brain`
4. All code changes are pushed to both repos simultaneously:
   ```bash
   git remote add origin    https://<TOKEN>@github.com/welday-enterprises-llc/welday-open-brain.git
   git remote add finallyai https://<TOKEN>@github.com/finallyaiagency/welday-open-brain.git
   git push origin main && git push finallyai main
   ```
5. Vercel auto-deploys from `finallyaiagency/welday-open-brain` on every push

---

## Step-by-Step Deployment (What Was Done)

### Phase 1 — Code
1. Built full React+Express dashboard app locally in `/welday-open-brain/dashboard/`
2. Built 3 agent scripts in `/welday-open-brain/agents/`
3. Wrote 405-line `schema.sql` with 14 tables + RLS + seed data
4. Registered 4 Telegram bots via @BotFather, got tokens
5. Set Telegram webhooks to `https://welday-open-brain.vercel.app/api/telegram/<botname>`

### Phase 2 — GitHub
1. Created empty `welday-enterprises-llc/welday-open-brain` repo (already existed)
2. Pushed all code via git using GitHub personal access token
3. Created `finallyaiagency/welday-open-brain` as mirror
4. Added `welday-enterprises-llc` as Write collaborator on `finallyaiagency` repo

### Phase 3 — Vercel
1. Logged into `finallyaiagency` Vercel account
2. Imported `finallyaiagency/welday-open-brain` repo
3. Set **Root Directory** to `dashboard`
4. Set **Build Command** to `npm run build`
5. Set **Output Directory** to `dist/public`
6. Added all environment variables (see below)
7. Deployed

**Critical:** The `vercel.json` inside `dashboard/` handles routing:
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist/public",
  "functions": { "api/index.ts": { "maxDuration": 30 } },
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/index.ts" },
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "crons": [
    { "path": "/api/ceo/run",    "schedule": "0 9 * * *" },
    { "path": "/api/gtd/process","schedule": "0 8 * * *" }
  ]
}
```
Vercel Hobby plan only allows daily crons — original hourly cron (`0 * * * *`) was rejected.

### Phase 4 — Supabase
1. Ran `schema.sql` in Supabase SQL Editor (creates all 14 tables + seeds 11 ventures)
2. Added RLS policies to allow authenticated users to read/write all tables:
   ```sql
   create policy "authenticated users can read ventures"
   on ventures for select to authenticated using (true);
   -- (repeated for all tables)
   ```
3. Configured Google OAuth in Supabase → Auth → Providers → Google
4. Added `https://welday-open-brain.vercel.app/**` to Supabase redirect URLs
5. Added Supabase callback URL to Google Cloud Console OAuth client

### Phase 5 — Gemini Keys
- Initially used `gpt-4o-mini` (OpenAI) — swapped to Gemini free tier to avoid costs
- Model progression: `gemini-1.5-flash` (deprecated 404) → `gemini-2.0-flash` (quota issues) → `gemini-2.0-flash-lite` (15 RPM free tier, current)
- **Quota problem:** Multiple keys from the same Google project share quota
- **Solution:** Created keys from 3 different Google accounts → each has independent daily quota
- **Waterfall logic:** Code auto-tries KEY → KEY_2 → KEY_3 on 429/403 errors

---

## Environment Variables (Vercel)

```
VITE_SUPABASE_URL          = https://lqtamdgtbokewphcgwzy.supabase.co
VITE_SUPABASE_ANON_KEY     = <from Supabase Settings → API>
SUPABASE_URL               = https://lqtamdgtbokewphcgwzy.supabase.co
SUPABASE_SERVICE_ROLE_KEY  = <from Supabase Settings → API>
GEMINI_API_KEY             = <Google account 1 key>
GEMINI_API_KEY_2           = <Google account 2 key — different account>
GEMINI_API_KEY_3           = <Google account 3 key — different account>
TELEGRAM_TOKEN_BURNS       = 8654534094:REDACTED_BURNS_TOKEN
TELEGRAM_TOKEN_SMITHERS    = 8610077511:REDACTED_SMITHERS_TOKEN
TELEGRAM_TOKEN_RADAR       = 8765855745:REDACTED_RADAR_TOKEN
TELEGRAM_TOKEN_MONEYPENNY    = 8268596065:AAGTaK74IsoULkumEgwX1zxXtoGkzML-JhE
```

---

## Telegram Bots

| Bot | Username | Role | Personality |
|---|---|---|---|
| Burns | @Burns_Welday_Ent_bot | Virtual CEO | Mr. Burns — cold, calculating, strategic |
| Smithers | @Smithers_Welday_Ent_bot | Executive Assistant | Waylon Smithers — efficient, professional |
| Radar | @Radar_Welday_Ent_bot | GTD Filer | Radar O'Reilly — terse, anticipatory |
| Moneypenny | @Moneypenny_Welday_Ent_bot | EA (fun variant) | Sharp, witty, classic yet modern EA |

**Webhook format:** `https://welday-open-brain.vercel.app/api/telegram/<botname>`

**Commands wired:**
- Any message → captured to `gtd_inbox` + role-appropriate AI reply
- `/briefing` or `/b` → top 3 priorities for today
- `/process` or `/file` → trigger GTD filer (Radar bot)
- `/status` → inbox count (Radar bot)

---

## Common Issues Encountered & Fixes

| Problem | Cause | Fix |
|---|---|---|
| 404 on all pages | Vercel serving static only, no SPA routing | Added `rewrites` in vercel.json |
| `/api/*` returns 404 | Vercel can't run persistent Express server | Rewrote as standalone serverless function in `api/index.ts` |
| `FUNCTION_INVOCATION_FAILED` | `@vercel/node` not installed, `http.Server` in serverless | Removed dependency, used plain Node `http` types |
| Blank ventures page | RLS enabled but no read policies | Added `create policy` for all tables |
| "Sorry, something went wrong" | Frontend catch block ignoring API error body | Changed to `data.reply \|\| data.error` |
| Gemini 404 | `gemini-1.5-flash` deprecated | Updated to `gemini-2.0-flash-lite` |
| Quota exhausted on all 3 keys | All keys from same GCP project share quota | Created keys from 3 different Google accounts |
| Google OAuth blocked | Vercel domain not in Supabase redirect URLs | Added `https://welday-open-brain.vercel.app/**` to Supabase |
| Build completes in 3s (no-op) | Root directory not set to `dashboard/` | Set Root Directory in Vercel settings |
| localStorage crashes in iframe | Perplexity sandbox blocks localStorage | In-memory polyfill patch post-build |

---

## What Still Needs Doing

- [ ] Run full `schema.sql` to create all 14 tables (only `ventures` was created manually)
- [ ] Enable additional RLS policies for writes (GTD captures, CEO recs, agent logs)
- [ ] Telegram bots are live but CEO/GTD agents only run as daily Vercel crons — for real-time processing consider an external cron service (cron-job.org free tier)
- [ ] Google Calendar sync (wired in schema, not yet connected)
- [ ] OpenAI API key optional fallback if Gemini quota issues persist

---

## Repo URLs

- **Primary (push here):** https://github.com/welday-enterprises-llc/welday-open-brain
- **Vercel-linked (auto-deploys):** https://github.com/finallyaiagency/welday-open-brain
- **Live dashboard:** https://welday-open-brain.vercel.app
- **Supabase dashboard:** https://supabase.com/dashboard/project/lqtamdgtbokewphcgwzy
