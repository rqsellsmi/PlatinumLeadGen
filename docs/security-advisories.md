# Production dependency advisories

Status of `npm audit --omit=dev` and what is deliberately not patched. Review
item #12 (P0.5) requires no known **critical** production advisories, and any
remaining **high** either patched or documented — this file is that
documentation.

Last reviewed: 2026-07-29.

## Patched

| Package | Was | Now | Was | Notes |
|---|---|---|---|---|
| `next-auth` / `@auth/core` | 5.0.0-beta.25 | 5.0.0-beta.32 | **critical** | Not a semver major. Blast radius was already small — next-auth covers only the ADMIN login; agent auth is a separate signed-HMAC cookie (`lib/agentPortalAuth.ts`). |
| `drizzle-orm` | 0.38.4 | 0.45.2 | **high** | A `0.x` bump, which npm reports as semver-major. Typecheck, all tests and the production build pass unchanged. |
| `next` | 14.2.33 | 14.2.35 | — | Latest patch inside the current major. Does not clear the advisories below. |

Verified after upgrade: `npm run typecheck`, `npm test` (275 cases),
`SKIP_ENV_VALIDATION=1 npm run build`.

## Accepted for now — require a framework major

Two **high** advisories remain, and both resolve to the same fix: `next@16`.

| Package | Range | Severity |
|---|---|---|
| `next` | `9.3.4-canary.0 – 16.3.0-canary.5` | high |
| `postcss` | `<= 8.5.17` (transitive, via `next`) | high |

**Why not patched.** The advisory range covers every published Next.js 14 and
15 release, so there is no in-major patch to take — not even a newer 15.x. The
only fix is Next 16, which is a framework major (React 19, App Router API
changes, a new `postcss` chain) and would need its own regression pass. Doing
that inside the P0 window would mean shipping the highest-risk change in the
plan at the same moment as the identity, token and routing work, with the CI
gate barely a day old. Review item #12 explicitly allows "high advisories
documented or patched."

**Exposure in this deployment.** Most of the listed Next.js issues are
denial-of-service or cache-poisoning bugs whose severity assumes a self-hosted
Node server. This app runs on Vercel, where the CDN and Image Optimizer are
platform-managed rather than served from our process, which materially reduces —
but does not eliminate — the practical exposure. The `postcss` advisories are
build-time only: they concern `sourceMappingURL` handling and stringify output
while compiling CSS we author ourselves, so there is no untrusted input on that
path in this repo.

Two specific ones worth naming, because a repo change affects them:

- *DoS via Image Optimizer `remotePatterns`* — `next.config.js` still allows
  `hostname: '**'`. Review item #13 (restrict the image allowlist to known
  MLS/CDN/Google hosts) is the mitigation and is scheduled for P2. Landing #13
  meaningfully shrinks this one without waiting for Next 16.
- *XSS with CSP nonces* — not applicable today; the CSP uses `'unsafe-inline'`
  rather than nonces (review item #15).

**Plan.** Next 16 is a P1 upgrade with its own branch and regression pass, done
after the P0 set has settled and CI has a few green runs behind it. Do it
together with #13 (image allowlist) and #60 (Dependabot + a patch SLA) so the
audit stays green afterwards rather than drifting back.

## How to re-check

```bash
npm audit --omit=dev        # production dependency tree only
npm audit                   # includes devDependencies (build tooling)
```

`--omit=dev` is the number that matters for what ships. Dev-only advisories
affect the build machine, not the running site; they are still worth clearing,
but they are not a launch gate.
