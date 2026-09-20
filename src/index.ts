export { Room } from "./room";

export interface Env {
  ROOM: DurableObjectNamespace;
  ASSETS?: Fetcher;
  TOKEN_SECRET: string;
  SUPER_ADMIN_PASSPHRASE: string;
  ADMIN_PASSPHRASE: string;
}

/* ------------------------------------------------------------------ *
 * JWT (HMAC-SHA256). Secret lives in Cloudflare secret store.
 * Payload holds IDENTITY ONLY — no roles.
 * ------------------------------------------------------------------ */

export interface Identity {
  sub: string;   // stable device id
  name: string;  // display name
  exp: number;   // unix seconds
}

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlDecode = (s: string) => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  return atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
};

async function key(secret: string) {
  return crypto.subtle.importKey(
    "raw", enc.encode(secret || "sas_default_insecure_dev_secret_replace_me"),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign", "verify"],
  );
}

export async function signToken(payload: Identity, secret: string) {
  const head = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const data = `${head}.${body}`;
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(data));
  return `${data}.${b64url(sig)}`;
}

export async function verifyToken(token: string, secret: string): Promise<Identity | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const sigBytes = Uint8Array.from(b64urlDecode(parts[2]), c => c.charCodeAt(0));
  const ok = await crypto.subtle.verify("HMAC", await key(secret), sigBytes, enc.encode(data));
  if (!ok) return null;                                  // forged or tampered
  try {
    const payload = JSON.parse(b64urlDecode(parts[1])) as Identity;
    if (!payload.sub || !payload.name) return null;
    if (payload.exp * 1000 < Date.now()) return null;    // expired
    return payload;
  } catch { return null; }
}

/* Constant-time compare so passphrase checking cannot be timed. */
function safeEqual(a: string, b: string) {
  const ab = enc.encode(a), bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true; // Direct non-browser requests
  if (origin === "https://sasprojects-lab.github.io") return true;
  // Allow local development (XAMPP localhost, vite, dev servers)
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

function corsHeaders(origin: string | null) {
  const allow = isOriginAllowed(origin) && origin ? origin : "https://sasprojects-lab.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();

  // WebSocket upgrades can't carry custom headers from the browser, so
  // token rides in Sec-WebSocket-Protocol: ["sas.v1", token]
  const proto = request.headers.get("Sec-WebSocket-Protocol");
  if (proto) {
    const parts = proto.split(",").map(p => p.trim());
    if (parts[0] === "sas.v1" && parts[1]) return parts[1];
  }
  return null;
}

/* Rate limiting map for passphrase brute-force prevention */
const elevateAttempts = new Map<string, { count: number; lockedUntil: number }>();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    // Health check / info endpoint
    if (url.pathname === "/api/health" || url.pathname === "/health") {
      return json({ status: "ok", service: "sas-player-api", time: Date.now() }, { headers: cors });
    }

    if (!url.pathname.startsWith("/api/")) {
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }
      return new Response("SAS Player Cloudflare Worker API is active.", {
        status: 200,
        headers: { "Content-Type": "text/plain", ...cors },
      });
    }

    // Origin check
    if (origin && !isOriginAllowed(origin)) {
      return json({ error: "origin_not_allowed" }, { status: 403, headers: cors });
    }

    const raw = bearerToken(request);
    const secret = env.TOKEN_SECRET || "sas_default_insecure_dev_secret_replace_me";
    const identity = raw ? await verifyToken(raw, secret) : null;

    /* --- Create or refresh a session ------------------------------- */
    if (url.pathname === "/api/session" && request.method === "POST") {
      const { name } = await request.json<{ name?: string }>().catch(() => ({ name: undefined }));

      const sub = identity?.sub ?? crypto.randomUUID();
      let display = (name ?? identity?.name ?? "Guest Device").toString().trim();
      
      // Strip control characters and HTML tags
      display = display.replace(/[\x00-\x1F\x7F<>]/g, "").trim().slice(0, 40) || "Guest Device";

      // Prevent unauthenticated guests from claiming reserved privileged names
      if (/^(super\s*admin|admin|host(\s*master)?|station|system|moderator)\b/i.test(display)) {
        display = `Guest (${display.slice(0, 25)})`;
      }

      const token = await signToken(
        { sub, name: display, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 },
        secret,
      );
      return json({ deviceId: sub, name: display, token }, { headers: cors });
    }

    if (!identity) {
      return json({ error: "no_session" }, { status: 401, headers: cors });
    }

    /* --- Elevate to admin / super admin ---------------------------- */
    if (url.pathname === "/api/elevate" && request.method === "POST") {
      const clientIp = request.headers.get("CF-Connecting-IP") || identity.sub;
      const record = elevateAttempts.get(clientIp);
      const now = Date.now();

      if (record && record.lockedUntil > now) {
        const waitSec = Math.ceil((record.lockedUntil - now) / 1000);
        return json(
          { error: "rate_limited", message: `Too many failed attempts. Try again in ${waitSec}s.` },
          { status: 429, headers: cors }
        );
      }

      const { passphrase } = await request.json<{ passphrase?: string }>().catch(() => ({ passphrase: "" }));
      const p = (passphrase ?? "").trim();

      let role: string | null = null;
      const superSecret = env.SUPER_ADMIN_PASSPHRASE;
      const adminSecret = env.ADMIN_PASSPHRASE;

      if (!superSecret && !adminSecret) {
        return json({ error: "passphrases_not_configured" }, { status: 500, headers: cors });
      }

      if (superSecret && safeEqual(p, superSecret)) {
        role = "super_admin";
      } else if (adminSecret && safeEqual(p, adminSecret)) {
        role = "admin";
      }

      if (!role) {
        const count = (record?.count ?? 0) + 1;
        const lockedUntil = count >= 5 ? now + 10 * 60 * 1000 : 0; // 10 minute lockout after 5 failures
        elevateAttempts.set(clientIp, { count, lockedUntil });

        await new Promise(r => setTimeout(r, 600));   // brute-force dampener
        return json({ error: "invalid_passphrase" }, { status: 403, headers: cors });
      }

      // Successful elevation — clear attempt count
      elevateAttempts.delete(clientIp);

      const stub = env.ROOM.getByName("main");
      await stub.fetch("https://do/internal/set-role", {
        method: "POST",
        body: JSON.stringify({ deviceId: identity.sub, name: identity.name, role }),
      });
      return json({ role }, { headers: cors });
    }

    /* --- WebSocket upgrade ----------------------------------------- */
    if (url.pathname === "/api/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected websocket", { status: 426, headers: cors });
      }
      const stub = env.ROOM.getByName("main");
      return stub.fetch("https://do/ws", {
        headers: {
          Upgrade: "websocket",
          "X-Identity": JSON.stringify({ sub: identity.sub, name: identity.name }),
        },
      });
    }

    return json({ error: "not_found" }, { status: 404, headers: cors });
  },
} satisfies ExportedHandler<Env>;
