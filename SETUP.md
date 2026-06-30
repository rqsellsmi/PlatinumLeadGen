# RE/MAX Platinum — Lead Generation & Routing Platform — Setup

Unified Next.js 14 application: public seller lead-gen pages, lead routing/agent
management backend, and an admin dashboard — all on one domain.

**Stack:** Next.js 14 (App Router) · Neon PostgreSQL (Drizzle ORM) · Microsoft Graph Mail ·
RentCast · Google Maps Places · Vercel.

---

## 1. Prerequisites (create these accounts and collect keys)

| Service | What you need | Notes |
| --- | --- | --- |
| **Neon** (neon.tech) | `DATABASE_URL` | New project → copy the connection string. |
| **Microsoft 365** | Entra tenant ID, app client ID/secret, sender mailbox | Grant Microsoft Graph `Mail.Send` application permission and admin consent. |
| **RentCast** | `RENTCAST_API_KEY` | For the home-valuation tool. |
| **Google Maps** | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Enable Maps JavaScript API and Places API. Restrict the key by HTTP referrer. |

---

## 2. Local setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
#    Fill in EVERY value. The app validates all required vars at startup
#    and throws a descriptive error listing any that are missing.

# 3. Generate the admin password hash and paste it into .env as ADMIN_PASSWORD_HASH
npm run hash-password -- 'your-admin-password'

# 4. Create the database schema (runs the generated migration against Neon)
npm run db:migrate

# 5. Seed the four launch cities (Brighton, Ann Arbor, Fenton, Grand Blanc)
#    with SEO copy stubs + default FAQ, plus the settings/metrics rows.
npm run seed

# 6. Run the dev server
npm run dev      # http://localhost:3000
```

> Tip: `npm run db:push` is a faster alternative to migrate for early development
> (pushes the schema directly without a migration file). Use `db:migrate` for
> production so changes are tracked.

### Useful scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (Vercel runs this) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest unit tests (routing engine + offer window) |
| `npm run db:generate` | Regenerate migration SQL after editing `drizzle/schema.ts` |
| `npm run db:migrate` | Apply migrations to the database |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run seed` | Seed launch cities + settings |
| `npm run hash-password -- '<pw>'` | Print a bcrypt hash (admin password / agent passwords) |

---

## 3. Deploy to Vercel

1. Import the GitHub repo into Vercel (one project, one domain).
2. Set the domain to **remax-platinumonline.com** (or your domain) and set
   `NEXTAUTH_URL` / `SITE_URL` to match.
3. Add **every** variable from `.env.example` in **Project Settings → Environment
   Variables** (Production + Preview).
4. Vercel runs `npm run build` automatically. The crons in `vercel.json` are
   registered on deploy (see §5).
5. After the first deploy, run the migration + seed against the production DB.
   You can run them locally with the production `DATABASE_URL`:
   ```bash
   DATABASE_URL='<prod-neon-url>' npm run db:migrate
   DATABASE_URL='<prod-neon-url>' EMAIL_ADMIN_EMAIL='<owner>' npm run seed
   ```

> **CSP:** `next.config.js` ships a Content-Security-Policy (Section 13.1) that
> allows Google Maps, GTM, and RentCast. Do not disable it. If you add a new
> third-party script, add its origin to the policy.

---

## 4. First-run admin tasks

Log in at **`/admin/login`** with `ADMIN_USERNAME` + your password, then:

1. **Offices** (`/admin/offices`) — add office locations with lat/lng (used as the
   routing fallback when an agent has no own coordinates).
2. **Agents** (`/admin/agents`) — add agents, assign an office and/or own lat/lng,
   and set passwords (agents may also use magic links). Agents do **not** self-register.
3. **Locations → Stats / SEO / Sales / Testimonials** — populate market stats, recent
   sales, and testimonials per city. The four launch cities already exist with SEO
   copy stubs; edit them at `/admin/locations/[id]/seo`.
4. **Settings** (`/admin/settings`) — notification email, offer-window hours
   (default 7am–8pm ET), and proximity radius (default 20 miles).
5. **API Keys** (`/admin/api-keys`) — generate keys for external lead sources
   (Zillow, Facebook Lead Ads, etc.). The raw key is shown **once** on creation.

---

## 5. Scheduled jobs (Vercel Cron)

Defined in `vercel.json`. Every handler verifies the `x-cron-secret` header against
`CRON_SECRET`.

| Path | Schedule | Job |
| --- | --- | --- |
| `/api/cron/dispatch-queued-offers` | every 5 min | Send offers queued outside the offer window once it reopens. |
| `/api/cron/expire-offers` | every 10 min | Expire offers >3h unanswered, penalize, reassign. |
| `/api/cron/followup-check` | every 30 min | 48h escalation alerts + weekly agent reminders. |
| `/api/cron/broker-digest` | Thu 13:00 UTC (≈8am ET) | Weekly broker digest email. |

To test a cron locally:
```bash
curl -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/cron/expire-offers
```

---

## 6. External webhook (other lead sources)

```bash
curl -X POST https://remax-platinumonline.com/api/webhooks/lead \
  -H "x-api-key: <RAW_KEY_FROM_ADMIN>" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"ext-123","email":"seller@example.com",
       "propertyAddress":"123 Main St, Brighton, MI 48116","source":"zillow"}'
```
- Invalid/missing key → `401`.
- More than 20 requests / 15 min / IP → `429`.
- Valid lead → written to the same `leads` table and routed through the same engine.

There is also `/api/webhooks/appointment` (same API-key auth).

---

## 7. Architecture notes

- **Routing engine** (`lib/routing.ts`): proximity-first weighted round-robin. The
  "Dearborn bug" is fixed — the proximity pool is built **before** walking the queue,
  so a far agent is never offered a lead ahead of a nearer one. Falls back to the full
  queue when no agent is in radius, and to all active agents when the lead has no
  coordinates. Covered by `tests/routing.test.ts`.
- **Offer window** (`lib/offerWindow.ts`): 7am–8pm ET. The 3-hour acceptance timer
  starts when the offer email is **sent**, not when the lead arrives.
- **Caching/ISR**: city pages are ISR (revalidate 1h), homepage 24h. Editing
  SEO/stats in admin triggers `revalidatePath` so changes go live within seconds.
- **Rate limiting**: webhook and valuation rate limits use atomic counters in Neon,
  keeping the deployment to a single data service.
- **Auth**: admin = NextAuth credentials (bcrypt hash in env, no user table);
  agents = magic link or admin-set password, signed httpOnly session cookie;
  webhooks = bcrypt-compared API keys; cron = shared secret header.

See `LeadPlatform_BuildSpec_v1.2` for the full specification.
