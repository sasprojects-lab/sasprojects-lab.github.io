/* ------------------------------------------------------------------ *
 * SAS realtime client — Cloudflare Workers + Durable Objects engine
 * ------------------------------------------------------------------ */

const SAS = (() => {
  let ws = null;
  let backoff = 1000;
  let reconnectTimer = null;
  let serverSkew = 0;               // serverTime - clientTime
  let token = localStorage.getItem("sas_token") || null;
  let isIntentionalClose = false;

  const handlers = {
    state: [],
    tick: [],
    denied: [],
    status: []
  };

  let latest = {
    you: null,
    devices: [],
    queue: [],
    nowPlaying: { index: -1, videoId: null, isPlaying: false, positionSec: 0, updatedAt: 0, volume: 100 },
    activity: [],
    serverTime: Date.now()
  };

  function getWorkerApi() {
    if (window.SAS_API) return window.SAS_API.replace(/\/+$/, "");
    const custom = localStorage.getItem("sas_worker_api");
    if (custom) return custom.replace(/\/+$/, "");
    return "https://sas-player.sasprojects.workers.dev";
  }

  function setWorkerApi(url) {
    if (!url) {
      localStorage.removeItem("sas_worker_api");
    } else {
      localStorage.setItem("sas_worker_api", url.trim().replace(/\/+$/, ""));
    }
    // Reconnect on api endpoint change
    if (ws) {
      disconnect();
      setTimeout(connect, 300);
    }
  }

  const emit = (evt, data) => handlers[evt]?.forEach(fn => {
    try { fn(data); } catch (err) { console.error(`[SAS ${evt} handler error]:`, err); }
  });

  const on = (evt, fn) => {
    if (handlers[evt] && typeof fn === 'function') {
      handlers[evt].push(fn);
    }
    return SAS;
  };

  const off = (evt, fn) => {
    if (handlers[evt]) {
      handlers[evt] = handlers[evt].filter(f => f !== fn);
    }
    return SAS;
  };

  /* --- session: establishes cryptographic device identity ---------- */
  async function ensureSession(name) {
    const api = getWorkerApi();
    try {
      const res = await fetch(`${api}/api/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name: name ?? null }),
      });
      if (!res.ok) {
        // If old/stale token was rejected, clear and retry once
        if (token) {
          token = null;
          localStorage.removeItem("sas_token");
          return ensureSession(name);
        }
        throw new Error(`Session request returned ${res.status}`);
      }
      const data = await res.json();     // { deviceId, name, token }
      token = data.token;
      localStorage.setItem("sas_token", token);
      return data;
    } catch (err) {
      console.warn("[SAS] ensureSession failed:", err.message);
      throw err;
    }
  }

  /* --- elevation: verifies passphrase server-side ------------------ */
  async function elevate(passphrase) {
    const api = getWorkerApi();
    try {
      if (!token) {
        await ensureSession();
      }
      const res = await fetch(`${api}/api/elevate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ passphrase }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        return { ok: false, status: res.status, error: errData.error || `HTTP ${res.status}` };
      }
      const data = await res.json();
      return { ok: true, role: data.role };
    } catch (err) {
      console.error("[SAS] elevate error:", err);
      return { ok: false, error: err.message };
    }
  }

  function connect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (!token) {
      console.warn("[SAS] connect() called without token, obtaining session first...");
      ensureSession().then(() => connect()).catch(err => {
        emit("status", "error");
        scheduleReconnect();
      });
      return;
    }

    isIntentionalClose = false;
    const api = getWorkerApi();
    const wsUrl = api.replace(/^http/, "ws");

    try {
      // Subprotocol array: ["sas.v1", token]
      ws = new WebSocket(`${wsUrl}/api/ws`, ["sas.v1", token]);

      ws.onopen = () => {
        backoff = 1000;
        emit("status", "connected");
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.t === "state") {
            serverSkew = (msg.serverTime || Date.now()) - Date.now();
            latest = msg;
            emit("state", msg);
          } else if (msg.t === "tick") {
            emit("tick", msg);
          } else if (msg.t === "denied") {
            emit("denied", msg.action);
          }
        } catch (err) {
          console.error("[SAS] Failed to parse message:", err);
        }
      };

      ws.onclose = () => {
        emit("status", "reconnecting");
        if (!isIntentionalClose) {
          scheduleReconnect();
        }
      };

      ws.onerror = (e) => {
        console.warn("[SAS] WebSocket error:", e);
        try { ws.close(); } catch (_) {}
      };
    } catch (err) {
      console.error("[SAS] WebSocket connection attempt threw:", err);
      emit("status", "error");
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, backoff);
    backoff = Math.min(backoff * 1.5, 12000);
  }

  function disconnect() {
    isIntentionalClose = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      try { ws.close(); } catch (_) {}
      ws = null;
    }
    emit("status", "disconnected");
  }

  const send = (t, payload = {}) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t, ...payload }));
      return true;
    } else {
      console.warn(`[SAS] Cannot send "${t}" — WebSocket not connected (readyState: ${ws ? ws.readyState : 'null'})`);
      return false;
    }
  };

  /* Where a client should project playback position right now */
  const projectedPosition = () => {
    const np = latest.nowPlaying;
    if (!np) return 0;
    if (!np.isPlaying) return np.positionSec || 0;
    const elapsedSec = (Date.now() + serverSkew - (np.updatedAt || Date.now())) / 1000;
    return Math.max(0, (np.positionSec || 0) + (elapsedSec > 0 && elapsedSec < 7200 ? elapsedSec : 0));
  };

  const role = () => latest.you?.role ?? "pending";
  const isHost = () => role() === "super_admin";
  const canControl = () => ["super_admin", "admin"].includes(role());

  return {
    ensureSession,
    elevate,
    connect,
    disconnect,
    on,
    off,
    send,
    role,
    isHost,
    canControl,
    projectedPosition,
    getWorkerApi,
    setWorkerApi,
    get state() { return latest; },

    // Intent dispatchers
    play:             () => send("play"),
    pause:            () => send("pause"),
    next:             () => send("next"),
    prev:             () => send("prev"),
    goto:             (index) => send("goto", { index }),
    seek:             (positionSec) => send("seek", { positionSec }),
    setVolume:        (value) => send("volume", { value }),
    addTrack:         (videoId, title) => send("addTrack", { videoId, title }),
    removeTrack:      (index) => send("removeTrack", { index }),
    togglePin:        (index) => send("pin", { index }),
    clearQueue:       () => send("clearQueue"),
    loadDefaultQueue: () => send("loadDefaultQueue"),
    setDeviceRole:    (deviceId, role, status) => send("setDeviceRole", { deviceId, role, status }),
    removeDevice:     (deviceId) => send("removeDevice", { deviceId }),
    requestAccess:    (name) => send("requestAccess", { name }),
    hostTick:         (positionSec, durationSec = 0) => send("tick", { positionSec, durationSec }),
  };
})();
