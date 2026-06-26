# RE/MAX Platinum — Lead Generation & Routing Platform

A unified Next.js 14 application serving public seller lead-generation pages, a lead
routing/agent-management backend, and an admin dashboard — all on one domain
(`remax-platinumonline.com`). Launch cities: Brighton, Ann Arbor, Fenton, Grand Blanc.

**Stack:** Next.js 14 (App Router, SSR + ISR) · Neon PostgreSQL + Drizzle ORM ·
Upstash Redis · Resend · RentCast · Google Maps Places · Vercel.

## Quick start

```bash
npm install
cp .env.example .env                  # fill in every value
npm run hash-password -- 'admin-pw'   # → ADMIN_PASSWORD_HASH
npm run db:migrate                    # create schema in Neon
npm run seed                          # seed the four launch cities
npm run dev                           # http://localhost:3000
```

See **[SETUP.md](./SETUP.md)** for full setup, deployment, cron, and webhook docs.

## Surfaces

| Surface | URL | Audience |
| --- | --- | --- |
| Public city pages | `/sell/[city-slug]` | Homeowners (SEO) |
| Homepage | `/` | Direct + ad traffic |
| Thank-you | `/thank-you` | Post-submission |
| Agent portal | `/agent/*` | Agents (magic link / password) |
| Admin dashboard | `/admin/*` | Owner (NextAuth) |
| API + webhooks | `/api/*` | Internal + external lead sources |

## Project layout

```
app/
  page.tsx                      Homepage (ISR 24h)
  sell/page.tsx                 City index
  sell/[slug]/page.tsx          City lead-gen page (ISR 1h, JSON-LD, 10 sections)
  sell/[slug]/opengraph-image.tsx
  thank-you/                    Post-submission + appointment form
  sitemap.ts, robots.ts
  admin/*                       Admin dashboard (NextAuth-protected)
  agent/*                       Agent portal (signed session cookie)
  api/leads/*                   Internal lead capture
  api/valuation                 RentCast proxy (rate-limited)
  api/appointments
  api/webhooks/*                External lead/appointment webhooks (API key)
  api/offer/[token]             Agent offer accept/decline
  api/cron/*                    4 scheduled jobs
  api/agent/*                   Agent login/status-update/reorder
components/
  ui/                           Shared UI kit
  city/                         City-page sections
  admin/, agent/                Surface-specific components
lib/
  db.ts                         Neon + Drizzle (lazy client)
  routing.ts                    Proximity-first routing engine  <- tested
  offerWindow.ts                7am-8pm ET window               <- tested
  autoOffer.ts                  autoOfferLead / reassignLead
  scoring.ts                    Agent score system
  email.ts                      Resend + 7 templates
  redis.ts                      Upstash cache + rate limiters
  seo.ts                        JSON-LD (LocalBusiness, FAQPage)
  agentPortalAuth.ts, agentSession.ts, apiKeys.ts, rentcast.ts, validation.ts, env.ts
drizzle/
  schema.ts                     PostgreSQL schema
  migrations/                   Generated SQL
scripts/
  seed.ts                       Seed launch cities
  hash-password.ts              bcrypt hash CLI
auth.ts                         NextAuth v5 (admin credentials)
middleware.ts                   Protects /admin/* and /agent/*
vercel.json                     Cron schedule
```

## Tests

```bash
npm run test       # routing engine (incl. Dearborn proximity fix) + offer window
npm run typecheck
npm run build
```
