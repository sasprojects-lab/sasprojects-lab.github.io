import type { Env } from "./index";

/* ------------------------------------------------------------------ *
 * One Durable Object = one room = the single source of truth.
 * Clients never write state. They send intents; this object decides.
 * ------------------------------------------------------------------ */

export type Role = "super_admin" | "admin" | "guest" | "pending";
export type DeviceStatus = "approved" | "pending" | "revoked" | "guest";

export interface Device {
  deviceId: string;
  name: string;
  role: Role;
  status: DeviceStatus;
  lastSeen: number;
}

export interface Track {
  id: string;            // YouTube video id
  title: string;
  addedById: string;
  addedByName: string;   // written by the server, from the verified token
  isPinned: boolean;
}

export interface NowPlaying {
  index: number;
  videoId: string | null;
  isPlaying: boolean;
  positionSec: number;
  durationSec?: number;
  updatedAt: number;     // server clock, lets late joiners seek correctly
  volume: number;
}

export interface ActivityEvent {
  id: string;
  type: string;
  actorName: string;     // SERVER-SET. Authenticated fix for forged names.
  detail: string;
  at: number;
}

export interface RoomState {
  devices: Record<string, Device>;
  queue: Track[];
  nowPlaying: NowPlaying;
  activity: ActivityEvent[];
}

const DEFAULT_TRACKS: Track[] = [
  { id: 'byitAI7kkOM', title: 'Armaan Malik - Dil Mein Ho Tum', addedById: 'system', addedByName: 'Super Admin', isPinned: false },
  { id: 'W1y8blwMLxY', title: 'Jubin Nautiyal - Barbaad', addedById: 'system', addedByName: 'Rahul (iPhone)', isPinned: false },
  { id: '2FPTVYj3ouE', title: 'Khaali Salam Dua', addedById: 'system', addedByName: 'Super Admin', isPinned: false },
  { id: 'ia5CdcuqSWk', title: 'Terre Pyaar Mein', addedById: 'system', addedByName: 'Guest DJ', isPinned: false },
  { id: 'BvPNWCzQMec', title: 'Bekhudi', addedById: 'system', addedByName: 'Super Admin', isPinned: false },
  { id: 'kKljXVVkgS4', title: 'Sanam Teri kasam', addedById: 'system', addedByName: 'Super Admin', isPinned: false },
  { id: 'ztPa6vkM-yY', title: 'Guzarish', addedById: 'system', addedByName: 'Super Admin', isPinned: false },
  { id: 'u4wmmGrI4pE', title: 'Chaand Jaise Mukhde Pe Bindiya Sitara', addedById: 'system', addedByName: 'Super Admin', isPinned: false },
  { id: 'TqR_jWfHW4g', title: 'Humnava', addedById: 'system', addedByName: 'Super Admin', isPinned: false },
  { id: 'ayzN5Il56co', title: 'Chori Chori Yun Jab Ho', addedById: 'system', addedByName: 'Super Admin', isPinned: false },
  { id: 'R7spJ7YjNOY', title: 'Love Letter', addedById: 'system', addedByName: 'Super Admin', isPinned: false },
  { id: '1a--6kZ8LCY', title: 'Hug Me', addedById: 'system', addedByName: 'Super Admin', isPinned: false },
  { id: 'AbkEmIgJMcU', title: 'Pal Pal', addedById: 'system', addedByName: 'Super Admin', isPinned: false },
  { id: 'wCTmWy43HgM', title: 'Haseen', addedById: 'system', addedByName: 'Super Admin', isPinned: false },
  { id: 'QRwLbf3PwO8', title: 'Qayade Se', addedById: 'system', addedByName: 'Super Admin', isPinned: false },
  { id: 'yHJf8MSPHk0', title: 'Baatein ye Kabhi na', addedById: 'system', addedByName: 'Super Admin', isPinned: false }
];

const INITIAL_STATE: RoomState = {
  devices: {},
  queue: structuredClone(DEFAULT_TRACKS),
  nowPlaying: {
    index: 0,
    videoId: DEFAULT_TRACKS[0].id,
    isPlaying: false,
    positionSec: 0,
    durationSec: 0,
    updatedAt: 0,
    volume: 100
  },
  activity: [
    {
      id: "init-event",
      type: "info",
      actorName: "System",
      detail: "SAS Master Acoustic Engine initialized",
      at: Date.now()
    }
  ],
};

/* What each role may do. Everything not listed is denied. */
const PERMS: Record<Role, Set<string>> = {
  super_admin: new Set(["transport", "queue", "add", "moderate", "host"]),
  admin:       new Set(["transport", "queue", "add"]),
  guest:       new Set(["add"]),
  pending:     new Set([]),
};

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export class Room {
  private state!: RoomState;

  constructor(private ctx: DurableObjectState, private env: Env) {
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<RoomState>("state");
      if (stored && Array.isArray(stored.queue) && stored.queue.length > 0) {
        this.state = stored;
        if (this.state.devices) {
          for (const d of Object.values(this.state.devices)) {
            if (!d.status) {
              d.status = d.role === "super_admin" ? "approved" : (d.role === "admin" ? "approved" : (d.role === "pending" ? "pending" : "guest"));
            }
          }
        }
      } else {
        this.state = structuredClone(INITIAL_STATE);
        await ctx.storage.put("state", this.state);
      }
    });
  }

  private async save() {
    await this.ctx.storage.put("state", this.state);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    /* Called only by the Worker, never reachable directly from the internet. */
    if (url.pathname === "/internal/set-role") {
      const { deviceId, name, role } = await request.json<{ deviceId: string; name: string; role: Role }>();
      const existing = this.state.devices[deviceId];

      // Exactly one super admin: demote whoever held it.
      if (role === "super_admin") {
        for (const d of Object.values(this.state.devices)) {
          if (d.role === "super_admin" && d.deviceId !== deviceId) {
            d.role = "admin";
            d.status = "approved";
          }
        }
      }
      this.state.devices[deviceId] = {
        deviceId,
        name,
        role,
        status: "approved",
        lastSeen: existing?.lastSeen ?? Date.now(),
      };
      this.log("admin", name, `became ${role.replace("_", " ")}`);
      await this.save();
      this.broadcastState();
      return new Response("ok");
    }

    if (url.pathname === "/ws") {
      const identHeader = request.headers.get("X-Identity");
      if (!identHeader) {
        return new Response("Missing identity", { status: 400 });
      }
      const ident = JSON.parse(identHeader) as { sub: string; name: string };

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // Hibernation API: the object can sleep while sockets stay open
      this.ctx.acceptWebSocket(server, [ident.sub]);
      server.serializeAttachment(ident);

      // Only registered devices update their lastSeen and name
      if (this.state.devices[ident.sub]) {
        this.state.devices[ident.sub].lastSeen = Date.now();
        // Update display name if user changed it
        if (ident.name) this.state.devices[ident.sub].name = ident.name;
        await this.save();
      }

      server.send(JSON.stringify({ t: "state", ...this.snapshotFor(ident.sub) }));
      if (this.isAuthorized(ident.sub)) {
        this.broadcastState();
      }

      // Browsers require the server to echo back the subprotocol it
      // accepted ("sas.v1") or the client-side WebSocket throws
      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: { "Sec-WebSocket-Protocol": "sas.v1" },
      });
    }

    return new Response("not found", { status: 404 });
  }

  /* ---------------- message handling ---------------- */

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string") return;

    const ident = ws.deserializeAttachment() as { sub: string; name: string } | null;
    if (!ident) return;

    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }

    // Explicit access request from a guest device
    if (msg.t === "requestAccess") {
      const existing = this.state.devices[ident.sub];
      // Prevent flood: if already pending, do not re-log or re-save repeatedly
      if (existing?.status === "pending") {
        return;
      }

      let devName = (String(msg.name || ident.name || "Guest")).replace(/[\x00-\x1F\x7F<>]/g, "").trim().slice(0, 40) || "Guest";
      if (/^(super\s*admin|admin|host(\s*master)?|station|system)\b/i.test(devName)) {
        devName = `Guest (${devName.slice(0, 25)})`;
      }

      this.state.devices[ident.sub] = {
        deviceId: ident.sub,
        name: devName,
        role: "pending",
        status: "pending",
        lastSeen: Date.now(),
      };
      this.log("admin", devName, "Requested admin access");
      await this.save();
      this.broadcastState();
      return;
    }

    const me = this.state.devices[ident.sub];
    // Guests or unauthorized devices cannot execute room commands
    if (!me || !this.isAuthorized(ident.sub)) return;

    const can = (perm: string) => PERMS[me.role]?.has(perm) ?? false;
    const deny = () => ws.send(JSON.stringify({ t: "denied", action: msg.t }));

    me.lastSeen = Date.now();

    switch (msg.t) {

      /* ---- transport: admin + super admin ---- */
      case "play":
      case "pause": {
        if (!can("transport")) return deny();
        const shouldPlay = msg.t === "play";
        if (shouldPlay && this.state.nowPlaying.index === -1 && this.state.queue.length > 0) {
          this.setTrack(0, me.name, "Play");
        } else {
          this.state.nowPlaying.isPlaying = shouldPlay;
          this.state.nowPlaying.updatedAt = Date.now();
        }
        this.log(msg.t, me.name, shouldPlay ? "Play" : "Pause");
        break;
      }

      case "seek": {
        if (!can("transport")) return deny();
        const pos = Number(msg.positionSec);
        if (!Number.isFinite(pos) || pos < 0) return deny();
        this.state.nowPlaying.positionSec = pos;
        this.state.nowPlaying.updatedAt = Date.now();
        break;
      }

      case "volume": {
        if (!can("transport")) return deny();
        const v = Number(msg.value);
        if (!Number.isFinite(v)) return deny();
        const newVol = Math.min(100, Math.max(0, Math.round(v)));
        this.state.nowPlaying.volume = newVol;

        // Consolidate volume logs: if this user recently adjusted volume (< 5s),
        // update the existing entry in-place instead of creating a new log for each tick.
        const recentVolLog = this.state.activity.find(
          (a) => a.type === "volume" && a.actorName === me.name && (Date.now() - a.at < 5000)
        );
        if (recentVolLog) {
          recentVolLog.detail = `Set master volume to ${newVol}%`;
          recentVolLog.at = Date.now();
          const idx = this.state.activity.indexOf(recentVolLog);
          if (idx > 0) {
            this.state.activity.splice(idx, 1);
            this.state.activity.unshift(recentVolLog);
          }
        } else {
          this.log("volume", me.name, `Set master volume to ${newVol}%`);
        }
        break;
      }

      case "goto": {
        if (!can("transport")) return deny();
        const i = Number(msg.index);
        if (!Number.isInteger(i) || i < 0 || i >= this.state.queue.length) return deny();
        this.setTrack(i, me.name, "Selected Track");
        break;
      }

      case "next":
      case "prev": {
        if (!can("transport")) return deny();
        if (this.state.queue.length === 0) return;
        const isNext = msg.t === "next";
        const step = isNext ? 1 : -1;
        const len = this.state.queue.length;
        const nextIdx = (this.state.nowPlaying.index + step + len) % len;
        this.setTrack(nextIdx, me.name, isNext ? "Next Track" : "Previous Track");
        break;
      }

      /* ---- host heartbeat: only the super admin's real player ---- */
      case "tick": {
        if (!can("host")) return;                     // silent: high frequency
        const pos = Number(msg.positionSec);
        if (Number.isFinite(pos)) {
          this.state.nowPlaying.positionSec = pos;
          this.state.nowPlaying.updatedAt = Date.now();
        }
        const dur = Number(msg.durationSec);
        if (Number.isFinite(dur) && dur > 0) {
          this.state.nowPlaying.durationSec = dur;
        }
        this.broadcast({
          t: "tick",
          positionSec: this.state.nowPlaying.positionSec,
          durationSec: this.state.nowPlaying.durationSec || 0,
          at: Date.now()
        }, /* onlyAuthorized= */ true);
        return;                                       // don't persist storage on every tick
      }

      /* ---- queue edits ---- */
      case "addTrack": {
        if (!can("add")) return deny();
        const id = String(msg.videoId ?? "").trim();
        if (!VIDEO_ID.test(id)) return deny();
        if (this.state.queue.length >= 300) return deny();

        const wasEmpty = this.state.queue.length === 0;
        const title = String(msg.title ?? "YouTube Track").slice(0, 160);

        this.state.queue.push({
          id,
          title,
          addedById: me.deviceId,
          addedByName: me.name,     // server-set from verified identity
          isPinned: false,
        });

        this.log("add", me.name, `Added "${title}"`);

        if (wasEmpty || this.state.nowPlaying.index === -1) {
          this.setTrack(0, me.name, null);
        }
        break;
      }

      case "removeTrack": {
        if (!can("queue")) return deny();
        const i = Number(msg.index);
        if (!Number.isInteger(i) || i < 0 || i >= this.state.queue.length) return deny();
        const [gone] = this.state.queue.splice(i, 1);

        if (this.state.queue.length === 0) {
          this.state.nowPlaying.index = -1;
          this.state.nowPlaying.videoId = null;
          this.state.nowPlaying.isPlaying = false;
        } else if (i === this.state.nowPlaying.index) {
          const nextIdx = Math.min(i, this.state.queue.length - 1);
          this.setTrack(nextIdx, me.name, null);
        } else if (i < this.state.nowPlaying.index) {
          this.state.nowPlaying.index--;
        }

        this.log("clear", me.name, `Removed "${gone.title}"`);
        break;
      }

      case "pin": {
        if (!can("queue")) return deny();
        const i = Number(msg.index);
        if (!Number.isInteger(i) || i < 0 || i >= this.state.queue.length) return deny();
        this.state.queue[i].isPinned = !this.state.queue[i].isPinned;
        const status = this.state.queue[i].isPinned ? "Pinned" : "Unpinned";
        this.log("pin", me.name, `${status} "${this.state.queue[i].title}"`);
        break;
      }

      case "clearQueue": {
        if (!can("queue")) return deny();
        this.state.queue = [];
        this.state.nowPlaying = {
          index: -1,
          videoId: null,
          isPlaying: false,
          positionSec: 0,
          durationSec: 0,
          updatedAt: Date.now(),
          volume: this.state.nowPlaying.volume,
        };
        this.log("clear", me.name, "Cleared master queue");
        break;
      }

      case "loadDefaultQueue": {
        if (!can("queue")) return deny();
        this.state.queue = structuredClone(DEFAULT_TRACKS);
        this.setTrack(0, me.name, null);
        this.log("add", me.name, "Restored default studio playlist");
        break;
      }

      /* ---- moderation: super admin only ---- */
      case "setDeviceRole": {
        if (!can("moderate")) return deny();
        const target = this.state.devices[String(msg.deviceId)];
        const role = String(msg.role) as Role;
        const status = (msg.status ? String(msg.status) : (role === "admin" ? "approved" : (role === "pending" ? "pending" : "guest"))) as DeviceStatus;
        if (!target) return deny();
        if (role !== "admin" && role !== "guest" && role !== "pending") return deny();
        if (target.role === "super_admin") return deny();

        const oldRole = target.role;
        const oldStatus = target.status;
        target.role = role;
        target.status = status;

        if (oldRole !== "admin" && role === "admin") {
          this.log("admin", me.name, `Approved ${target.name} as Admin`);
        } else if (oldRole === "admin" && role === "guest") {
          this.log("admin", me.name, `Demoted ${target.name} to Guest`);
        } else if (role === "admin" && status === "revoked" && oldStatus !== "revoked") {
          this.log("admin", me.name, `Revoked controls for Admin ${target.name}`);
        } else if (role === "admin" && status === "approved" && oldStatus === "revoked") {
          this.log("admin", me.name, `Restored controls for Admin ${target.name}`);
        } else {
          this.log("admin", me.name, `Updated ${target.name} to ${role} (${status})`);
        }
        break;
      }

      case "removeDevice": {
        if (!can("moderate")) return deny();
        const target = this.state.devices[String(msg.deviceId)];
        if (!target || target.role === "super_admin") return deny();
        delete this.state.devices[target.deviceId];
        this.log("admin", me.name, `Removed device ${target.name}`);
        break;
      }

      default:
        return;
    }

    await this.save();
    this.broadcastState();
  }

  async webSocketClose(ws: WebSocket) {
    const ident = ws.deserializeAttachment() as { sub: string } | null;
    if (ident && this.state.devices[ident.sub]) {
      this.state.devices[ident.sub].lastSeen = Date.now();

      // If Super Admin disconnected, check if another active Super Admin connection exists
      if (this.state.devices[ident.sub].role === "super_admin") {
        const remainingSockets = this.ctx.getWebSockets();
        let hasActiveSuperAdmin = false;
        for (const s of remainingSockets) {
          if (s !== ws) {
            const att = s.deserializeAttachment() as { sub: string } | null;
            if (att && this.state.devices[att.sub]?.role === "super_admin") {
              hasActiveSuperAdmin = true;
              break;
            }
          }
        }
        if (!hasActiveSuperAdmin && this.state.nowPlaying.isPlaying) {
          this.state.nowPlaying.isPlaying = false;
          this.state.nowPlaying.updatedAt = Date.now();
          this.log("pause", this.state.devices[ident.sub].name, "Host disconnected — playback paused");
        }
      }

      await this.save();
      this.broadcastState();
    }
  }

  /* ---------------- helpers ---------------- */

  private isStudioMember(deviceId: string): boolean {
    const dev = this.state.devices[deviceId];
    return !!dev && (dev.role === "super_admin" || dev.role === "admin");
  }

  private isAuthorized(deviceId: string): boolean {
    const dev = this.state.devices[deviceId];
    if (!dev) return false;
    if (dev.role === "super_admin") return true;
    if (dev.role === "admin") {
      return dev.status !== "revoked";
    }
    return false;
  }

  private setTrack(index: number, actorName: string, eventName?: string | null) {
    const track = this.state.queue[index];
    this.state.nowPlaying = {
      ...this.state.nowPlaying,
      index,
      videoId: track?.id ?? null,
      positionSec: 0,
      durationSec: 0,
      isPlaying: true,
      updatedAt: Date.now(),
    };
    if (track && eventName !== null) {
      const label = eventName || "Play";
      const evType = (label === "Next Track" || label === "Previous Track") ? "skip" : "play";
      this.log(evType, actorName, label);
    }
  }

  private currentTitle() {
    return this.state.queue[this.state.nowPlaying.index]?.title ?? "";
  }

  private log(type: string, actorName: string, detail: string) {
    this.state.activity.unshift({
      id: crypto.randomUUID(),
      type,
      actorName,        // server-verified name
      detail: detail.slice(0, 160),
      at: Date.now(),
    });
    this.state.activity = this.state.activity.slice(0, 40);
  }

  private snapshotFor(deviceId: string) {
    const dev = this.state.devices[deviceId];
    const isMember = this.isStudioMember(deviceId);

    // Guests or unauthorized devices receive an isolated, empty room view
    // so they do not see studio tracks, fleets, or private activities.
    if (!isMember) {
      return {
        you: dev ?? {
          deviceId,
          name: "Guest",
          role: "guest" as Role,
          status: "guest" as DeviceStatus,
          lastSeen: Date.now(),
        },
        devices: [],
        queue: [],
        nowPlaying: null,
        activity: [],
        serverTime: Date.now(),
      };
    }

    return {
      you: dev,
      devices: Object.values(this.state.devices).sort((a, b) => b.lastSeen - a.lastSeen),
      queue: this.state.queue,
      nowPlaying: this.state.nowPlaying,
      activity: this.state.activity,
      serverTime: Date.now(),
    };
  }

  private broadcast(payload: unknown, onlyAuthorized = false) {
    const body = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      if (onlyAuthorized) {
        const ident = ws.deserializeAttachment() as { sub: string } | null;
        if (!ident || !this.isStudioMember(ident.sub)) continue;
      }
      try { ws.send(body); } catch { /* ignore disconnected */ }
    }
  }

  private broadcastState() {
    for (const ws of this.ctx.getWebSockets()) {
      const ident = ws.deserializeAttachment() as { sub: string } | null;
      if (!ident) continue;
      try {
        ws.send(JSON.stringify({ t: "state", ...this.snapshotFor(ident.sub) }));
      } catch { /* ignore */ }
    }
  }
}

