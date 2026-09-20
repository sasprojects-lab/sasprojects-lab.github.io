// =========================================================================
//  SAS PLAYER — APP VERSION (Workers + Durable Objects Architecture)
// =========================================================================
const APP_VERSION = '4.0.2';

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

  // Friendly type fallbacks
  const typeLabels = {
    volume: 'Volume Changed',
    add: 'Added Track',
    clear: 'Cleared Queue',
    pin: 'Pinned Track',
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

function showEventToast(ev) {
  if (!isAuthorizedUser()) return; // Never show floating broadcast toasts to guests
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
function onYouTubeIframeAPIReady() {
  ytApiReady = true;
  initYouTubePlayer();
}

let isInitializingPlayer = false;

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
    player = new YT.Player('yt-iframe', {
      height: '100%',
      width: '100%',
      videoId: initialVideoId,
      playerVars: {
        'autoplay': 0,
        'mute': 0,
        'controls': 0,
        'rel': 0,
        'playsinline': 1,
        'enablejsapi': 1,
        'disablekb': 1,
        'iv_load_policy': 3,
        'modestbranding': 1
      },
      events: {
        'onReady': (e) => {
          isInitializingPlayer = false;
          onPlayerReady(e);
        },
        'onStateChange': onPlayerStateChange,
        'onError': (e) => {
          isInitializingPlayer = false;
          console.warn('[SAS Player] YT Player Error:', e.data);
        }
      }
    });
  } catch (err) {
    isInitializingPlayer = false;
    console.warn('[SAS Player] Failed to create player:', err);
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
    // Guest: ready up first track title
    if (videoLinks[currentIndex]) {
      updateDisplayTitle(videoLinks[currentIndex].title);
    }
  }
}

function onPlayerStateChange(event) {
  const isPlaying = (event.data === YT.PlayerState.PLAYING);

  // Expected playback state for background recovery
  if (isPlaying) {
    expectedPlaybackState = 'playing';
  } else if (event.data === YT.PlayerState.PAUSED) {
    expectedPlaybackState = 'paused';
  }

  // Synchronize Super Admin host player state with the room and UI
  if (isSuperAdmin) {
    if (isPlaying) {
      if (SAS.state?.nowPlaying && !SAS.state.nowPlaying.isPlaying) {
        SAS.play();
      }
      updatePlaybackUIState(true);
    } else if (event.data === YT.PlayerState.PAUSED) {
      if (SAS.state?.nowPlaying?.isPlaying) {
        SAS.pause();
      }
      updatePlaybackUIState(false);
    }
  }

  // Broadcast duration to all other devices on playback start/buffer
  if (isSuperAdmin && (isPlaying || event.data === YT.PlayerState.BUFFERING)) {
    if (player && typeof player.getDuration === 'function') {
      const dur = player.getDuration() || 0;
      if (dur > 0) {
        SAS.hostTick(player.getCurrentTime() || 0, dur);
      }
    }
  }

  // If host player finishes playing a track, advance the entire room
  if (isSuperAdmin && event.data === YT.PlayerState.ENDED) {
    SAS.next();
  } else if (!isAuthorizedUser() && event.data === YT.PlayerState.ENDED) {
    // Guest player advances locally
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
  const thumbFill = document.getElementById('thumb-progress-fill');
  const thumbCur = document.getElementById('thumb-progress-current');
  const thumbDur = document.getElementById('thumb-progress-duration');
  if (thumbFill) {
    const pct = duration > 0 ? Math.min(100, Math.max(0, (current / duration) * 100)) : 0;
    thumbFill.style.width = pct + '%';
  }
  if (thumbCur) thumbCur.textContent = formatTime(current);
  if (thumbDur) thumbDur.textContent = duration > 0 ? formatTime(duration) : '--:--';
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
    const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (!response.ok) return '';
    const data = await response.json();
    const title = data && data.title ? data.title.trim() : '';
    if (title) titleCache[videoId] = title;
    return title;
  } catch (error) {
    return '';
  }
}

async function hydrateVideoTitles() {
  let changed = false;
  const tasks = videoLinks.map(async (track, index) => {
    if (!track || (track.title && track.title !== 'YouTube Track' && track.title !== 'Untitled')) return;
    const title = await fetchVideoTitle(track.id);
    if (title && videoLinks[index] && videoLinks[index].id === track.id) {
      videoLinks[index].title = title;
      changed = true;
    }
  });

  await Promise.all(tasks);
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
  div.className = `track-card ${isActive ? 'active-playing' : ''}`;
  div.dataset.trackIndex = index;
  div.draggable = true;

  const addedBy = link.addedByName || 'Station';
  const isHost = addedBy.includes('Super Admin') || addedBy.includes('Host');
  const isPinned = !!link.isPinned;
  const tagHtml = isPinned
    ? `<span class="pinned-tag"><i class="fas fa-thumbtack"></i> PINNED</span>`
    : `<span class="added-by-tag ${isHost ? 'super-admin' : ''}">${escapeHtml(addedBy)}</span>`;
  const titleText = link.title || 'Loading track title...';

  div.innerHTML = `
    <div class="track-num-drag">${index + 1}</div>
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
  if (!player || typeof player.getPlayerState !== 'function') return;
  const state = player.getPlayerState();
  const isCurrentlyPlaying = (state === YT.PlayerState.PLAYING);
  if (isCurrentlyPlaying) {
    player.pauseVideo();
    updatePlaybackUIState(false);
  } else {
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
  if (player && typeof player.loadVideoById === 'function') {
    player.loadVideoById({ videoId: track.id, startSeconds: 0 });
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
    SAS.pause();
  } else {
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
  SAS.next();
}

function playPrev() {
  if (!isAuthorizedUser()) {
    if (videoLinks.length === 0) return;
    const prevIdx = (currentIndex - 1 + videoLinks.length) % videoLinks.length;
    loadLocalVideo(prevIdx);
    return;
  }
  SAS.prev();
}

function loadVideo(index) {
  if (!isAuthorizedUser()) {
    loadLocalVideo(index);
    return;
  }
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
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

function addLink() {
  const input = document.getElementById('link-input');
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) return;

  const videoId = extractVideoID(raw);
  if (!videoId) {
    alert("Please enter a valid YouTube video URL.");
    return;
  }

  // Fetch title in background then add
  fetchVideoTitle(videoId).then((title) => {
    const trackTitle = title || "YouTube Track";
    if (!isAuthorizedUser()) {
      addLocalTrack(videoId, trackTitle);
    } else {
      SAS.addTrack(videoId, trackTitle);
    }
  });

  input.value = '';
}

function insertTrack(rawInput) {
  if (!rawInput) return;
  const urls = rawInput.trim().split(/\s+/).filter(Boolean);
  urls.forEach((url) => {
    const videoId = extractVideoID(url);
    if (videoId) {
      fetchVideoTitle(videoId).then((title) => {
        const trackTitle = title || "YouTube Track";
        if (!isAuthorizedUser()) {
          addLocalTrack(videoId, trackTitle);
        } else {
          SAS.addTrack(videoId, trackTitle);
        }
      });
    }
  });
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

  // Video track change
  if (np.videoId !== lastLoadedVideoId) {
    lastLoadedVideoId = np.videoId;
    const startSec = Math.floor(SAS.projectedPosition());
    if (np.isPlaying) {
      player.loadVideoById({
        videoId: np.videoId,
        startSeconds: startSec
      });
    } else {
      player.cueVideoById({
        videoId: np.videoId,
        startSeconds: startSec
      });
    }
  }

  // Super Admin always unmuted
  if (typeof player.unMute === 'function') player.unMute();

  // Play / Pause alignment
  if (typeof player.getPlayerState === 'function') {
    const currentState = player.getPlayerState();
    if (np.isPlaying && currentState !== YT.PlayerState.PLAYING && currentState !== YT.PlayerState.BUFFERING) {
      player.playVideo();
    } else if (!np.isPlaying && (currentState === YT.PlayerState.PLAYING || currentState === YT.PlayerState.BUFFERING)) {
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
  if (isSuperAdmin || !player || !isPlayerReady || typeof player.getCurrentTime !== 'function') return;
  const current = player.getCurrentTime();
  if (Math.abs(current - positionSec) > 1.5) {
    player.seekTo(positionSec, true);
  }
}

// Host publishes position tick twice per second
setInterval(() => {
  if (isSuperAdmin && player && isPlayerReady && typeof player.getCurrentTime === 'function' && typeof player.getPlayerState === 'function') {
    if (player.getPlayerState() === YT.PlayerState.PLAYING) {
      const cur = player.getCurrentTime() || 0;
      const dur = (typeof player.getDuration === 'function') ? (player.getDuration() || 0) : 0;
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

function getBrowserDeviceName() {
  const ua = navigator.userAgent;
  let browser = 'Browser';
  if (ua.includes('Brave')) browser = 'Brave';
  else if (ua.includes('Edg')) browser = 'Edge';
  else if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Safari')) browser = 'Safari';

  let os = 'PC';
  if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad/i.test(ua)) os = 'iOS';
  else if (/Mac/i.test(ua)) os = 'Mac';
  else if (/Win/i.test(ua)) os = 'Windows';

  return `${browser} - ${os}`;
}

function getDeviceName() {
  return localStorage.getItem('sas_device_name') || (isSuperAdmin ? 'Super Admin' : getBrowserDeviceName());
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

  const currentName = SAS.state.self?.name || localStorage.getItem('sas_device_name') || getDeviceName();

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
    if (input) input.value = localStorage.getItem('sas_device_name') || '';
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

async function promptAdminPassphrase() {
  const entered = prompt('Enter Super Admin Passphrase:');
  if (!entered) return;

  try {
    const res = await SAS.elevate(entered.trim());
    if (res.ok) {
      currentUserRole = res.role;
      isAdmin = (res.role === 'admin' || res.role === 'super_admin');
      isSuperAdmin = (res.role === 'super_admin');
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
    } else {
      alert(res.error ? `Authentication failed (${res.error}). Please check your passphrase.` : 'Invalid Passphrase.');
    }
  } catch (err) {
    alert('Connection error contacting Cloudflare Worker: ' + err.message);
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
  } catch (err) {
    console.error('PiP Error:', err);
  }
}

// Background Visibility Recovery
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !player) return;

  if (isSuperAdmin) {
    setTimeout(() => {
      if (!player || !player.getPlayerState) return;
      const currentState = player.getPlayerState();
      if (expectedPlaybackState === 'playing' &&
        currentState !== YT.PlayerState.PLAYING &&
        currentState !== YT.PlayerState.BUFFERING) {
        player.playVideo();
      }
    }, 400);
  } else {
    setTimeout(() => {
      const np = SAS.state.nowPlaying;
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
      console.log('[SAS SW] New service worker activated');
    }
  });

  navigator.serviceWorker.register('./sw.js').then((registration) => {
    registration.update().catch(() => { });
    setInterval(() => registration.update().catch(() => { }), 5 * 60 * 1000);
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  }).catch((err) => {
    console.warn('[SAS SW] Registration failed:', err);
  });
}

// Drag & Drop Queue Reordering
if (playlistContainer) {
  playlistContainer.addEventListener('dragstart', (event) => {
    const row = event.target.closest('.track-card[data-track-index]');
    if (!row) return;
    dragFromIndex = Number(row.dataset.trackIndex);
    row.classList.add('dragging');
  });

  playlistContainer.addEventListener('dragover', (event) => {
    if (dragFromIndex < 0) return;
    event.preventDefault();
  });

  playlistContainer.addEventListener('drop', (event) => {
    if (dragFromIndex < 0) return;
    const row = event.target.closest('.track-card[data-track-index]');
    if (!row) return;
    event.preventDefault();
    const dropIndex = Number(row.dataset.trackIndex);
    if (dragFromIndex !== dropIndex && isAuthorizedUser()) {
      const moved = videoLinks[dragFromIndex];
      videoLinks.splice(dragFromIndex, 1);
      videoLinks.splice(dropIndex, 0, moved);
      initPlaylist();
      updatePlaylistUI();
    }
    dragFromIndex = -1;
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
  initPlaylist();
  updateControlAccessUI();
  bindRemoteEvents();
  initMediaSession();
  initPiPButton();
  listenForSWUpdates();
  startTrackTimer();
  applyRoleBasedVideoDisplay();

  const savedName = localStorage.getItem('sas_device_name') || getBrowserDeviceName();
  localStorage.setItem('sas_device_name', savedName);

  // Wire SAS Realtime Engine
  SAS.on('state', applyState)
    .on('tick', onServerTick)
    .on('denied', onActionDenied)
    .on('status', onConnectionStatus);

  try {
    await SAS.ensureSession(savedName);
  } catch (err) {
    console.warn('[SAS] Session prefetch note:', err.message);
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
    console.log('[SAS Invalidation] Legacy Firebase appVersion synchronized to v' + APP_VERSION);
  }).catch((err) => {
    console.warn('[SAS Invalidation] Legacy Firebase sync notice:', err);
  });

  // Clean up legacy Firebase cache/storage entries in the browser
  try {
    const legacyKeys = ['sas_player_cache', 'sas_device_status', 'sas_admin_pass'];
    for (const key of legacyKeys) {
      localStorage.removeItem(key);
    }
  } catch (e) { /* ignore */ }
}

// Handle unload/refresh for Super Admin host
window.addEventListener('beforeunload', () => {
  if (isSuperAdmin && SAS.state?.nowPlaying?.isPlaying) {
    try {
      SAS.pause();
    } catch (_) { }
  }
});

window.addEventListener('pagehide', () => {
  if (isSuperAdmin && SAS.state?.nowPlaying?.isPlaying) {
    try {
      SAS.pause();
    } catch (_) { }
  }
});

window.addEventListener('load', boot);