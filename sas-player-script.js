// =========================================================================
//  SAS PLAYER — APP VERSION (Workers + Durable Objects Architecture)
// =========================================================================
const APP_VERSION = '4.4.0';

(() => {
  'use strict';

// Default Studio Playlist Fallback
const DEFAULT_TRACKS = [
  { id: 'byitAI7kkOM', title: 'Armaan Malik - Dil Mein Ho Tum', addedByName: 'SAS', isPinned: false },
  { id: 'W1y8blwMLxY', title: 'Jubin Nautiyal - Barbaad', addedByName: 'SAS', isPinned: false },
  { id: '2FPTVYj3ouE', title: 'Khaali Salam Dua', addedByName: 'SAS', isPinned: false },
  { id: 'ia5CdcuqSWk', title: 'Terre Pyaar Mein', addedByName: 'SAS', isPinned: false },
  { id: 'BvPNWCzQMec', title: 'Bekhudi', addedByName: 'SAS', isPinned: false },
  { id: 'kKljXVVkgS4', title: 'Sanam Teri kasam', addedByName: 'SAS', isPinned: false },
  { id: 'ztPa6vkM-yY', title: 'Guzarish', addedByName: 'SAS', isPinned: false },
  { id: 'u4wmmGrI4pE', title: 'Chaand Jaise Mukhde Pe Bindiya Sitara', addedByName: 'SAS', isPinned: false },
  { id: 'TqR_jWfHW4g', title: 'Humnava', addedByName: 'SAS', isPinned: false },
  { id: 'ayzN5Il56co', title: 'Chori Chori Yun Jab Ho', addedByName: 'SAS', isPinned: false },
  { id: 'R7spJ7YjNOY', title: 'Love Letter', addedByName: 'SAS', isPinned: false },
  { id: '1a--6kZ8LCY', title: 'Hug Me', addedByName: 'SAS', isPinned: false },
  { id: 'AbkEmIgJMcU', title: 'Pal Pal', addedByName: 'SAS', isPinned: false },
  { id: 'wCTmWy43HgM', title: 'Haseen', addedByName: 'SAS', isPinned: false },
  { id: 'QRwLbf3PwO8', title: 'Qayade Se', addedByName: 'SAS', isPinned: false },
  { id: 'yHJf8MSPHk0', title: 'Baatein ye Kabhi na', addedByName: 'SAS', isPinned: false }
];

let videoLinks = JSON.parse(JSON.stringify(DEFAULT_TRACKS));

let player = null;
let isPlayerReady = false;
let lastLoadedVideoId = '';
let ytApiReady = false;
let currentIndex = 0;
let usingYouTubePlaylist = false;
let activePlaylistId = '';
let activePlaylistTitle = '';
const titleCache = {};
let dragFromIndex = -1;
let isLightMode = false;
let isThemeAnimating = false;
let expectedPlaybackState = null;
let activeQueueFilter = 'all'; // 'all', 'pinned', 'requests'
let currentThumbnailVideoId = null;

// Auth & Access state (Driven authoritatively by Cloudflare Durable Object)
let deviceId = null;
let deviceStatus = 'guest'; // 'guest', 'pending', 'approved', 'revoked'
let currentUserRole = 'guest'; // 'pending', 'guest', 'admin', 'super_admin'
let isAdmin = false;
let isSuperAdmin = false;

// Role-based permission helpers
function canControlTransport() { return isSuperAdmin || (isAdmin && deviceStatus !== 'revoked'); }
function canManageQueue() { return isSuperAdmin || (isAdmin && deviceStatus !== 'revoked'); }
function canAddTracks() { return isSuperAdmin || (isAdmin && deviceStatus !== 'revoked') || (currentUserRole === 'guest' && deviceStatus !== 'pending'); }
function canModerate() { return isSuperAdmin; }

const disk = document.getElementById('spinning-disk');
const playPauseBtn = document.getElementById('play-pause-btn');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const skyTransition = document.getElementById('sky-transition');

if (playPauseBtn) {
  playPauseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMainPlayback();
  });
}
if (disk) {
  disk.addEventListener('click', () => {
    toggleMainPlayback();
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Dawn / Dusk Sky Transition Animation
async function toggleTheme() {
  if (isThemeAnimating) return;

  isThemeAnimating = true;
  if (themeToggleBtn) themeToggleBtn.disabled = true;

  const turningLightOn = !isLightMode;
  skyTransition.classList.remove('dawn', 'dusk', 'active');
  skyTransition.classList.add(turningLightOn ? 'dawn' : 'dusk');
  void skyTransition.offsetWidth;
  skyTransition.classList.add('active');
  isLightMode = turningLightOn;
  document.body.classList.toggle('light-mode', isLightMode);

  await wait(2800);
  skyTransition.classList.remove('active', 'dawn', 'dusk');

  if (themeToggleBtn) {
    const icon = themeToggleBtn.querySelector('i');
    const label = themeToggleBtn.querySelector('span');
    if (isLightMode) {
      if (icon) icon.className = 'fas fa-moon';
      if (label) label.innerText = 'Dark';
    } else {
      if (icon) icon.className = 'fas fa-sun';
      if (label) label.innerText = 'Light';
    }
    themeToggleBtn.disabled = false;
  }
  isThemeAnimating = false;
}

// Activity & Telemetry Realtime Stream
const EVENT_ICONS = {
  play: { icon: 'fa-play', cls: 'type-play' },
  pause: { icon: 'fa-pause', cls: 'type-pause' },
  skip: { icon: 'fa-forward', cls: 'type-skip' },
  prev: { icon: 'fa-backward', cls: 'type-skip' },
  volume: { icon: 'fa-volume-up', cls: 'type-volume' },
  pin: { icon: 'fa-thumbtack', cls: 'type-pin' },
  add: { icon: 'fa-plus-circle', cls: 'type-add' },
  admin: { icon: 'fa-shield-alt', cls: 'type-admin' },
  clear: { icon: 'fa-trash-alt', cls: 'type-clear' },
  seek: { icon: 'fa-history', cls: 'type-seek' },
  reorder: { icon: 'fa-sort', cls: 'type-skip' },
  info: { icon: 'fa-bolt', cls: 'type-skip' }
};

const PAGE_BOOT_TIME = Date.now();
const seenEventIds = new Set();

function formatActivityEventName(ev) {
  if (!ev) return '';
  const type = (ev.type || '').toLowerCase();
  const detail = (ev.detail || '').trim();

  // Play / Resume actions
  if (type === 'play') {
    if (!detail || detail.toLowerCase().startsWith('now playing')) {
      return 'Play';
    }
    if (detail === 'Play' || detail === 'Resumed playback' || detail === 'Selected Track') {
      return detail;
    }
    // If detail is raw track title from legacy logs, display Play
    return 'Play';
  }

  // Pause action
  if (type === 'pause') {
    return 'Pause';
  }

  // Skip / Next / Prev actions
  if (type === 'skip' || type === 'next') {
    return detail === 'Previous Track' ? 'Previous Track' : 'Next Track';
  }
  if (type === 'prev') {
    return 'Previous Track';
  }

  // Seek action
  if (type === 'seek') {
    return 'Seeked Track';
  }

  // Use descriptive detail if already present (e.g. Set master volume..., Added..., Pinned...)
  if (detail) {
    return detail;
  }

  if (type === 'reorder') {
    return 'Reordered Playlist';
  }

  // Friendly type fallbacks
  const typeLabels = {
    volume: 'Volume Changed',
    add: 'Added Track',
    clear: 'Cleared Queue',
    pin: 'Pinned Track',
    reorder: 'Reordered Playlist',
    admin: 'Role Updated',
    info: 'Connected to Station'
  };

  return typeLabels[type] || (type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Action');
}

function renderActivityStream(activities) {
  const stream = document.getElementById('live-activity-stream');
  if (!stream) return;

  // Guests see a private station notice; only authorized admins see real-time radar
  if (!isAuthorizedUser()) {
    stream.innerHTML = `
      <div style="padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 11.5px; line-height: 1.6;">
        <i class="fas fa-user-shield" style="font-size: 20px; opacity: 0.35; margin-bottom: 8px; display: block;"></i>
        <div style="font-weight: 600; color: var(--text-dim); margin-bottom: 4px;">Private Station Stream</div>
        Real-time activity radar is reserved for authorized station admins.
      </div>`;
    return;
  }

  if (!Array.isArray(activities)) return;

  stream.innerHTML = '';
  activities.slice(0, 25).forEach((ev) => {
    const isNew = !seenEventIds.has(ev.id);
    seenEventIds.add(ev.id);

    const card = buildActivityCard(ev);
    stream.appendChild(card);

    // Show floating toast for recent events from other devices
    const isRecent = ev.at && (Date.now() - ev.at < 20000);
    const isSelf = ev.actorName && (ev.actorName === getDeviceName());
    if (isNew && isRecent && !isSelf) {
      showEventToast(ev);
    } else if (!isSelf && ev.type === 'volume') {
      updateEventToast(ev);
    }
  });
}

function updateEventToast(ev) {
  const hub = document.getElementById('event-toast-hub');
  if (!hub) return;
  const existing = hub.querySelector(`[data-event-id="${ev.id}"]`) || hub.querySelector('[data-event-type="volume"]');
  if (existing) {
    const detailEl = existing.querySelector('.event-detail-text');
    if (detailEl) detailEl.textContent = formatActivityEventName(ev);
  }
}

function buildActivityCard(ev) {
  const typeConfig = EVENT_ICONS[ev.type] || EVENT_ICONS.info;
  const timeStr = new Date(ev.at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const isSelf = ev.actorName === getDeviceName();
  const eventLabel = formatActivityEventName(ev);

  const card = document.createElement('div');
  card.className = 'stream-event-card';
  card.dataset.eventId = ev.id || '';
  card.innerHTML = `
    <div class="event-icon-box ${typeConfig.cls}">
      <i class="fas ${typeConfig.icon}"></i>
    </div>
    <div class="event-content-block">
      <div class="event-actor-row">
        <div class="event-actor-identity">
          <span>${escapeHtml(ev.actorName || 'Device')}</span>
          ${isSelf ? '<span style="font-size:9px;color:var(--text-muted);font-weight:normal;">(You)</span>' : ''}
        </div>
        <span class="event-time">${timeStr}</span>
      </div>
      <div class="event-detail-text">${escapeHtml(eventLabel)}</div>
    </div>
  `;
  return card;
}

let _lastSeekToastAt = 0;
function showEventToast(ev) {
  if (!isAuthorizedUser()) return; // Never show floating broadcast toasts to guests
  if (ev && ev.type === 'seek') {
    if (Date.now() - _lastSeekToastAt < 3000) return;
    _lastSeekToastAt = Date.now();
  }
  const hub = document.getElementById('event-toast-hub');
  if (!hub) return;

  while (hub.children.length >= 2) {
    hub.removeChild(hub.firstChild);
  }

  const typeConfig = EVENT_ICONS[ev.type] || EVENT_ICONS.info;
  const eventLabel = formatActivityEventName(ev);
  const toast = document.createElement('div');
  toast.className = 'event-toast-card';
  toast.dataset.eventId = ev.id || '';
  toast.dataset.eventType = ev.type || '';
  toast.innerHTML = `
    <div class="event-icon-box ${typeConfig.cls}" style="width:32px;height:32px;font-size:13px;">
      <i class="fas ${typeConfig.icon}"></i>
    </div>
    <div class="event-content-block">
      <div class="event-actor-row">
        <div class="event-actor-identity" style="font-size:12px;">
          <span>${escapeHtml(ev.actorName || 'Station')}</span>
        </div>
        <span class="event-time">Just now</span>
      </div>
      <div class="event-detail-text" style="font-size:12px;color:var(--text-main);">${escapeHtml(eventLabel)}</div>
    </div>
    <div class="toast-progress-bar"></div>
  `;

  toast.onclick = () => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 250);
  };

  hub.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 250);
    }
  }, 3800);
}

// Initialize YouTube Player
let isInitializingPlayer = false;
let pendingLocalTrackIndex = -1;
let _trackTransitionGuardUntil = 0;
let _ignorePauseProgrammaticUntil = 0;
let _lastErrorSkipAt = 0;

function onYouTubeIframeAPIReady() {
  ytApiReady = true;
  initYouTubePlayer();
}

function ensureYouTubeAPIReady() {
  if (ytApiReady && player) return;
  if (window.YT && typeof window.YT.Player === 'function') {
    ytApiReady = true;
    initYouTubePlayer();
    return;
  }
  let attempts = 0;
  const checkTimer = setInterval(() => {
    attempts++;
    if (window.YT && typeof window.YT.Player === 'function') {
      clearInterval(checkTimer);
      ytApiReady = true;
      initYouTubePlayer();
    } else if (attempts >= 40) {
      clearInterval(checkTimer);
    }
  }, 250);
}

function initYouTubePlayer() {
  if (!ytApiReady || player || isInitializingPlayer) return;

  // Super Admin and Guest both get the live YouTube player with audio.
  // Admin and Pending roles use thumbnail mode — no iframe needed.
  if (currentUserRole === 'admin' || currentUserRole === 'pending') {
    return;
  }

  isInitializingPlayer = true;
  const initialVideoId = (videoLinks[currentIndex] ? videoLinks[currentIndex].id : 'byitAI7kkOM');

  try {
    const playerVars = {
      'autoplay': 0,
      'mute': 0,
      'controls': 0,
      'rel': 0,
      'playsinline': 1,
      'enablejsapi': 1,
      'disablekb': 1,
      'iv_load_policy': 3,
      'modestbranding': 1
    };
    if (window.location && /^https?:$/i.test(window.location.protocol)) {
      playerVars.origin = window.location.origin;
    }

    player = new YT.Player('yt-iframe', {
      height: '100%',
      width: '100%',
      videoId: initialVideoId,
      playerVars,
      events: {
        'onReady': (e) => {
          isInitializingPlayer = false;
          onPlayerReady(e);
        },
        'onStateChange': onPlayerStateChange,
        'onError': () => {
          isInitializingPlayer = false;
          // Avoid getting stuck on an unplayable/unavailable video in a queue or playlist
          if (isPlayerReady && videoLinks.length > 1 && (Date.now() - _lastErrorSkipAt > 2500)) {
            if (isSuperAdmin && SAS.state?.nowPlaying?.isPlaying) {
              _lastErrorSkipAt = Date.now();
              _trackTransitionGuardUntil = Date.now() + 4000;
              SAS.next();
            } else if (!isAuthorizedUser() && expectedPlaybackState === 'playing') {
              _lastErrorSkipAt = Date.now();
              _trackTransitionGuardUntil = Date.now() + 3500;
              playNext();
            }
          }
        }
      }
    });
  } catch (err) {
    isInitializingPlayer = false;
  }
}

function onPlayerReady() {
  isPlayerReady = true;

  if (player && typeof player.unMute === 'function') {
    player.unMute();
  }

  if (isSuperAdmin) {
    if (player && typeof player.getDuration === 'function') {
      const dur = player.getDuration() || 0;
      if (dur > 0) SAS.hostTick(player.getCurrentTime() || 0, dur);
    }

    // Apply existing state if already received from server
    if (SAS.state?.nowPlaying?.videoId) {
      applyNowPlayingToPlayer(SAS.state.nowPlaying);
    }
  } else if (!isAuthorizedUser()) {
    // If Guest clicked a track before the iframe finished initializing, play it now
    if (pendingLocalTrackIndex >= 0 && pendingLocalTrackIndex < videoLinks.length) {
      const idx = pendingLocalTrackIndex;
      pendingLocalTrackIndex = -1;
      loadLocalVideo(idx);
    } else if (videoLinks[currentIndex]) {
      updateDisplayTitle(videoLinks[currentIndex].title);
    }
  }
}

function isNearTrackEnd() {
  if (!player || typeof player.getDuration !== 'function' || typeof player.getCurrentTime !== 'function') {
    return false;
  }
  const dur = player.getDuration() || 0;
  const cur = player.getCurrentTime() || 0;
  return dur > 0 && cur >= dur - 2.0;
}

function onPlayerStateChange(event) {
  const state = event.data;
  const isPlaying = (state === YT.PlayerState.PLAYING);

  // Synchronize Super Admin host player state with the room and UI
  if (isSuperAdmin) {
    if (isPlaying) {
      _trackTransitionGuardUntil = 0;
      expectedPlaybackState = 'playing';
      if (SAS.state?.nowPlaying && !SAS.state.nowPlaying.isPlaying) {
        SAS.play();
      }
      updatePlaybackUIState(true);
    } else if (state === YT.PlayerState.CUED) {
      // If a track was loaded while room expects playback, kick off playback automatically
      if (SAS.state?.nowPlaying?.isPlaying || expectedPlaybackState === 'playing') {
        _trackTransitionGuardUntil = Date.now() + 2500;
        try { player.playVideo(); } catch (_) { }
      }
    } else if (state === YT.PlayerState.PAUSED) {
      // Ignore transient PAUSED events fired by YouTube during track switches, programmatic pauses, or right before ENDED
      if (Date.now() < _trackTransitionGuardUntil) {
        return;
      }
      if (Date.now() < _ignorePauseProgrammaticUntil) {
        updatePlaybackUIState(false);
        return;
      }
      if (isNearTrackEnd()) {
        return;
      }
      const playerVid = (typeof player.getVideoData === 'function') ? (player.getVideoData()?.video_id || '') : '';
      const serverVid = SAS.state?.nowPlaying?.videoId || '';
      if (playerVid && serverVid && playerVid !== serverVid) {
        return;
      }

      expectedPlaybackState = 'paused';
      if (SAS.state?.nowPlaying?.isPlaying) {
        // Host player was paused locally (e.g. user clicked native YouTube pause)
        SAS.pause();
      }
      updatePlaybackUIState(false);
    }
  } else if (!isAuthorizedUser()) {
    // Guest standalone playback state sync
    if (isPlaying) {
      _trackTransitionGuardUntil = 0;
      expectedPlaybackState = 'playing';
      updatePlaybackUIState(true);
    } else if (state === YT.PlayerState.CUED) {
      if (expectedPlaybackState === 'playing') {
        _trackTransitionGuardUntil = Date.now() + 2500;
        try { player.playVideo(); } catch (_) { }
      }
    } else if (state === YT.PlayerState.PAUSED) {
      if (Date.now() < _trackTransitionGuardUntil || isNearTrackEnd()) {
        return;
      }
      expectedPlaybackState = 'paused';
      updatePlaybackUIState(false);
    }
  }

  // Broadcast duration to all other devices on playback start/buffer
  if (isSuperAdmin && (isPlaying || state === YT.PlayerState.BUFFERING)) {
    if (player && typeof player.getDuration === 'function') {
      const dur = player.getDuration() || 0;
      if (dur > 0) {
        SAS.hostTick(player.getCurrentTime() || 0, dur);
      }
    }
  }

  // If host player finishes playing a track, advance the entire room
  if (isSuperAdmin && state === YT.PlayerState.ENDED) {
    _trackTransitionGuardUntil = Date.now() + 4000;
    expectedPlaybackState = 'playing';
    SAS.next();
  } else if (!isAuthorizedUser() && state === YT.PlayerState.ENDED) {
    // Guest player advances locally
    _trackTransitionGuardUntil = Date.now() + 3500;
    expectedPlaybackState = 'playing';
    playNext();
  }
}

// Track Timer (Reads directly from player if host, or derives from projected position)
let serverDuration = 0;

function setDeckTimerVisible(visible) {
  const el = document.getElementById('deck-track-timer');
  if (el) el.style.display = visible ? '' : 'none';
}

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

let trackTimerInterval = null;
function startTrackTimer() {
  if (trackTimerInterval) clearInterval(trackTimerInterval);
  trackTimerInterval = setInterval(updateTrackTimerDisplay, 1000);
  updateTrackTimerDisplay();
}

function updateTrackTimerDisplay() {
  const curEl = document.getElementById('timer-current');
  const durEl = document.getElementById('timer-duration');

  let current = 0;
  let duration = 0;

  if ((isSuperAdmin || !isAuthorizedUser()) && player && typeof player.getCurrentTime === 'function') {
    current = player.getCurrentTime() || 0;
    duration = (typeof player.getDuration === 'function') ? (player.getDuration() || 0) : 0;
  } else {
    current = SAS.projectedPosition() || 0;
    duration = serverDuration || SAS.state?.nowPlaying?.durationSec || 0;
    if (duration > 0) current = Math.min(current, duration);
  }

  if (curEl) curEl.textContent = formatTime(current);
  if (durEl) durEl.textContent = duration > 0 ? formatTime(duration) : '--:--';

  // Mirror onto thumbnail overlay progress bar for Admins and guests
  // Skip updates while the user is actively scrubbing to avoid visual fighting
  if (!_thumbScrubbing) {
    const thumbFill = document.getElementById('thumb-progress-fill');
    const thumbHandle = document.getElementById('thumb-progress-handle');
    const thumbCur = document.getElementById('thumb-progress-current');
    const thumbDur = document.getElementById('thumb-progress-duration');
    if (thumbFill) {
      const pct = duration > 0 ? Math.min(100, Math.max(0, (current / duration) * 100)) : 0;
      thumbFill.style.width = pct + '%';
      if (thumbHandle) thumbHandle.style.left = pct + '%';
    }
    if (thumbCur) thumbCur.textContent = formatTime(current);
    if (thumbDur) thumbDur.textContent = duration > 0 ? formatTime(duration) : '--:--';
  }
}

// =========================================================================
//  Thumbnail Progress Bar — YouTube-style Scrubber (Admin / Super Admin)
// =========================================================================
let _thumbScrubbing = false;

function initThumbProgressScrubber() {
  const overlay = document.getElementById('thumb-progress-overlay');
  const hitarea = document.getElementById('thumb-progress-hitarea');
  const track = document.getElementById('thumb-progress-track');
  const fill = document.getElementById('thumb-progress-fill');
  const handle = document.getElementById('thumb-progress-handle');
  const hoverFill = document.getElementById('thumb-progress-hover-fill');
  const tooltip = document.getElementById('thumb-progress-tooltip');
  if (!overlay || !hitarea || !track || !fill) return;

  // Helper: compute seek fraction from a pointer event relative to the track
  function pctFromEvent(e) {
    const rect = track.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    const touch = e.touches?.[0] || e.changedTouches?.[0];
    const clientX = touch ? touch.clientX : (typeof e.clientX === 'number' ? e.clientX : 0);
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }

  // Helper: get the current duration from the server state
  function getDuration() {
    if (player && typeof player.getDuration === 'function') {
      const d = player.getDuration();
      if (d > 0) return d;
    }
    return serverDuration || SAS.state?.nowPlaying?.durationSec || 0;
  }

  // Helper: position tooltip horizontally relative to the overlay
  function positionTooltip(frac) {
    if (!tooltip) return;
    const trackRect = track.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const px = trackRect.left + (frac * trackRect.width) - overlayRect.left;
    tooltip.style.left = px + 'px';
    tooltip.style.transform = 'translateX(-50%)';
  }

  // Helper: apply visual position at a given fraction
  function applyVisualPosition(frac) {
    const pct = frac * 100;
    fill.style.width = pct + '%';
    if (handle) handle.style.left = pct + '%';
    const curEl = document.getElementById('thumb-progress-current');
    if (curEl) curEl.textContent = formatTime(frac * getDuration());
  }

  // --- Hover: show tooltip + ghost fill ---
  hitarea.addEventListener('mousemove', (e) => {
    if (_thumbScrubbing) return;
    const frac = pctFromEvent(e);
    if (hoverFill) hoverFill.style.width = (frac * 100) + '%';
    if (tooltip) {
      tooltip.textContent = formatTime(frac * getDuration());
      positionTooltip(frac);
    }
  });

  hitarea.addEventListener('mouseleave', () => {
    if (_thumbScrubbing) return;
    if (hoverFill) hoverFill.style.width = '0%';
  });

  // --- Drag / Scrub (mouse + touch) ---
  function startScrub(e) {
    e.preventDefault();
    _thumbScrubbing = true;
    overlay.classList.add('scrubbing');
    moveScrub(e);
    if (e.type === 'touchstart') {
      document.addEventListener('touchmove', moveScrub, { passive: false });
      document.addEventListener('touchend', endScrub);
      document.addEventListener('touchcancel', endScrub);
    } else {
      document.addEventListener('mousemove', moveScrub);
      document.addEventListener('mouseup', endScrub);
    }
  }

  function moveScrub(e) {
    if (!_thumbScrubbing) return;
    if (e.cancelable) e.preventDefault();
    const frac = pctFromEvent(e);
    applyVisualPosition(frac);
    if (hoverFill) hoverFill.style.width = (frac * 100) + '%';
    if (tooltip) {
      tooltip.textContent = formatTime(frac * getDuration());
      positionTooltip(frac);
    }
  }

  function endScrub(e) {
    if (!_thumbScrubbing) return;
    const frac = pctFromEvent(e);
    const dur = getDuration();
    _thumbScrubbing = false;
    overlay.classList.remove('scrubbing');

    document.removeEventListener('mousemove', moveScrub);
    document.removeEventListener('mouseup', endScrub);
    document.removeEventListener('touchmove', moveScrub);
    document.removeEventListener('touchend', endScrub);
    document.removeEventListener('touchcancel', endScrub);

    if (dur > 0) {
      performSeek(frac * dur);
    }
  }

  hitarea.addEventListener('mousedown', startScrub);
  hitarea.addEventListener('touchstart', startScrub, { passive: false });
}

// Perform a seek: for Super Admin it seeks the local YT player + broadcasts;
// for Admin it sends a seek command to the server.
function performSeek(positionSec) {
  const exactPos = Math.max(0, Math.round(positionSec * 10) / 10);
  _hostSeekCooldownUntil = Date.now() + 3000;
  _lastHostReportedSec = exactPos;

  if (isSuperAdmin || !isAuthorizedUser()) {
    if (player && isPlayerReady && typeof player.seekTo === 'function') {
      try { player.seekTo(exactPos, true); } catch (_) { }
    }
  }
  if (isAuthorizedUser() && typeof SAS.seek === 'function') {
    SAS.seek(exactPos);
  }
  updateTrackTimerDisplay();
}

// Master Playback State Synchronizer for All UI Controls
function updatePlaybackUIState(isPlaying, title = null, trackIndex = null) {
  document.body.classList.toggle('is-playing', isPlaying);

  if (disk) {
    disk.classList.toggle('playing', isPlaying);
    disk.classList.toggle('spinning', isPlaying);
  }

  const diskPlayBtn = document.getElementById('play-pause-btn');
  if (diskPlayBtn) {
    const diskIcon = diskPlayBtn.querySelector('i');
    if (diskIcon) diskIcon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
  }

  const mainPlayIcon = document.getElementById('main-play-pause-icon');
  if (mainPlayIcon) {
    mainPlayIcon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
  }

  const remotePlayBtn = document.getElementById('remote-play-pause');
  if (remotePlayBtn) {
    const rIcon = remotePlayBtn.querySelector('i');
    if (rIcon) rIcon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
  }

  const npDot = document.getElementById('remote-np-dot');
  if (npDot) npDot.classList.toggle('playing', isPlaying);

  const waveform = document.getElementById('waveform-box');
  if (waveform) waveform.style.opacity = isPlaying ? '1' : '0.3';

  if (title) {
    const curTitleEl = document.getElementById('current-title');
    if (curTitleEl) curTitleEl.innerText = title;
    const remoteTitle = document.getElementById('remote-now-playing-title');
    if (remoteTitle) remoteTitle.textContent = title;
    updateMediaSession(title, 'SAS Player');
  }

  if (typeof trackIndex === 'number' && trackIndex >= 0) {
    currentIndex = trackIndex;
  }
  updatePlaylistUI();
}

function updateDisplayTitle(title) {
  const displayTitle = title || 'Select a track to begin';
  const curTitleEl = document.getElementById('current-title');
  const sideTitleEl = document.getElementById('sidebar-title');
  if (curTitleEl) curTitleEl.innerText = displayTitle;
  if (sideTitleEl && sideTitleEl.innerText !== '44.1 kHz Hi-Fi YouTube Master Feed') {
    sideTitleEl.innerText = displayTitle;
  }

  const remoteTitle = document.getElementById('remote-now-playing-title');
  if (remoteTitle) remoteTitle.textContent = displayTitle;
  updateMediaSession(displayTitle, 'SAS Player');
}

// Queue Rendering with Micro-Spinning Vinyl Discs
const playlistContainer = document.getElementById('track-list');

function initPlaylist() {
  if (!playlistContainer) return;
  playlistContainer.innerHTML = '';

  if (videoLinks.length === 0) {
    const helper = document.createElement('div');
    helper.className = 'track-card empty-queue-helper';
    helper.style.cssText = 'flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 22px 14px; gap: 10px; cursor: default;';
    helper.innerHTML = `
      <div class="track-details-col" style="align-items: center;">
        <i class="fas fa-compact-disc" style="font-size: 26px; color: var(--text-dim); margin-bottom: 4px;"></i>
        <span class="track-title-text" style="color: var(--text-muted); font-size: 12px;">Queue is currently empty.</span>
      </div>
      <button onclick="loadDefaultPlaylistAction()" style="background: rgba(0, 242, 254, 0.12); border: 1px solid rgba(0, 242, 254, 0.35); color: var(--accent-cyan); padding: 6px 14px; border-radius: var(--radius-sm); font-size: 11.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
        <i class="fas fa-undo"></i> Load Default Playlist
      </button>
    `;
    playlistContainer.appendChild(helper);
    return;
  }

  let renderedCount = 0;
  videoLinks.forEach((link, index) => {
    const isPinned = !!link.isPinned;
    const isRequest = link.addedByName && !link.addedByName.includes('Super Admin') && !link.addedByName.includes('Host');

    if (activeQueueFilter === 'pinned' && !isPinned) return;
    if (activeQueueFilter === 'requests' && !isRequest) return;

    renderedCount++;
    playlistContainer.appendChild(createTrackItem(link, index, index === currentIndex));
  });

  if (renderedCount === 0) {
    const helper = document.createElement('div');
    helper.className = 'track-card';
    const msg = activeQueueFilter === 'pinned'
      ? 'No pinned tracks yet. Click the <i class="fas fa-thumbtack"></i> icon on any track to pin it.'
      : 'No remote guest requests yet.';
    helper.innerHTML = `<div class="track-details-col"><span class="track-title-text" style="color: var(--text-muted); font-size:12px;">${msg}</span></div>`;
    playlistContainer.appendChild(helper);
  }
}

function updatePlaylistUI() {
  if (!playlistContainer) return;
  const isAudioPlaying = disk && disk.classList.contains('playing');
  const items = playlistContainer.querySelectorAll('.track-card[data-track-index]');
  items.forEach((item) => {
    const idx = Number(item.dataset.trackIndex);
    const isCurrent = (idx === currentIndex);
    item.classList.toggle('active-playing', isCurrent);
    const microDisk = item.querySelector('.micro-vinyl-disk');
    if (microDisk) {
      microDisk.classList.toggle('spinning', isCurrent && isAudioPlaying);
    }
  });
}

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function fetchVideoTitle(videoId) {
  if (!videoId) return '';
  if (titleCache[videoId]) return titleCache[videoId];
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 5000) : null;
    const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
      signal: controller ? controller.signal : undefined
    });
    if (timeoutId) clearTimeout(timeoutId);
    if (!response.ok) return '';
    const data = await response.json();
    const title = data && data.title ? data.title.trim() : '';
    if (title) titleCache[videoId] = title;
    return title;
  } catch (error) {
    return '';
  }
}

let _isHydratingTitles = false;
async function hydrateVideoTitles() {
  if (_isHydratingTitles) return;
  _isHydratingTitles = true;
  let changed = false;

  try {
    const pending = [];
    videoLinks.forEach((track, index) => {
      if (track && (!track.title || track.title === 'YouTube Track' || track.title === 'Untitled')) {
        pending.push({ id: track.id, index });
      }
    });

    const BATCH_SIZE = 8;
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const slice = pending.slice(i, i + BATCH_SIZE);
      await Promise.all(slice.map(async ({ id, index }) => {
        const title = await fetchVideoTitle(id);
        if (title && videoLinks[index] && videoLinks[index].id === id) {
          videoLinks[index].title = title;
          changed = true;
        }
      }));
    }
  } finally {
    _isHydratingTitles = false;
  }

  if (changed) {
    initPlaylist();
    updatePlaylistUI();
    const activeTrack = videoLinks[currentIndex] || videoLinks[0];
    if (activeTrack && activeTrack.title) {
      updateDisplayTitle(activeTrack.title);
    }
  }
}

function createTrackItem(link, index, isActive) {
  const div = document.createElement('div');
  const isAudioPlaying = disk && disk.classList.contains('playing');
  const canDrag = isAuthorizedUser();
  div.className = `track-card ${isActive ? 'active-playing' : ''}`;
  div.dataset.trackIndex = index;
  div.draggable = canDrag;

  const addedBy = link.addedByName || 'Station';
  const isHost = addedBy.includes('Super Admin') || addedBy.includes('Host');
  const isPinned = !!link.isPinned;
  const tagHtml = isPinned
    ? `<span class="pinned-tag"><i class="fas fa-thumbtack"></i> PINNED</span>`
    : `<span class="added-by-tag ${isHost ? 'super-admin' : ''}">${escapeHtml(addedBy)}</span>`;
  const titleText = link.title || 'Loading track title...';

  div.innerHTML = `
    <div class="track-num-drag" title="${canDrag ? 'Drag to reorder' : 'Admin authorization required to reorder tracks'}">${index + 1}</div>
    <div class="micro-vinyl-disk ${isActive && isAudioPlaying ? 'spinning' : ''}">
      <div class="micro-vinyl-center-core"></div>
    </div>
    <div class="track-details-col">
      <div class="track-title-text" title="${escapeHtml(titleText)}">${escapeHtml(titleText)}</div>
      <div class="track-meta-row">
        <span>Track #${index + 1}</span>
        <span>•</span>
        ${tagHtml}
      </div>
    </div>
    <div class="track-card-actions">
      <button class="track-btn-subtle ${isPinned ? 'pinned' : ''}" title="${isPinned ? 'Unpin track' : 'Pin to favorites'}" onclick="event.stopPropagation(); togglePinTrack(${index});">
        <i class="fas fa-thumbtack"></i>
      </button>
      <button class="track-btn-subtle" title="Remove track" onclick="event.stopPropagation(); removeTrack(${index});">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `;

  div.onclick = () => {
    loadVideo(index);
  };

  return div;
}

// Local helper functions for standalone Guest player
function toggleLocalPlayback() {
  if (!player || !isPlayerReady || typeof player.getPlayerState !== 'function') {
    ensureYouTubeAPIReady();
    if (videoLinks[currentIndex]) {
      pendingLocalTrackIndex = currentIndex;
      expectedPlaybackState = 'playing';
      updatePlaybackUIState(true, videoLinks[currentIndex].title, currentIndex);
    }
    return;
  }
  const state = player.getPlayerState();
  const isCurrentlyPlaying = (state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING);
  if (isCurrentlyPlaying) {
    expectedPlaybackState = 'paused';
    _ignorePauseProgrammaticUntil = Date.now() + 1200;
    player.pauseVideo();
    updatePlaybackUIState(false);
  } else {
    expectedPlaybackState = 'playing';
    _trackTransitionGuardUntil = Date.now() + 2500;
    if (state === YT.PlayerState.ENDED) {
      player.seekTo(0, true);
    }
    player.playVideo();
    updatePlaybackUIState(true);
  }
}

function loadLocalVideo(index) {
  if (index < 0 || index >= videoLinks.length) return;
  currentIndex = index;
  const track = videoLinks[index];
  if (!track) return;
  lastLoadedVideoId = track.id;
  expectedPlaybackState = 'playing';
  _trackTransitionGuardUntil = Date.now() + 3500;
  if (player && isPlayerReady && typeof player.loadVideoById === 'function') {
    pendingLocalTrackIndex = -1;
    player.loadVideoById({ videoId: track.id, startSeconds: 0 });
  } else {
    pendingLocalTrackIndex = index;
    ensureYouTubeAPIReady();
  }
  updatePlaybackUIState(true, track.title, index);
}

function addLocalTrack(videoId, title) {
  const wasEmpty = videoLinks.length === 0;
  videoLinks.push({
    id: videoId,
    title: title || 'YouTube Track',
    addedByName: 'You (Guest)',
    isPinned: false,
  });
  initPlaylist();
  updatePlaylistUI();
  if (wasEmpty || currentIndex === -1) {
    loadLocalVideo(0);
  }
}

// User Action Handlers (Dispatch Intents for Admins, Local Execution for Guests)
function toggleMainPlayback() {
  if (!isAuthorizedUser()) {
    toggleLocalPlayback();
    return;
  }
  const np = SAS.state?.nowPlaying;
  // If Super Admin has a local player that is actually paused/stopped, ensure we play!
  const isActuallyPlaying = isSuperAdmin && player && typeof player.getPlayerState === 'function'
    ? (player.getPlayerState() === YT.PlayerState.PLAYING || player.getPlayerState() === YT.PlayerState.BUFFERING)
    : (np && np.isPlaying);

  if (isActuallyPlaying) {
    expectedPlaybackState = 'paused';
    _ignorePauseProgrammaticUntil = Date.now() + 1500;
    if (isSuperAdmin && player && typeof player.pauseVideo === 'function') {
      try { player.pauseVideo(); } catch (_) { }
    }
    SAS.pause();
  } else {
    expectedPlaybackState = 'playing';
    _trackTransitionGuardUntil = Date.now() + 2500;
    if (isSuperAdmin && player && isPlayerReady && typeof player.playVideo === 'function') {
      try { player.playVideo(); } catch (_) { }
    }
    SAS.play();
  }
}

function playNext() {
  if (!isAuthorizedUser()) {
    if (videoLinks.length === 0) return;
    const nextIdx = (currentIndex + 1) % videoLinks.length;
    loadLocalVideo(nextIdx);
    return;
  }
  _trackTransitionGuardUntil = Date.now() + 3500;
  expectedPlaybackState = 'playing';
  SAS.next();
}

function playPrev() {
  if (!isAuthorizedUser()) {
    if (videoLinks.length === 0) return;
    const prevIdx = (currentIndex - 1 + videoLinks.length) % videoLinks.length;
    loadLocalVideo(prevIdx);
    return;
  }
  _trackTransitionGuardUntil = Date.now() + 3500;
  expectedPlaybackState = 'playing';
  SAS.prev();
}

function loadVideo(index) {
  if (!isAuthorizedUser()) {
    loadLocalVideo(index);
    return;
  }
  _trackTransitionGuardUntil = Date.now() + 3500;
  expectedPlaybackState = 'playing';
  SAS.goto(index);
}

function togglePinTrack(index) {
  if (!isAuthorizedUser()) {
    if (index < 0 || index >= videoLinks.length) return;
    videoLinks[index].isPinned = !videoLinks[index].isPinned;
    initPlaylist();
    updatePlaylistUI();
    return;
  }
  SAS.togglePin(index);
}

function removeTrack(index) {
  if (!isAuthorizedUser()) {
    if (index < 0 || index >= videoLinks.length) return;
    videoLinks.splice(index, 1);
    if (videoLinks.length === 0) {
      currentIndex = -1;
      if (player && typeof player.stopVideo === 'function') player.stopVideo();
      updatePlaybackUIState(false, 'Queue cleared', -1);
    } else if (index === currentIndex) {
      const nextIdx = Math.min(index, videoLinks.length - 1);
      loadLocalVideo(nextIdx);
    } else if (index < currentIndex) {
      currentIndex--;
    }
    initPlaylist();
    updatePlaylistUI();
    return;
  }
  SAS.removeTrack(index);
}

function clearAllTracks() {
  if (!isAuthorizedUser()) {
    if (confirm('Clear your playlist?')) {
      videoLinks = [];
      currentIndex = -1;
      if (player && typeof player.stopVideo === 'function') player.stopVideo();
      updatePlaybackUIState(false, 'Queue cleared', -1);
      initPlaylist();
    }
    return;
  }
  if (confirm('Clear the entire studio queue?')) {
    SAS.clearQueue();
  }
}

function loadDefaultPlaylistAction() {
  if (!isAuthorizedUser()) {
    videoLinks = JSON.parse(JSON.stringify(DEFAULT_TRACKS));
    initPlaylist();
    updatePlaylistUI();
    loadLocalVideo(0);
    return;
  }
  SAS.loadDefaultQueue();
}

function clearPlayedTracks() {
  if (!isAuthorizedUser()) {
    if (currentIndex <= 0) return;
    videoLinks.splice(0, currentIndex);
    currentIndex = 0;
    initPlaylist();
    updatePlaylistUI();
    return;
  }
  if (currentIndex <= 0) return;
  // Remove played tracks up to currentIndex
  for (let i = currentIndex - 1; i >= 0; i--) {
    SAS.removeTrack(i);
  }
}

let isUserAdjustingVolume = false;
let userAdjustingVolumeTimer = null;
let volumeBroadcastThrottleTimer = null;
let volumeBroadcastTrailingTimer = null;
let pendingBroadcastVolume = null;
let lastBroadcastedVolume = null;

function markUserAdjustingVolume() {
  isUserAdjustingVolume = true;
  if (userAdjustingVolumeTimer) clearTimeout(userAdjustingVolumeTimer);
  userAdjustingVolumeTimer = setTimeout(() => {
    isUserAdjustingVolume = false;
  }, 400);
}

function broadcastVolumeThrottled(vol) {
  if (!isAuthorizedUser()) return;
  pendingBroadcastVolume = vol;

  // Always schedule trailing edge to guarantee the final settled value is dispatched
  if (volumeBroadcastTrailingTimer) clearTimeout(volumeBroadcastTrailingTimer);
  volumeBroadcastTrailingTimer = setTimeout(() => {
    if (pendingBroadcastVolume !== null && pendingBroadcastVolume !== lastBroadcastedVolume) {
      lastBroadcastedVolume = pendingBroadcastVolume;
      SAS.setVolume(pendingBroadcastVolume);
    }
    volumeBroadcastTrailingTimer = null;
  }, 160);

  // If currently throttled, wait for the timer to expire
  if (volumeBroadcastThrottleTimer) return;

  // Dispatch initial or interval update
  if (vol !== lastBroadcastedVolume) {
    lastBroadcastedVolume = vol;
    SAS.setVolume(vol);
  }

  volumeBroadcastThrottleTimer = setTimeout(() => {
    volumeBroadcastThrottleTimer = null;
    if (pendingBroadcastVolume !== null && pendingBroadcastVolume !== lastBroadcastedVolume) {
      lastBroadcastedVolume = pendingBroadcastVolume;
      SAS.setVolume(pendingBroadcastVolume);
    }
  }, 120);
}

function flushBroadcastVolume(vol) {
  if (!isAuthorizedUser()) return;
  if (volumeBroadcastTrailingTimer) {
    clearTimeout(volumeBroadcastTrailingTimer);
    volumeBroadcastTrailingTimer = null;
  }
  if (volumeBroadcastThrottleTimer) {
    clearTimeout(volumeBroadcastThrottleTimer);
    volumeBroadcastThrottleTimer = null;
  }
  pendingBroadcastVolume = null;
  lastBroadcastedVolume = vol;
  SAS.setVolume(vol);
}

function syncVolume(level, broadcast = true) {
  const vol = Math.max(0, Math.min(100, parseInt(level, 10) || 0));

  // If this is an incoming server update and user is actively dragging local slider, don't interrupt
  if (!broadcast && isUserAdjustingVolume) {
    return;
  }

  const masterSlider = document.getElementById('master-volume-slider');
  if (masterSlider) masterSlider.value = vol;
  const label = document.getElementById('master-volume-label');
  if (label) label.textContent = vol + '%';

  const remSlider = document.getElementById('remote-volume-slider');
  if (remSlider) remSlider.value = vol;

  const liveVol = document.getElementById('live-status-volume');
  if (liveVol) liveVol.textContent = 'Volume: ' + vol + '%';

  if (player && typeof player.setVolume === 'function') {
    player.setVolume(vol);
  }

  if (broadcast && isAuthorizedUser()) {
    markUserAdjustingVolume();
    broadcastVolumeThrottled(vol);
  }
}

function onMasterVolumeInput(slider) {
  syncVolume(slider.value, true);
}

function onMasterVolumeChange(slider) {
  const vol = Math.max(0, Math.min(100, parseInt(slider.value, 10) || 0));
  flushBroadcastVolume(vol);
}

// Add YouTube Link or Playlist
function extractVideoID(url) {
  if (!url) return null;
  const trimmed = url.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const regExp = /(?:youtu\.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|&v=)([A-Za-z0-9_-]{11})/;
  const match = trimmed.match(regExp);
  return match ? match[1] : null;
}

function extractPlaylistID(text) {
  if (!text) return null;
  // Match ?list=PLAYLIST_ID or &list=PLAYLIST_ID
  const match = text.match(/[?&]list=([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

async function fetchPlaylistViaYTPlayer(playlistId) {
  if (!(window.YT && typeof window.YT.Player === 'function')) {
    for (let i = 0; i < 20; i++) {
      await wait(200);
      if (window.YT && typeof window.YT.Player === 'function') break;
    }
  }
  if (!(window.YT && typeof window.YT.Player === 'function')) return [];

  return new Promise((resolve) => {
    let settled = false;
    let tempPlayer = null;
    let pollTimer = null;
    let timeoutTimer = null;
    let cueRequested = false;

    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;';
    const mount = document.createElement('div');
    host.appendChild(mount);
    document.body.appendChild(host);

    const cleanup = () => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
      if (tempPlayer && typeof tempPlayer.destroy === 'function') {
        try { tempPlayer.destroy(); } catch (_) { }
      }
      tempPlayer = null;
      if (host.parentNode) {
        try { host.parentNode.removeChild(host); } catch (_) { }
      }
    };

    const finish = (ids) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Array.isArray(ids) ? ids : []);
    };

    const checkList = () => {
      if (settled || !tempPlayer || typeof tempPlayer.getPlaylist !== 'function') return false;
      try {
        const list = tempPlayer.getPlaylist();
        if (Array.isArray(list) && list.length > 0) {
          const seen = new Set();
          const valid = [];
          for (const id of list) {
            if (typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id) && !seen.has(id)) {
              seen.add(id);
              valid.push(id);
            }
          }
          if (valid.length > 0) {
            finish(valid);
            return true;
          }
        }
      } catch (_) { }
      return false;
    };

    timeoutTimer = setTimeout(() => {
      if (!checkList()) finish([]);
    }, 10000);

    try {
      const pVars = {
        listType: 'playlist',
        list: playlistId,
        autoplay: 0,
        mute: 1,
        controls: 0
      };
      if (window.location && /^https?:$/i.test(window.location.protocol)) {
        pVars.origin = window.location.origin;
      }

      tempPlayer = new YT.Player(mount, {
        height: '1',
        width: '1',
        playerVars: pVars,
        events: {
          onReady: (e) => {
            try { if (typeof e.target.mute === 'function') e.target.mute(); } catch (_) { }
            if (checkList()) return;
            if (!cueRequested && typeof e.target.cuePlaylist === 'function') {
              cueRequested = true;
              try { e.target.cuePlaylist({ listType: 'playlist', list: playlistId }); } catch (_) { }
            }
            if (!pollTimer) pollTimer = setInterval(checkList, 150);
          },
          onStateChange: () => {
            checkList();
          },
          onError: () => {
            if (!checkList()) {
              setTimeout(() => {
                if (!checkList()) finish([]);
              }, 800);
            }
          }
        }
      });
    } catch (_) {
      finish([]);
    }
  });
}

async function fetchPlaylistViaWorker(playlistId) {
  try {
    if (!SAS || typeof SAS.getWorkerApi !== 'function') return [];
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 8000) : null;
    const res = await fetch(
      `${SAS.getWorkerApi()}/api/playlist?list=${encodeURIComponent(playlistId)}`,
      { signal: controller ? controller.signal : undefined }
    );
    if (timeoutId) clearTimeout(timeoutId);
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data?.videoIds)) {
      return data.videoIds.filter((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id));
    }
    return [];
  } catch (_) {
    return [];
  }
}

async function fetchPlaylistVideoIDs(playlistId) {
  if (!playlistId) return [];
  // Primary: official YouTube IFrame API (works client-side without CORS)
  const ytIds = await fetchPlaylistViaYTPlayer(playlistId);
  if (ytIds.length > 0) return ytIds;

  // Fallback: Worker /api/playlist proxy if deployed
  const workerIds = await fetchPlaylistViaWorker(playlistId);
  if (workerIds.length > 0) return workerIds;

  return [];
}

function extractAllVideoIDs(text) {
  if (!text) return [];
  const ids = [];
  const seen = new Set();
  const trimmed = text.trim();

  // If entire input is a single 11-char ID
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
    return [trimmed];
  }

  // Match all YouTube URLs including shorts, embeds, and standard watch URLs
  const urlRegex = /(?:youtu\.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|&v=)([A-Za-z0-9_-]{11})/g;
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  // Also check whitespace/comma/newline separated tokens for raw IDs
  const tokens = trimmed.split(/[\s,]+/).filter(Boolean);
  for (const token of tokens) {
    if (/^[A-Za-z0-9_-]{11}$/.test(token) && !seen.has(token)) {
      seen.add(token);
      ids.push(token);
    }
  }

  return ids;
}

async function addLink() {
  const input = document.getElementById('link-input');
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) return;
  input.value = '';

  // Delegate to insertTrack which handles single URLs, multiple URLs, and playlists
  await insertTrack(raw);
}

async function insertTrack(rawInput) {
  if (!rawInput) return;

  // Check if input contains a YouTube playlist link
  const playlistId = extractPlaylistID(rawInput);
  if (playlistId) {
    // Also extract any single video ID from the same URL (e.g. watch?v=XXX&list=YYY)
    const singleVideoId = extractVideoID(rawInput);

    // Show loading feedback
    const linkInput = document.getElementById('link-input');
    const remoteLinkInput = document.getElementById('remote-link-input');
    const origPlaceholder = linkInput ? linkInput.placeholder : '';
    const origRemotePlaceholder = remoteLinkInput ? remoteLinkInput.placeholder : '';
    if (linkInput) linkInput.placeholder = 'Loading playlist tracks...';
    if (remoteLinkInput) remoteLinkInput.placeholder = 'Loading playlist tracks...';

    const playlistVideoIDs = await fetchPlaylistVideoIDs(playlistId);

    // Restore placeholders
    if (linkInput) linkInput.placeholder = origPlaceholder;
    if (remoteLinkInput) remoteLinkInput.placeholder = origRemotePlaceholder;

    if (playlistVideoIDs.length > 0) {
      // Use playlist tracks
      if (isAuthorizedUser() && typeof SAS.addTracks === 'function') {
        const batch = playlistVideoIDs.map(id => ({
          videoId: id,
          title: titleCache[id] || "YouTube Track"
        }));
        SAS.addTracks(batch);
      } else if (!isAuthorizedUser()) {
        const wasEmpty = videoLinks.length === 0;
        for (const videoId of playlistVideoIDs) {
          videoLinks.push({
            id: videoId,
            title: titleCache[videoId] || "YouTube Track",
            addedByName: 'You (Guest)',
            isPinned: false,
          });
        }
        initPlaylist();
        updatePlaylistUI();
        if (wasEmpty || currentIndex === -1) {
          loadLocalVideo(0);
        }
        hydrateVideoTitles();
      } else {
        for (const videoId of playlistVideoIDs) {
          const title = await fetchVideoTitle(videoId);
          const trackTitle = title || "YouTube Track";
          SAS.addTrack(videoId, trackTitle);
          if (playlistVideoIDs.length > 1) await wait(80);
        }
      }
      return;
    }

    // Playlist fetch failed — fall back to single video ID if present
    if (singleVideoId) {
      const title = await fetchVideoTitle(singleVideoId);
      const trackTitle = title || "YouTube Track";
      if (!isAuthorizedUser()) {
        addLocalTrack(singleVideoId, trackTitle);
      } else {
        SAS.addTrack(singleVideoId, trackTitle);
      }
      return;
    }

    alert("Could not load playlist. Please check the link and try again.");
    return;
  }

  // Not a playlist — extract individual video IDs
  const validTracks = extractAllVideoIDs(rawInput);

  if (validTracks.length === 0) {
    alert("No valid YouTube video or playlist URLs found.");
    return;
  }

  // If authorized and multiple tracks, use server-side bulk addTracks for atomic ordering
  if (isAuthorizedUser() && typeof SAS.addTracks === 'function' && validTracks.length > 1) {
    const batch = validTracks.map(id => ({
      videoId: id,
      title: titleCache[id] || "YouTube Track"
    }));
    SAS.addTracks(batch);
    // Background title hydration will update any placeholder titles
    return;
  }

  // Process sequentially to preserve order
  for (const videoId of validTracks) {
    const title = await fetchVideoTitle(videoId);
    const trackTitle = title || "YouTube Track";
    if (!isAuthorizedUser()) {
      addLocalTrack(videoId, trackTitle);
    } else {
      SAS.addTrack(videoId, trackTitle);
    }
    // Small delay between adds to ensure server processes them in order
    if (validTracks.length > 1) {
      await wait(80);
    }
  }
}

// YouTube Player Sync Logic (Called on every server state frame)
function applyNowPlayingToPlayer(np) {
  if (!np || !np.videoId) return;

  // Update thumbnail for Admin/Guest regardless of player state
  updateThumbnail(np.videoId);

  // Only Super Admin plays live audio in synchronized room mode.
  // Admins must NEVER play audio from YouTube (Super Admin is the acoustic transmitter).
  if (!isSuperAdmin) {
    if (player && typeof player.pauseVideo === 'function') {
      try {
        player.pauseVideo();
        if (typeof player.mute === 'function') player.mute();
      } catch (_) { }
    }
    return;
  }

  if (!player || !isPlayerReady) return;

  expectedPlaybackState = np.isPlaying ? 'playing' : 'paused';

  // Super Admin always unmuted
  if (typeof player.unMute === 'function') player.unMute();

  // Video track change
  const trackChanged = (np.videoId !== lastLoadedVideoId);
  if (trackChanged) {
    lastLoadedVideoId = np.videoId;
    _trackTransitionGuardUntil = Date.now() + 3500;
    const startSec = Math.floor(SAS.projectedPosition());
    if (np.isPlaying) {
      player.loadVideoById({
        videoId: np.videoId,
        startSeconds: startSec
      });
    } else {
      _ignorePauseProgrammaticUntil = Date.now() + 1500;
      player.cueVideoById({
        videoId: np.videoId,
        startSeconds: startSec
      });
    }
  } else if (typeof player.getPlayerState === 'function') {
    // Play / Pause alignment only when staying on the same track
    // (skip right after loadVideoById/cueVideoById so we don't interrupt YouTube's async load)
    const currentState = player.getPlayerState();
    if (np.isPlaying) {
      if (currentState === YT.PlayerState.ENDED) {
        _trackTransitionGuardUntil = Date.now() + 3000;
        if (typeof player.seekTo === 'function') player.seekTo(0, true);
        player.playVideo();
      } else if (currentState !== YT.PlayerState.PLAYING && currentState !== YT.PlayerState.BUFFERING) {
        _trackTransitionGuardUntil = Date.now() + 2500;
        player.playVideo();
      }
    } else if (!np.isPlaying && (currentState === YT.PlayerState.PLAYING || currentState === YT.PlayerState.BUFFERING)) {
      _ignorePauseProgrammaticUntil = Date.now() + 1500;
      player.pauseVideo();
    }
  }

  if (typeof player.setVolume === 'function') {
    player.setVolume(np.volume);
  }
}

// Thumbnail Display for Admin/Guest (no live video, just artwork)
function updateThumbnail(videoId) {
  if (!videoId) return;
  if (videoId === currentThumbnailVideoId) return; // avoid redundant updates
  currentThumbnailVideoId = videoId;

  const img = document.getElementById('thumbnail-img');
  if (img) {
    // Try maxresdefault first, fallback to hqdefault
    img.onerror = function () {
      this.onerror = null;
      this.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    };
    img.src = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  }
}

// Toggle YT Player vs Thumbnail based on role
function applyRoleBasedVideoDisplay() {
  const overlay = document.getElementById('thumbnail-overlay');
  const ytFrame = document.getElementById('yt-iframe');
  const badge = document.getElementById('thumbnail-role-badge');
  const progressOverlay = document.getElementById('thumb-progress-overlay');

  // Toggle seekable class on the progress overlay based on role
  if (progressOverlay) {
    if (isSuperAdmin || (isAdmin && deviceStatus !== 'revoked')) {
      progressOverlay.classList.add('seekable');
    } else {
      progressOverlay.classList.remove('seekable');
    }
  }

  if (isSuperAdmin || currentUserRole === 'guest') {
    // Super Admin & Guest: show live YT player, hide thumbnail, show timer in deck-top-row
    if (overlay) overlay.classList.add('hidden');
    if (ytFrame) ytFrame.style.display = '';
    setDeckTimerVisible(true);
    return;
  }

  // Admin / Pending: show thumbnail, hide YT iframe, hide timer in deck-top-row
  if (overlay) overlay.classList.remove('hidden');
  if (ytFrame) ytFrame.style.display = 'none';
  setDeckTimerVisible(false);

  // Stop any lingering audio from hidden player in Admin/Pending mode
  if (player) {
    try {
      if (typeof player.pauseVideo === 'function') player.pauseVideo();
      if (typeof player.mute === 'function') player.mute();
    } catch (_) { }
  }

  // Update role badge text and styling
  if (badge) {
    badge.classList.remove('role-admin', 'role-guest', 'role-pending');
    const icon = badge.querySelector('i');
    const label = badge.querySelector('span');

    if (currentUserRole === 'admin') {
      badge.classList.add('role-admin');
      if (icon) icon.className = 'fas fa-headset';
      if (label) label.textContent = 'Admin — Remote Control';
    } else {
      badge.classList.add('role-pending');
      if (icon) icon.className = 'fas fa-hourglass-half';
      if (label) label.textContent = 'Pending Approval';
    }
  }

  // Set initial thumbnail if we have a current track
  const np = SAS.state?.nowPlaying;
  if (np && np.videoId) {
    updateThumbnail(np.videoId);
  }
}

// Drift Correction and Duration Sync for client devices
function onServerTick({ positionSec, durationSec }) {
  if (!isAuthorizedUser()) return; // Guests have their own local player & timer
  if (typeof durationSec === 'number' && durationSec > 0) {
    serverDuration = durationSec;
  }
  // Admin devices mirror host deck position and duration
  if (!isSuperAdmin) {
    updateTrackTimerDisplay();
  }
}

// Dedicated seek event handler (fires immediately when any admin/super_admin scrubs)
function onServerSeek({ positionSec, durationSec, actorName, eventId }) {
  const pos = Number(positionSec);
  if (!Number.isFinite(pos) || pos < 0) return;
  if (typeof durationSec === 'number' && durationSec > 0) {
    serverDuration = durationSec;
  }
  _hostSeekCooldownUntil = Date.now() + 3000;
  _lastHostReportedSec = pos;

  // Super Admin: actively playing acoustic deck — jump YouTube player only if not already near target
  if (isSuperAdmin && player && isPlayerReady && typeof player.seekTo === 'function') {
    const cur = (typeof player.getCurrentTime === 'function') ? (player.getCurrentTime() || 0) : 0;
    if (Math.abs(cur - pos) > 0.5) {
      player.seekTo(pos, true);
    }
    const dur = (typeof player.getDuration === 'function') ? (player.getDuration() || 0) : 0;
    if (typeof SAS.hostTick === 'function') {
      SAS.hostTick(pos, dur);
    }
  }
  updateTrackTimerDisplay();

  const evId = eventId || ('seek-' + Date.now());
  const actor = actorName || (isSuperAdmin ? 'Super Admin' : 'Admin');
  const seekEv = {
    id: evId,
    type: 'seek',
    actorName: actor,
    detail: 'Seeked Track',
    at: Date.now()
  };

  // Immediate insertion into Activity Radar stream (prevent duplicates via eventId)
  if (isAuthorizedUser()) {
    const stream = document.getElementById('live-activity-stream');
    if (stream && !seenEventIds.has(evId)) {
      seenEventIds.add(evId);
      const card = buildActivityCard(seekEv);
      stream.insertBefore(card, stream.firstChild);
      while (stream.children.length > 25) {
        stream.removeChild(stream.lastChild);
      }
    }
  }

  // Toast popup notification for other users
  if (actor !== getDeviceName()) {
    showEventToast(seekEv);
  }
}

// Host publishes position tick twice per second to all connected devices
let _lastHostReportedSec = 0;
let _hostSeekCooldownUntil = 0;

setInterval(() => {
  if (isSuperAdmin && player && isPlayerReady && typeof player.getCurrentTime === 'function' && typeof player.getPlayerState === 'function') {
    if (player.getPlayerState() === YT.PlayerState.PLAYING) {
      const cur = player.getCurrentTime() || 0;
      const dur = (typeof player.getDuration === 'function') ? (player.getDuration() || 0) : 0;

      const isCooldown = Date.now() < _hostSeekCooldownUntil;
      // If in cooldown and player hasn't caught up to target yet, do not tick stale position
      if (isCooldown && Math.abs(cur - _lastHostReportedSec) > 1.5) {
        return;
      }

      _lastHostReportedSec = cur;
      SAS.hostTick(cur, dur);
    }
  }
}, 500);

// Single Reactive State Receiver — replaces all Firebase database listeners
function applyState(s) {
  if (!s) return;

  // 1. User Identity and Roles — process FIRST so role flags are set before UI updates
  if (s.you) {
    deviceId = s.you.deviceId;
    currentUserRole = s.you.role || 'guest';
    deviceStatus = s.you.status || (currentUserRole === 'pending' ? 'pending' : (currentUserRole === 'admin' ? 'approved' : 'guest'));
    isAdmin = (currentUserRole === 'admin' || currentUserRole === 'super_admin');
    isSuperAdmin = (currentUserRole === 'super_admin');

    // Apply role-based and status body class for CSS-level control lockout
    document.body.classList.remove('role-super_admin', 'role-admin', 'role-guest', 'role-pending', 'status-revoked');
    document.body.classList.add(`role-${currentUserRole}`);
    if (deviceStatus === 'revoked') {
      document.body.classList.add('status-revoked');
    }

    updateAccessUI(deviceStatus);
    updateControlAccessUI();
    applyRoleBasedVideoDisplay();

    // If role is super_admin or guest and YT player not yet initialized, init now
    if ((isSuperAdmin || currentUserRole === 'guest') && !player && ytApiReady) {
      initYouTubePlayer();
    }
  }

  // Guests or Pending users: do not overwrite local queue, nowPlaying, fleet, or activity.
  // Revoked Admins are still studio members — they see the studio (read-only) but cannot control.
  if (!isStudioMember()) {
    renderAdminDeviceList([]);
    renderActivityStream([]);
    return;
  }

  // 2. Queue Update (Authorized studio users only)
  if (Array.isArray(s.queue)) {
    videoLinks = s.queue;
    initPlaylist();
    updatePlaylistUI();
    hydrateVideoTitles();
  }

  // 3. Now Playing Update (Authorized studio users only)
  if (s.nowPlaying) {
    if (typeof s.nowPlaying.durationSec === 'number' && s.nowPlaying.durationSec > 0) {
      serverDuration = s.nowPlaying.durationSec;
    }
    currentIndex = s.nowPlaying.index;
    const currentTrack = videoLinks[currentIndex];
    const title = currentTrack?.title || (currentIndex === -1 ? 'Queue cleared' : 'Select a track to begin');

    updatePlaybackUIState(s.nowPlaying.isPlaying, title, currentIndex);
    syncVolume(s.nowPlaying.volume, /* broadcast= */ false);
    applyNowPlayingToPlayer(s.nowPlaying);
  }

  // 4. Fleet Devices (Authorized studio users only)
  if (Array.isArray(s.devices)) {
    renderAdminDeviceList(s.devices);
  }

  // 5. Authenticated Activity Radar (Authorized studio users only)
  if (Array.isArray(s.activity)) {
    renderActivityStream(s.activity);
  }
}

function onActionDenied(action) {
  showConnectionBadge('denied', `Action not permitted: ${action}`);
}

function onConnectionStatus(status) {
  const badge = document.getElementById('connection-badge');
  const text = document.getElementById('connection-status-text');
  const chipText = document.getElementById('telemetry-status-text');

  if (status === 'connected') {
    if (chipText) chipText.textContent = 'DO: 12ms • Synced';
    if (badge && text) {
      text.textContent = 'Connected to Cloudflare Durable Object';
      badge.classList.remove('hidden', 'error');
      setTimeout(() => badge.classList.add('hidden'), 3000);
    }
  } else if (status === 'reconnecting') {
    if (chipText) chipText.textContent = 'DO: Reconnecting...';
  } else {
    if (chipText) chipText.textContent = 'DO: Offline';
    if (badge && text) {
      text.textContent = 'Connection Offline';
      badge.classList.remove('hidden');
      badge.classList.add('error');
    }
  }
}

function showConnectionBadge(type, message = null) {
  const badge = document.getElementById('connection-badge');
  const text = document.getElementById('connection-status-text');
  if (!badge) return;

  badge.classList.remove('hidden', 'error');
  if (type === 'connected') {
    if (text) text.textContent = message || 'Connected to Realtime Station';
  } else if (type === 'denied') {
    badge.classList.add('error');
    if (text) text.textContent = message || 'Action Denied';
  } else {
    badge.classList.add('error');
    if (text) text.textContent = message || 'Connection Offline';
  }
  setTimeout(() => { badge.classList.add('hidden'); }, 3500);
}

// Device Fleet & Admin Panel Rendering
function isStudioMember() {
  return isSuperAdmin || (isAdmin && currentUserRole === 'admin');
}

function isAuthorizedUser() {
  return isSuperAdmin || (isAdmin && currentUserRole === 'admin' && deviceStatus !== 'revoked');
}

function isAutoGeneratedBrowserName(name) {
  const n = String(name || '').trim();
  if (!n) return false;
  return /^(Browser|Brave|Edge|Chrome|Firefox|Safari)\s*-\s*(PC|Android|iOS|Mac|Windows)$/i.test(n) || /^Guest Device$/i.test(n);
}

function getDeviceName() {
  const saved = localStorage.getItem('sas_device_name') || '';
  if (saved && !isAutoGeneratedBrowserName(saved)) return saved;
  const serverName = SAS.state?.you?.name || '';
  return isAutoGeneratedBrowserName(serverName) ? '' : serverName;
}

function renderAdminDeviceList(devices) {
  const listEl = document.getElementById('admin-device-list');
  const fleetEl = document.getElementById('fleet-device-list');
  const fleetCountEl = document.getElementById('fleet-count-badge');

  // Guests only see their own local standalone player node
  if (!isAuthorizedUser()) {
    if (fleetCountEl) fleetCountEl.textContent = '1';
    if (fleetEl) {
      fleetEl.innerHTML = `
        <div class="device-node-card">
          <div class="device-node-top">
            <div class="device-node-identity"><i class="fas fa-headphones" style="color: var(--accent-cyan);"></i> <span>Local Player</span> <span style="font-size:10px;color:var(--text-muted);">(You)</span></div>
            <span class="device-role-pill guest">STANDALONE</span>
          </div>
          <div class="device-node-stats-row"><span>Standalone Player</span><span style="color: var(--accent-green);">● Local Only</span></div>
        </div>`;
    }
    if (listEl) {
      listEl.innerHTML = '<div class="admin-no-devices" style="text-align:center; padding:20px; color:var(--text-muted);">Admin access required to view fleet registry.</div>';
    }
    return;
  }

  const entries = devices || [];
  if (fleetCountEl) fleetCountEl.textContent = entries.length || '1';

  // Update Notification Dot and Pending Badge Count for Super Admin
  const pendingEntries = entries.filter((d) => (d.role === 'pending' || d.status === 'pending') && d.deviceId !== deviceId);
  const pendingCount = pendingEntries.length;
  const notifDot = document.querySelector('.admin-panel-btn .notif-dot');
  if (notifDot) notifDot.classList.toggle('visible', isSuperAdmin && pendingCount > 0);
  const pendingBadge = document.getElementById('pending-badge');
  if (pendingBadge) {
    pendingBadge.textContent = pendingCount;
    pendingBadge.classList.toggle('hidden', !isSuperAdmin || pendingCount === 0);
  }

  // Render Right-Pane Fleet Monitor
  if (fleetEl) {
    if (entries.length === 0) {
      fleetEl.innerHTML = `
        <div class="device-node-card host-transmitter">
          <div class="device-node-top">
            <div class="device-node-identity"><i class="fas fa-desktop" style="color: var(--accent-gold);"></i> <span>Host Master PC</span></div>
            <span class="device-role-pill super-admin">SUPER ADMIN</span>
          </div>
          <div class="device-node-stats-row"><span>Audio Transmitter</span><span style="color: var(--accent-green);">● Active</span></div>
        </div>`;
    } else {
      fleetEl.innerHTML = entries.map((dev) => {
        const isSelf = dev.deviceId === deviceId;
        const role = dev.role || 'guest';
        const status = dev.status || (role === 'pending' ? 'pending' : (role === 'admin' ? 'approved' : 'guest'));
        const isHost = (role === 'super_admin');
        const icon = isHost ? 'fa-desktop' : (dev.name && dev.name.toLowerCase().includes('phone') ? 'fa-mobile-alt' : 'fa-laptop');

        let statusDot = '● Active';
        let statusColor = 'var(--accent-green)';
        if (role === 'pending' || status === 'pending') {
          statusDot = '● Pending Request';
          statusColor = '#f39c12';
        } else if (role === 'admin' && status === 'revoked') {
          statusDot = '● Controls Revoked';
          statusColor = '#e74c3c';
        }

        return `
          <div class="device-node-card ${isHost ? 'host-transmitter' : ''} ${status === 'revoked' ? 'revoked' : ''}">
            <div class="device-node-top">
              <div class="device-node-identity">
                <i class="fas ${icon}" style="${isHost ? 'color: var(--accent-gold);' : ''}"></i>
                <span>${escapeHtml(dev.name || 'Device')}</span>
                ${isSelf ? '<span style="font-size:10px;color:var(--text-muted);">(You)</span>' : ''}
              </div>
              <span class="device-role-pill ${role}">${escapeHtml(role.replace('_', ' '))}</span>
            </div>
            <div class="device-node-stats-row">
              <span>${isHost ? 'Host Master' : 'Client Node'}</span>
              <span style="color: ${statusColor};">${statusDot}</span>
            </div>
          </div>`;
      }).join('');
    }
  }

  // Render Modal Device List
  if (listEl) {
    if (entries.length === 0) {
      listEl.innerHTML = '<div class="admin-no-devices" style="text-align:center; padding:20px; color:var(--text-muted);">No devices connected yet.</div>';
      return;
    }

    listEl.innerHTML = entries.map((dev) => {
      const isSelf = dev.deviceId === deviceId;
      const targetRole = dev.role || 'guest';
      const targetStatus = dev.status || (targetRole === 'pending' ? 'pending' : (targetRole === 'admin' ? 'approved' : 'guest'));
      const isTargetSuperAdmin = targetRole === 'super_admin';
      const isTargetAdmin = targetRole === 'admin';
      const isPending = (targetRole === 'pending' || targetStatus === 'pending');
      const isRevoked = (isTargetAdmin && targetStatus === 'revoked');

      let actionsHtml = '';
      if (!isSelf && isSuperAdmin && !isTargetSuperAdmin) {
        actionsHtml += '<div class="device-actions">';
        if (isPending) {
          // 1. Pending Admin Access Request: Super Admin sees Approve (grants them Admin role already!)
          actionsHtml += `<button class="approve-btn" onclick="SAS.setDeviceRole('${escapeHtml(dev.deviceId)}', 'admin', 'approved')"><i class="fas fa-check"></i> Approve</button>`;
        } else if (isTargetAdmin) {
          // 2. User has Admin role:
          if (isRevoked) {
            // Revoked Admin: Super Admin can restore controls (Grant = give controls back)
            actionsHtml += `<button class="approve-btn" onclick="SAS.setDeviceRole('${escapeHtml(dev.deviceId)}', 'admin', 'approved')"><i class="fas fa-check-circle"></i> Grant</button>`;
          } else {
            // Active Admin: Super Admin can Revoke (keep Admin role, take back controls)
            actionsHtml += `<button class="revoke-btn" onclick="SAS.setDeviceRole('${escapeHtml(dev.deviceId)}', 'admin', 'revoked')"><i class="fas fa-ban"></i> Revoke</button>`;
          }
          // Demote removes that user from Admin role (reverts to guest)
          actionsHtml += `<button class="demote-btn" onclick="SAS.setDeviceRole('${escapeHtml(dev.deviceId)}', 'guest', 'guest')"><i class="fas fa-user-minus"></i> Demote</button>`;
        } else {
          // 3. Guest device: Super Admin can promote directly to Admin
          actionsHtml += `<button class="promote-btn" onclick="SAS.setDeviceRole('${escapeHtml(dev.deviceId)}', 'admin', 'approved')"><i class="fas fa-user-shield"></i> Make Admin</button>`;
        }
        actionsHtml += `<button class="revoke-btn delete-btn" title="Remove Device" onclick="SAS.removeDevice('${escapeHtml(dev.deviceId)}')"><i class="fas fa-trash"></i></button>`;
        actionsHtml += '</div>';
      }

      const badgeClass = isPending ? 'pending' : (isRevoked ? 'revoked' : 'approved');
      const badgeText = isPending ? 'pending' : (isRevoked ? 'revoked' : (isTargetAdmin ? 'approved' : 'active'));

      return `
        <div class="device-card ${escapeHtml(targetRole)} ${isRevoked ? 'revoked' : ''}">
          <div class="device-info">
            <div class="device-name">
              ${escapeHtml(dev.name || 'Unknown Device')} ${isSelf ? '<span style="font-size:10px;color:var(--text-muted);margin-left:6px;">(You)</span>' : ''}
              <span class="device-role-pill ${targetRole}" style="margin-left:8px;">${escapeHtml(targetRole.replace('_', ' '))}</span>
            </div>
            <div class="device-meta">
              <span class="device-status-badge ${badgeClass}">${escapeHtml(badgeText)}</span>
              <span class="device-id-text">${escapeHtml(dev.deviceId ? dev.deviceId.substring(0, 16) : '')}...</span>
            </div>
          </div>
          ${actionsHtml}
        </div>`;
    }).join('');
  }
}

function updateAccessUI(status) {
  const btn = document.getElementById('request-access-btn');
  const panel = document.getElementById('remote-control-panel');
  const stickyBtn = document.getElementById('sticky-remote-btn');
  if (!btn) return;

  btn.classList.remove('pending', 'revoked');
  const isAuth = (status === 'approved' || isAdmin || isSuperAdmin) && status !== 'revoked';

  if (status === 'revoked') {
    btn.classList.add('revoked');
    btn.querySelector('span').textContent = 'Revoked';
    if (panel) panel.classList.add('hidden');
    if (stickyBtn) stickyBtn.classList.add('hidden');
  } else if (isAuth) {
    btn.querySelector('span').textContent = 'Remote';
    // Do not force-open remote panel on state updates! Respect current minimized/open state.
    if (!remotePanelMinimized && panel && !panel.classList.contains('hidden')) {
      panel.classList.remove('hidden');
      if (stickyBtn) stickyBtn.classList.add('hidden');
    } else {
      if (panel) panel.classList.add('hidden');
      if (stickyBtn) stickyBtn.classList.remove('hidden');
    }
  } else if (status === 'pending') {
    btn.classList.add('pending');
    btn.querySelector('span').textContent = 'Pending';
    if (panel) panel.classList.add('hidden');
    if (stickyBtn) stickyBtn.classList.add('hidden');
  } else {
    // Standalone Guest: remote panel and sticky button are strictly hidden
    btn.querySelector('span').textContent = 'Remote';
    if (panel) panel.classList.add('hidden');
    if (stickyBtn) stickyBtn.classList.add('hidden');
  }
}

function applyRoleHeaderUI() {
  const isSuper = (currentUserRole === 'super_admin');
  const adminBtn = document.getElementById('admin-panel-btn');
  const workerBtn = document.getElementById('worker-settings-btn');
  const fleetControls = document.querySelector('.fleet-card .pane-controls');

  if (adminBtn) adminBtn.style.display = isSuper ? 'inline-flex' : 'none';
  if (workerBtn) workerBtn.style.display = isSuper ? 'inline-flex' : 'none';
  if (fleetControls) fleetControls.style.display = isSuper ? 'flex' : 'none';

  const chip = document.getElementById('system-status-chip');
  if (chip) {
    chip.style.cursor = isSuper ? 'pointer' : 'default';
  }
}

function updateControlAccessUI() {
  applyRoleHeaderUI();
  const isPending = (currentUserRole === 'pending');
  const isRevoked = (deviceStatus === 'revoked');
  // Standalone Guest and Admins have playback & queue interactivity!
  // Pending access requests or revoked status lock controls.
  const allowTransport = !isPending && !isRevoked;
  const allowQueue = !isPending && !isRevoked;
  const allowAdd = !isPending && !isRevoked;

  // Local transport controls (Play/Pause, Slider, Track Cards)
  const localTransportSelectors = [
    '#master-volume-slider',
    '.transport-btn',
    '#play-pause-btn'
  ];
  document.querySelectorAll(localTransportSelectors.join(',')).forEach((el) => {
    el.disabled = !allowTransport;
    el.style.opacity = allowTransport ? '' : '0.35';
    el.style.cursor = allowTransport ? '' : 'not-allowed';
  });

  // Spinning disk click
  const spinningDisk = document.getElementById('spinning-disk');
  if (spinningDisk) spinningDisk.style.cursor = allowTransport ? 'pointer' : 'not-allowed';

  // Remote floating buttons: only for authorized admin/super_admin
  const remoteSelectors = [
    '#remote-volume-slider',
    '.remote-btn',
    '#remote-play-pause',
    '#remote-prev',
    '#remote-next'
  ];
  const canRemote = isAuthorizedUser();
  document.querySelectorAll(remoteSelectors.join(',')).forEach((el) => {
    el.disabled = !canRemote;
    el.style.opacity = canRemote ? '' : '0.35';
    el.style.cursor = canRemote ? '' : 'not-allowed';
  });

  // Queue management: clear, restore, sweep
  const queueSelectors = ['.queue-actions button'];
  document.querySelectorAll(queueSelectors.join(',')).forEach((el) => {
    el.disabled = !allowQueue;
    el.style.opacity = allowQueue ? '' : '0.35';
    el.style.cursor = allowQueue ? '' : 'not-allowed';
  });

  // Add track inputs
  const addSelectors = ['#link-input', '#remote-link-input', '#remote-add-btn'];
  document.querySelectorAll(addSelectors.join(',')).forEach((el) => {
    el.disabled = !allowAdd;
    el.style.opacity = allowAdd ? '' : '0.35';
    el.style.cursor = allowAdd ? '' : 'not-allowed';
  });

  // Track card actions (pin/remove)
  document.querySelectorAll('.track-card-actions').forEach((el) => {
    el.style.display = allowQueue ? '' : 'none';
  });
}

// Remote Panel Toggle
let remotePanelMinimized = true;

function minimizeRemotePanel() {
  const panel = document.getElementById('remote-control-panel');
  const stickyBtn = document.getElementById('sticky-remote-btn');
  if (panel) panel.classList.add('hidden');
  if (stickyBtn && isAuthorizedUser()) {
    stickyBtn.classList.remove('hidden');
  }
  remotePanelMinimized = true;
}

function openRemotePanel() {
  const panel = document.getElementById('remote-control-panel');
  const stickyBtn = document.getElementById('sticky-remote-btn');
  if (panel) panel.classList.remove('hidden');
  if (stickyBtn) stickyBtn.classList.add('hidden');
  remotePanelMinimized = false;
}

function toggleRemotePanel(forceState) {
  const panel = document.getElementById('remote-control-panel');
  if (!panel) return;

  if (typeof forceState === 'boolean') {
    if (forceState) openRemotePanel();
    else minimizeRemotePanel();
    return;
  }

  if (!panel.classList.contains('hidden')) {
    minimizeRemotePanel();
  } else {
    openRemotePanel();
  }
}

// Modals: Access, Admin Panel, Worker Settings
function openAccessModal() {
  const isRevoked = (currentUserRole === 'admin' && deviceStatus === 'revoked');
  const isApproved = (currentUserRole === 'admin' || currentUserRole === 'super_admin' || deviceStatus === 'approved') && !isRevoked;
  const isPending = (currentUserRole === 'pending' || deviceStatus === 'pending');
  const requestView = document.getElementById('access-modal-request-view');
  const approvedView = document.getElementById('access-modal-approved-view');
  const pendingView = document.getElementById('access-modal-pending-view');
  const revokedView = document.getElementById('access-modal-revoked-view');
  const footer = document.getElementById('access-modal-footer');
  const approvedNameEl = document.getElementById('access-modal-user-name');
  const pendingNameEl = document.getElementById('access-modal-pending-name');
  const revokedNameEl = document.getElementById('access-modal-revoked-name');

  const rawSaved = localStorage.getItem('sas_device_name') || '';
  const cleanSaved = isAutoGeneratedBrowserName(rawSaved) ? '' : rawSaved;
  const currentName = cleanSaved || SAS.state?.you?.name || 'Unnamed';

  if (isRevoked) {
    if (requestView) requestView.classList.add('hidden');
    if (approvedView) approvedView.classList.add('hidden');
    if (pendingView) pendingView.classList.add('hidden');
    if (revokedView) revokedView.classList.remove('hidden');
    if (footer) footer.classList.add('hidden');
    if (revokedNameEl) revokedNameEl.textContent = currentName;
  } else if (isApproved) {
    if (requestView) requestView.classList.add('hidden');
    if (pendingView) pendingView.classList.add('hidden');
    if (revokedView) revokedView.classList.add('hidden');
    if (approvedView) approvedView.classList.remove('hidden');
    if (footer) footer.classList.add('hidden');
    if (approvedNameEl) approvedNameEl.textContent = currentName;
    const rolePill = document.getElementById('access-modal-role-pill');
    if (rolePill) {
      rolePill.className = `device-role-pill ${isSuperAdmin ? 'super-admin' : 'admin'}`;
      rolePill.innerHTML = isSuperAdmin
        ? '<i class="fas fa-crown"></i> Super Admin'
        : '<i class="fas fa-shield-alt"></i> Approved Admin';
    }
  } else if (isPending) {
    if (requestView) requestView.classList.add('hidden');
    if (approvedView) approvedView.classList.add('hidden');
    if (revokedView) revokedView.classList.add('hidden');
    if (pendingView) pendingView.classList.remove('hidden');
    if (footer) footer.classList.add('hidden');
    if (pendingNameEl) pendingNameEl.textContent = currentName;
  } else {
    // Guest requesting access
    if (requestView) requestView.classList.remove('hidden');
    if (approvedView) approvedView.classList.add('hidden');
    if (pendingView) pendingView.classList.add('hidden');
    if (revokedView) revokedView.classList.add('hidden');
    if (footer) footer.classList.remove('hidden');
    const input = document.getElementById('device-name-input');
    if (input) input.value = cleanSaved;
  }

  document.getElementById('access-request-overlay')?.classList.remove('hidden');
}

function closeAccessModal() {
  document.getElementById('access-request-overlay')?.classList.add('hidden');
}

function closeAccessModalOnBackdrop(e) {
  if (e.target === e.currentTarget) closeAccessModal();
}

async function requestAccess() {
  const nameInput = document.getElementById('device-name-input');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) { alert('Please enter your name.'); return; }
  localStorage.setItem('sas_device_name', name);

  try {
    await SAS.ensureSession(name);
    SAS.requestAccess(name);
    currentUserRole = 'pending';
    deviceStatus = 'pending';
    document.body.classList.remove('role-super_admin', 'role-admin', 'role-guest');
    document.body.classList.add('role-pending');
    updateAccessUI('pending');
    updateControlAccessUI();
    applyRoleBasedVideoDisplay();
    closeAccessModal();
    alert('Access requested! The host admin can approve you in the admin panel.');
  } catch (err) {
    alert('Could not send access request to station: ' + err.message);
  }
}

async function changeMyDisplayName() {
  const rawSaved = localStorage.getItem('sas_device_name') || '';
  const current = isAutoGeneratedBrowserName(rawSaved) ? '' : (rawSaved || SAS.state?.you?.name || '');
  const entered = prompt('Enter your display name:', current);
  if (entered === null) return;
  const finalName = entered.trim();
  if (!finalName) {
    alert('Please enter a valid display name.');
    return;
  }
  localStorage.setItem('sas_device_name', finalName);
  try {
    await SAS.ensureSession(finalName);
    SAS.disconnect();
    SAS.connect();
  } catch (_) { }
  const approvedNameEl = document.getElementById('access-modal-user-name');
  if (approvedNameEl) approvedNameEl.textContent = finalName;
}

async function promptAdminPassphrase() {
  const entered = prompt('Enter Access Passphrase:');
  if (!entered) return;

  try {
    const res = await SAS.elevate(entered.trim());
    if (res.ok) {
      // Always let Super Admin / Admin set their own name — never assume a browser/device name
      const rawSaved = localStorage.getItem('sas_device_name') || '';
      const prefill = isAutoGeneratedBrowserName(rawSaved) ? '' : rawSaved;
      let finalName = '';
      while (!finalName) {
        const nameInput = prompt('Set your display name for this session:', prefill);
        if (nameInput === null) break;
        const cleaned = nameInput.trim();
        if (cleaned) {
          finalName = cleaned;
        } else {
          alert('Please enter a valid display name.');
        }
      }
      if (finalName) {
        localStorage.setItem('sas_device_name', finalName);
        try { await SAS.ensureSession(finalName); } catch (_) { }
        // Reconnect WebSocket with refreshed token so DO immediately updates fleet & activity name
        SAS.disconnect();
        SAS.connect();
      }
      applyElevationResult(res.role);
    } else {
      alert(res.error ? `Authentication failed (${res.error}). Please check your passphrase.` : 'Invalid Passphrase.');
    }
  } catch (err) {
    alert('Connection error contacting Cloudflare Worker: ' + err.message);
  }
}

function applyElevationResult(role) {
  currentUserRole = role;
  isAdmin = (role === 'admin' || role === 'super_admin');
  isSuperAdmin = (role === 'super_admin');
  deviceStatus = 'approved';

  // Apply role class and update all UI
  document.body.classList.remove('role-super_admin', 'role-admin', 'role-guest', 'role-pending');
  document.body.classList.add(`role-${currentUserRole}`);
  updateAccessUI('approved');
  updateControlAccessUI();
  applyRoleBasedVideoDisplay();

  // If promoted to Super Admin, init YT player now
  if (isSuperAdmin && !player && ytApiReady) {
    initYouTubePlayer();
  }

  if (isSuperAdmin) {
    showAdminPanelModal();
  }
}

async function openAdminPanel() {
  if (isSuperAdmin) {
    showAdminPanelModal();
    return;
  }
  promptAdminPassphrase();
}

function showAdminPanelModal() {
  const overlay = document.getElementById('admin-panel-overlay');
  if (overlay) overlay.classList.remove('hidden');
  renderAdminDeviceList(SAS.state.devices);
}

function closeAdminPanel() {
  document.getElementById('admin-panel-overlay')?.classList.add('hidden');
}

function closeAdminPanelOnBackdrop(e) {
  if (e.target === e.currentTarget) closeAdminPanel();
}

function logoutAdmin() {
  if (confirm('Are you sure you want to exit admin mode?')) {
    localStorage.removeItem('sas_token');
    localStorage.removeItem('sas_role_hint');
    localStorage.removeItem('sas_elev_cred');
    localStorage.removeItem('sas_user_role');
    closeAdminPanel();
    location.reload();
  }
}

function clearAllOtherDevices() {
  if (!isSuperAdmin) return;
  if (!confirm('Remove all client devices from the registry?')) return;
  SAS.state.devices.forEach((d) => {
    if (d.deviceId !== deviceId) {
      SAS.removeDevice(d.deviceId);
    }
  });
}

function openWorkerSettingsModal() {
  if (!isSuperAdmin) return;
  const overlay = document.getElementById('worker-settings-overlay');
  const input = document.getElementById('worker-url-input');
  if (input) {
    input.value = localStorage.getItem('sas_worker_api') || '';
  }
  if (overlay) overlay.classList.remove('hidden');
}

function closeWorkerSettingsModal() {
  document.getElementById('worker-settings-overlay')?.classList.add('hidden');
}

function closeWorkerSettingsModalOnBackdrop(e) {
  if (e.target === e.currentTarget) closeWorkerSettingsModal();
}

function saveWorkerSettings() {
  const input = document.getElementById('worker-url-input');
  const val = input ? input.value.trim() : '';
  SAS.setWorkerApi(val);
  closeWorkerSettingsModal();
  showConnectionBadge('connected', 'Worker URL updated — reconnecting...');
}

// Media Session & PiP Mini Player
function initMediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.setActionHandler('play', toggleMainPlayback);
  navigator.mediaSession.setActionHandler('pause', toggleMainPlayback);
  navigator.mediaSession.setActionHandler('nexttrack', playNext);
  navigator.mediaSession.setActionHandler('previoustrack', playPrev);
}

function updateMediaSession(title, artist) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: title || 'SAS Premium Player',
    artist: artist || 'SAS Studio Deck',
    album: 'Master Queue'
  });
}

let _pipWindow = null;
function initPiPButton() {
  if (!('documentPictureInPicture' in window)) return;
  const btn = document.getElementById('pip-btn');
  if (btn) btn.classList.remove('hidden');
}

async function openMiniPlayer() {
  if (!('documentPictureInPicture' in window)) {
    alert('Picture-in-Picture requires Chrome or Edge 116+');
    return;
  }
  if (_pipWindow && !_pipWindow.closed) {
    _pipWindow.close();
    _pipWindow = null;
    return;
  }

  try {
    _pipWindow = await window.documentPictureInPicture.requestWindow({ width: 320, height: 200 });
    [...document.styleSheets].forEach((sheet) => {
      try {
        if (sheet.href) {
          const link = _pipWindow.document.createElement('link');
          link.rel = 'stylesheet';
          link.href = sheet.href;
          _pipWindow.document.head.appendChild(link);
        }
      } catch (_) { }
    });

    const currentTitle = document.getElementById('current-title').innerText || 'SAS Player';
    _pipWindow.document.body.innerHTML = `
      <div style="padding:16px; background:#0a0a0f; color:#fff; font-family:sans-serif; text-align:center; height:100vh; display:flex; flex-direction:column; justify-content:center; gap:12px;">
        <div style="font-size:11px; color:#e50914; font-weight:700;">▶ SAS STUDIO MINI-DECK</div>
        <div style="font-size:14px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(currentTitle)}</div>
        <div style="display:flex; justify-content:center; gap:14px;">
          <button id="pip-prev" style="background:#222; border:none; color:#fff; padding:8px 14px; border-radius:50%; cursor:pointer;"><i class="fas fa-step-backward"></i></button>
          <button id="pip-play" style="background:#e50914; border:none; color:#fff; padding:10px 16px; border-radius:50%; cursor:pointer;"><i class="fas fa-play"></i></button>
          <button id="pip-next" style="background:#222; border:none; color:#fff; padding:8px 14px; border-radius:50%; cursor:pointer;"><i class="fas fa-step-forward"></i></button>
        </div>
      </div>
    `;

    _pipWindow.document.getElementById('pip-play').onclick = toggleMainPlayback;
    _pipWindow.document.getElementById('pip-next').onclick = playNext;
    _pipWindow.document.getElementById('pip-prev').onclick = playPrev;
  } catch (_) {
    // PiP is non-fatal — silently swallow
  }
}

// Background Visibility Recovery
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !player) return;

  if (isSuperAdmin) {
    setTimeout(() => {
      if (!player || typeof player.getPlayerState !== 'function') return;
      const currentState = player.getPlayerState();
      if (expectedPlaybackState === 'playing' &&
        SAS.state?.nowPlaying?.isPlaying &&
        currentState !== YT.PlayerState.PLAYING &&
        currentState !== YT.PlayerState.BUFFERING) {
        try { player.playVideo(); } catch (_) { }
      }
    }, 400);
  } else {
    setTimeout(() => {
      const np = SAS.state?.nowPlaying;
      if (np && np.videoId) {
        applyNowPlayingToPlayer(np);
      }
    }, 400);
  }
});

// Remote Panel Event Listeners
function bindRemoteEvents() {
  const rPlayPause = document.getElementById('remote-play-pause');
  const rPrev = document.getElementById('remote-prev');
  const rNext = document.getElementById('remote-next');
  const rVol = document.getElementById('remote-volume-slider');
  const rAdd = document.getElementById('remote-add-btn');
  const rInput = document.getElementById('remote-link-input');

  if (rPlayPause) rPlayPause.addEventListener('click', toggleMainPlayback);
  if (rPrev) rPrev.addEventListener('click', playPrev);
  if (rNext) rNext.addEventListener('click', playNext);
  if (rVol) {
    rVol.addEventListener('input', (e) => {
      syncVolume(parseInt(e.target.value, 10), true);
    });
    rVol.addEventListener('change', (e) => {
      flushBroadcastVolume(parseInt(e.target.value, 10));
    });
  }
  if (rAdd && rInput) {
    rAdd.addEventListener('click', () => {
      const url = rInput.value.trim();
      if (!url) return;
      insertTrack(url);
      rInput.value = '';
    });
    rInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') rAdd.click();
    });
  }
}

// Service Worker Registration & Updates
function listenForSWUpdates() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SW_UPDATED') {
      // New service worker activated — assets refreshed
    }
  });

  navigator.serviceWorker.register('./sw.js').then((registration) => {
    registration.update().catch(() => { });
    setInterval(() => registration.update().catch(() => { }), 5 * 60 * 1000);
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  }).catch(() => { });
}

// Drag & Drop Queue Reordering (Authorized Super Admin & Admins Only)
if (playlistContainer) {
  playlistContainer.addEventListener('dragstart', (event) => {
    if (!isAuthorizedUser()) {
      event.preventDefault();
      showConnectionBadge('denied', 'Admin access required to reorder tracks');
      return;
    }
    const row = event.target.closest('.track-card[data-track-index]');
    if (!row) return;
    dragFromIndex = Number(row.dataset.trackIndex);
    row.classList.add('dragging');
  });

  playlistContainer.addEventListener('dragover', (event) => {
    if (dragFromIndex < 0 || !isAuthorizedUser()) return;
    event.preventDefault();
    const row = event.target.closest('.track-card[data-track-index]');
    if (row) {
      playlistContainer.querySelectorAll('.track-card.drag-over').forEach(el => {
        if (el !== row) el.classList.remove('drag-over');
      });
      row.classList.add('drag-over');
    }
  });

  playlistContainer.addEventListener('dragleave', (event) => {
    const row = event.target.closest('.track-card[data-track-index]');
    if (row) row.classList.remove('drag-over');
  });

  playlistContainer.addEventListener('drop', (event) => {
    if (dragFromIndex < 0) return;
    const row = event.target.closest('.track-card[data-track-index]');
    playlistContainer.querySelectorAll('.track-card.drag-over').forEach(el => el.classList.remove('drag-over'));
    if (!row) return;
    event.preventDefault();

    if (!isAuthorizedUser()) {
      dragFromIndex = -1;
      showConnectionBadge('denied', 'Admin access required to reorder tracks');
      return;
    }

    const dropIndex = Number(row.dataset.trackIndex);
    if (dragFromIndex !== dropIndex) {
      // Optimistic local reorder for authorized users
      const moved = videoLinks[dragFromIndex];
      if (moved) {
        videoLinks.splice(dragFromIndex, 1);
        videoLinks.splice(dropIndex, 0, moved);
        if (currentIndex === dragFromIndex) {
          currentIndex = dropIndex;
        } else if (dragFromIndex < currentIndex && dropIndex >= currentIndex) {
          currentIndex--;
        } else if (dragFromIndex > currentIndex && dropIndex <= currentIndex) {
          currentIndex++;
        }
        initPlaylist();
        updatePlaylistUI();
      }

      // Send reorder command to server — server is the single source of truth
      SAS.moveTrack(dragFromIndex, dropIndex);
    }
    dragFromIndex = -1;
  });

  playlistContainer.addEventListener('dragend', () => {
    dragFromIndex = -1;
    playlistContainer.querySelectorAll('.track-card').forEach(el => {
      el.classList.remove('dragging', 'drag-over');
    });
  });
}

// Queue Tabs Switcher
document.addEventListener('DOMContentLoaded', () => {
  const tabAll = document.getElementById('tab-all-queue');
  const tabPin = document.getElementById('tab-pinned');
  const tabReq = document.getElementById('tab-requests');

  if (tabAll && tabPin && tabReq) {
    tabAll.onclick = () => { setActiveTab(tabAll, 'all'); };
    tabPin.onclick = () => { setActiveTab(tabPin, 'pinned'); };
    tabReq.onclick = () => { setActiveTab(tabReq, 'requests'); };
  }

  function setActiveTab(btn, filter) {
    [tabAll, tabPin, tabReq].forEach(b => b?.classList.remove('active'));
    btn.classList.add('active');
    activeQueueFilter = filter;
    initPlaylist();
  }
});

// App Boot Orchestration
async function boot() {
  ensureYouTubeAPIReady();
  initPlaylist();
  updateControlAccessUI();
  bindRemoteEvents();
  initMediaSession();
  initPiPButton();
  listenForSWUpdates();
  startTrackTimer();
  initThumbProgressScrubber();
  applyRoleBasedVideoDisplay();

  const rawSavedName = localStorage.getItem('sas_device_name') || '';
  if (isAutoGeneratedBrowserName(rawSavedName)) {
    localStorage.removeItem('sas_device_name');
  }
  const savedName = isAutoGeneratedBrowserName(rawSavedName) ? '' : rawSavedName;

  // Wire SAS Realtime Engine
  SAS.on('state', applyState)
    .on('tick', onServerTick)
    .on('seek', onServerSeek)
    .on('denied', onActionDenied)
    .on('status', onConnectionStatus);

  try {
    await SAS.ensureSession(savedName || null);
  } catch (_) {
    // Session prefetch is best-effort — silently continue
  }

  SAS.connect();

  // Populate version badge in header & add secret Super Admin elevation trigger
  const versionBadge = document.getElementById('app-version-badge');
  if (versionBadge) {
    versionBadge.textContent = 'v' + APP_VERSION;
    versionBadge.style.cursor = 'pointer';
    versionBadge.addEventListener('click', () => {
      if (!isSuperAdmin) {
        promptAdminPassphrase();
      }
    });
  }

  // Ctrl+Shift+A shortcut to elevate to Super Admin when buttons are hidden
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
      e.preventDefault();
      promptAdminPassphrase();
    }
  });

  // Navbar search-wrapper input Enter key listener
  const linkInput = document.getElementById('link-input');
  if (linkInput) {
    linkInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addLink();
      }
    });
  }



  // Legacy Firebase Invalidation & Storage Cleanup
  invalidateLegacyFirebaseVersions();
}

function invalidateLegacyFirebaseVersions() {
  const firebaseVersionUrl = 'https://sas-premium-player-default-rtdb.firebaseio.com/sas-player/appVersion.json';
  fetch(firebaseVersionUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: APP_VERSION,
      updatedAt: Date.now(),
      architecture: 'cloudflare-worker-do',
      message: 'Upgraded to SAS Player v4.0.0 Cloudflare DO Architecture. Older Firebase versions invalidated.'
    })
  }).then(() => {
    // Silently synchronized — no console output
  }).catch(() => {
    // Non-critical — silently ignore
  });
}

// Super Admin: no longer auto-pausing on beforeunload/pagehide.
// The server-side Durable Object now uses a 30-second grace period alarm.
// This prevents F5 refreshes and brief tab switches from pausing playback globally.

window.addEventListener('load', boot);

  // Expose public action handlers for index.html onclick events
  Object.assign(window, {
    APP_VERSION,
    addLink,
    insertTrack,
    toggleTheme,
    openAccessModal,
    closeAccessModal,
    closeAccessModalOnBackdrop,
    requestAccess,
    openAdminPanel,
    closeAdminPanel,
    closeAdminPanelOnBackdrop,
    openWorkerSettingsModal,
    closeWorkerSettingsModal,
    closeWorkerSettingsModalOnBackdrop,
    saveWorkerSettings,
    openMiniPlayer,
    toggleMainPlayback,
    playNext,
    playPrev,
    loadVideo,
    togglePinTrack,
    removeTrack,
    clearAllTracks,
    loadDefaultPlaylistAction,
    clearPlayedTracks,
    onMasterVolumeInput,
    onMasterVolumeChange,
    openRemotePanel,
    minimizeRemotePanel,
    clearAllOtherDevices,
    logoutAdmin,
    changeMyDisplayName,
    onYouTubeIframeAPIReady,
  });

  // Expose read-only security properties that cannot be tampered from DevTools console
  try {
    Object.defineProperties(window, {
      currentUserRole: { get: () => currentUserRole, configurable: false },
      isAdmin: { get: () => isAdmin, configurable: false },
      isSuperAdmin: { get: () => isSuperAdmin, configurable: false },
      deviceStatus: { get: () => deviceStatus, configurable: false },
      deviceId: { get: () => deviceId, configurable: false },
    });
  } catch (_) { }
})();