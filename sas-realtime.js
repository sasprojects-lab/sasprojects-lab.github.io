/* ------------------------------------------------------------------ *
 * SAS realtime client — Cloudflare Workers + Durable Objects engine
 * v4.3.0 — Hardened: tamper-proof closure, frozen state, no leaks
 * ------------------------------------------------------------------ */

const SAS = (() => {
  let _ws = null;
  let _backoff = 1000;
  let _reconnectTimer = null;
  let _serverSkew = 0;
  let _token = localStorage.getItem("sas_token") || null;
  let _intentionalClose = false;
  let _heartbeatTimer = null;
  let _connectAttemptsSinceSuccess = 0;
  let _currentRole = "pending";
  let _currentStatus = "guest";

  const _handlers = {
    state: [],
    tick: [],
    denied: [],
    status: []
  };

  let _latest = {
    you: null,
    devices: [],
    queue: [],
    nowPlaying: { index: -1, videoId: null, isPlaying: false, positionSec: 0, updatedAt: 0, volume: 100 },
    activity: [],
    serverTime: Date.now()
  };

  /* --- Security cleanup: purge any legacy/dangerous keys ---------- */
  (function _purgeInsecureKeys() {
    try {
      // CRITICAL: remove passphrase that was stored in previous versions
      localStorage.removeItem("sas_elev_cred");
      // Remove role hints and legacy role keys
      localStorage.removeItem("sas_role_hint");
      localStorage.removeItem("sas_user_role");
      // Legacy Firebase keys
      localStorage.removeItem("sas_player_cache");
      localStorage.removeItem("sas_device_status");
      localStorage.removeItem("sas_admin_pass");
    } catch (_) { }
  })();

  function _getWorkerApi() {
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
    if (_ws) {
      disconnect();
      setTimeout(connect, 300);
    }
  }

  const _emit = (evt, data) => _handlers[evt]?.forEach(fn => {
    try { fn(data); } catch (_) { /* swallow handler errors silently */ }
  });

  const on = (evt, fn) => {
    if (_handlers[evt] && typeof fn === 'function') {
      _handlers[evt].push(fn);
    }
    return api;
  };

  const off = (evt, fn) => {
    if (_handlers[evt]) {
      _handlers[evt] = _handlers[evt].filter(f => f !== fn);
    }
    return api;
  };

  /* --- session: establishes cryptographic device identity ---------- */
  async function ensureSession(name) {
    const endpoint = _getWorkerApi();
    try {
      const res = await fetch(`${endpoint}/api/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(_token ? { Authorization: `Bearer ${_token}` } : {}),
        },
        body: JSON.stringify({ name: name ?? null }),
      });
      if (!res.ok) {
        if (_token) {
          _token = null;
          localStorage.removeItem("sas_token");
          return ensureSession(name);
        }
        throw new Error("Session request failed");
      }
      const data = await res.json();
      _token = data.token;
      localStorage.setItem("sas_token", _token);
      return data;
    } catch (err) {
      throw err;
    }
  }

  /* --- elevation: verifies passphrase server-side ------------------
   * The passphrase is sent ONCE over HTTPS, verified by the Worker,
   * and NEVER stored client-side. The role is persisted server-side
   * in the Durable Object state. On reconnect, the DO remembers
   * the device's role via the JWT-identified deviceId.
   * ---------------------------------------------------------------- */
  async function elevate(passphrase) {
    const endpoint = _getWorkerApi();
    try {
      if (!_token) {
        await ensureSession();
      }
      const res = await fetch(`${endpoint}/api/elevate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${_token}`,
        },
        body: JSON.stringify({ passphrase }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        return { ok: false, status: res.status, error: errData.error || "Authentication failed" };
      }
      const data = await res.json();
      if (data.role) {
        _currentRole = data.role;
        _currentStatus = "approved";
      }
      // Role is returned for UI update ONLY — never stored in localStorage
      return { ok: true, role: data.role };
    } catch (err) {
      return { ok: false, error: "Connection error" };
    }
  }

  /* --- Heartbeat keepalive ---------------------------------------- */
  function _startHeartbeat() {
    _stopHeartbeat();
    _heartbeatTimer = setInterval(() => {
      if (_ws && _ws.readyState === WebSocket.OPEN) {
        try {
          _ws.send(JSON.stringify({ t: "ping" }));
        } catch (_) { }
      }
    }, 15000); // 15 seconds: keeps socket alive even under browser timer throttling
  }

  function _stopHeartbeat() {
    if (_heartbeatTimer) {
      clearInterval(_heartbeatTimer);
      _heartbeatTimer = null;
    }
  }

  function connect() {
    if (_reconnectTimer) {
      clearTimeout(_reconnectTimer);
      _reconnectTimer = null;
    }
    if (!_token) {
      ensureSession().then(() => connect()).catch(() => {
        _emit("status", "error");
        _scheduleReconnect();
      });
      return;
    }

    _intentionalClose = false;
    _connectAttemptsSinceSuccess++;
    const endpoint = _getWorkerApi();
    const wsUrl = endpoint.replace(/^http/, "ws");

    try {
      _ws = new WebSocket(`${wsUrl}/api/ws`, ["sas.v1", _token]);

      _ws.onopen = () => {
        _backoff = 1000;
        _connectAttemptsSinceSuccess = 0;
        _startHeartbeat();
        _emit("status", "connected");
      };

      _ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.t === "state") {
            _serverSkew = (msg.serverTime || Date.now()) - Date.now();
            _latest = msg;
            if (msg.you) {
              _currentRole = msg.you.role || "guest";
              _currentStatus = msg.you.status || (msg.you.role === "admin" ? "approved" : (msg.you.role === "pending" ? "pending" : "guest"));
            }
            _emit("state", msg);
          } else if (msg.t === "tick") {
            _emit("tick", msg);
          } else if (msg.t === "denied") {
            _emit("denied", msg.action);
          }
          // pong and unknown message types are silently ignored
        } catch (_) { }
      };

      _ws.onclose = () => {
        _stopHeartbeat();
        _emit("status", "reconnecting");

        // Never clear _token on transient network / background drops.
        // The token is valid for 30 days and preserves device role identity.
        if (!_intentionalClose) {
          _scheduleReconnect();
        }
      };

      _ws.onerror = () => {
        try { _ws.close(); } catch (_) { }
      };
    } catch (_) {
      _emit("status", "error");
      _scheduleReconnect();
    }
  }

  function _scheduleReconnect() {
    if (_reconnectTimer) return;
    const jitter = Math.random() * 500;
    _reconnectTimer = setTimeout(() => {
      _reconnectTimer = null;
      connect();
    }, _backoff + jitter);
    _backoff = Math.min(_backoff * 1.5, 15000);
  }

  function disconnect() {
    _intentionalClose = true;
    _stopHeartbeat();
    if (_reconnectTimer) {
      clearTimeout(_reconnectTimer);
      _reconnectTimer = null;
    }
    if (_ws) {
      try { _ws.close(); } catch (_) { }
      _ws = null;
    }
    _emit("status", "disconnected");
  }

  const _send = (t, payload = {}) => {
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ t, ...payload }));
      return true;
    }
    return false;
  };

  const projectedPosition = () => {
    const np = _latest.nowPlaying;
    if (!np) return 0;
    if (!np.isPlaying) return np.positionSec || 0;
    const elapsedSec = (Date.now() + _serverSkew - (np.updatedAt || Date.now())) / 1000;
    return Math.max(0, (np.positionSec || 0) + (elapsedSec > 0 && elapsedSec < 7200 ? elapsedSec : 0));
  };

  const role = () => _currentRole;
  const status = () => _currentStatus;
  const isHost = () => _currentRole === "super_admin";
  const canControl = () => ["super_admin", "admin"].includes(_currentRole) && _currentStatus !== "revoked";

  /* --- Public API surface ----------------------------------------- *
   * IMPORTANT: Only expose methods that are safe for console access.  *
   * Internal state (_token, _ws, passphrase) stays in IIFE closure.  *
   * ---------------------------------------------------------------- */
  const api = {
    ensureSession,
    elevate,
    connect,
    disconnect,
    on,
    off,
    send: _send,
    role,
    status,
    isHost,
    canControl,
    projectedPosition,
    getWorkerApi: _getWorkerApi,
    setWorkerApi,
    get state() {
      try {
        return structuredClone(_latest);
      } catch (_) {
        return Object.freeze({ ..._latest });
      }
    },

    // Intent dispatchers — all validated server-side
    play: () => _send("play"),
    pause: () => _send("pause"),
    next: () => _send("next"),
    prev: () => _send("prev"),
    goto: (index) => _send("goto", { index }),
    seek: (positionSec) => _send("seek", { positionSec }),
    setVolume: (value) => _send("volume", { value }),
    addTrack: (videoId, title) => _send("addTrack", { videoId, title }),
    addTracks: (tracks) => _send("addTracks", { tracks }),
    removeTrack: (index) => _send("removeTrack", { index }),
    togglePin: (index) => _send("pin", { index }),
    clearQueue: () => _send("clearQueue"),
    loadDefaultQueue: () => _send("loadDefaultQueue"),
    setDeviceRole: (deviceId, role, status) => _send("setDeviceRole", { deviceId, role, status }),
    removeDevice: (deviceId) => _send("removeDevice", { deviceId }),
    requestAccess: (name) => _send("requestAccess", { name }),
    moveTrack: (fromIndex, toIndex) => _send("moveTrack", { fromIndex, toIndex }),
    hostTick: (positionSec, durationSec = 0) => _send("tick", { positionSec, durationSec }),
  };

  // Immediate wake-up reconnect when user returns to tab or network recovers
  if (typeof window !== "undefined") {
    const _wakeUpCheck = () => {
      if (!_ws || _ws.readyState === WebSocket.CLOSED || _ws.readyState === WebSocket.CLOSING) {
        if (!_intentionalClose) {
          _backoff = 1000;
          connect();
        }
      } else if (_ws.readyState === WebSocket.OPEN) {
        try { _ws.send(JSON.stringify({ t: "ping" })); } catch (_) { }
      }
    };
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") _wakeUpCheck();
    });
    window.addEventListener("focus", _wakeUpCheck);
    window.addEventListener("online", _wakeUpCheck);
  }

  return Object.freeze(api);
})();
