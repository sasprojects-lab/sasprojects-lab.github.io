# SAS Player — Workers + Durable Objects, kept on your bookmarked URL

Frontend stays on `https://sasprojects-lab.github.io` (bookmarks keep working).
Only the API + WebSocket move to a Cloudflare Worker. Because that's two
different origins, auth uses a Bearer token instead of a cookie — see the
note at the top of `sas-realtime.js` for why.

## Deploy the Worker (API + WebSocket)

The Worker files are located directly in `src/` (`src/index.ts` and `src/room.ts`) with `wrangler.toml` and `package.json` ready.

```bash
# Install dependencies
npm install

# Set production secrets (set in Cloudflare, never in client code)
npx wrangler secret put TOKEN_SECRET            # openssl rand -base64 48
npx wrangler secret put SUPER_ADMIN_PASSPHRASE  # e.g. your super admin passphrase
npx wrangler secret put ADMIN_PASSPHRASE        # e.g. your admin passphrase

# Run local development server
npm run dev           # local, http://localhost:8787

# Deploy to Cloudflare
npm run deploy        # live at https://sas-player.<you>.workers.dev
```

## Connecting Frontend to Worker

The frontend automatically detects:
- `http://localhost:8787` when running on localhost or 127.0.0.1
- Your deployed Worker endpoint configured via the UI's **"Worker"** button in the top navigation bar or via `localStorage.setItem('sas_worker_api', 'https://sas-player.<you>.workers.dev')`

Push to the `sasprojects-lab.github.io` repo as usual. Site stays at the same
bookmarked URL; every request it makes connects directly to the Worker in the background.

No domain purchase, no hosting bill, no card on file — GitHub Pages and the
Workers Free plan are both free.

## What moved where

| Old (browser) | New | Why |
|---|---|---|
| `hashPassphrase()` + constant compare | `POST /api/elevate`, secret in Cloudflare | Client has nothing to bypass |
| `localStorage.setItem('sas_user_role', …)` | DO device registry | Writing localStorage grants nothing |
| `isSuperAdmin` boolean guards | `PERMS` check per message in the DO | Flipping a local boolean is inert |
| `addedByName` from client payload | Server writes it from the signed token | **Forged Activity Radar names are gone** |
| Direct RTDB writes | Intents over WebSocket | No client-writable datastore exists |
| Public `databaseURL` | Nothing public but the page itself | No open write surface |

## The security model in one paragraph

A device gets an `HttpOnly` cookie holding an HMAC-signed token that says only
*who* it is. JavaScript on the page cannot read or edit that cookie. The token
carries no role. Every WebSocket message is re-checked against the Durable
Object's own device registry, so authority is decided once, server-side, on
every single action. Forging a role means forging an HMAC-SHA256 signature
without the key — which is not a thing anyone is doing.

## Things still worth doing

- **Lock or delete the old Firebase RTDB today.** It is openly writable right now.
- **Rotate the passphrases.** Anyone who read the old bundle may have context on them.
- Add Cloudflare Turnstile (free) to `/api/session` if the link ever goes public,
  so a bot can't flood your device list.
- Rate-limit `/api/elevate` per IP with a small DO or KV counter. The 400 ms
  delay in the code is a damper, not a defence.
- `sas_token` sits in `localStorage`, readable by any script running on your
  page. That's fine against the forgery bug you started with, but if you ever
  add a third-party widget or ad script to `index.html`, treat that as a
  possible leak path for the token — same as any other localStorage secret.

## Why not just proxy github.io through the Worker?

You could put the Worker in front of Pages (fetch the Pages HTML, pass it
through) to get a single origin and go back to `HttpOnly` cookies. It's more
moving parts for not much gain here — bearer-token auth backed by an
HMAC-signed, identity-only token is solid, and it's fifteen extra lines
versus rearchitecting where the HTML is served from. Worth revisiting only if
you outgrow GitHub Pages for other reasons.

## Free-tier headroom

Durable Objects run on the Workers Free plan with roughly 3M requests/month, and
incoming WebSocket messages bill at 20:1 (outgoing messages and protocol pings
are free). The host `tick` at 2/sec is the heaviest traffic: about 5.2M incoming
messages a month, which counts as ~260K requests. Comfortably inside the tier.
Drop to 1/sec if you want more room.
