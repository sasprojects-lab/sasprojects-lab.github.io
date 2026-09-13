// =========================================================================
//  SAS PLAYER — APP VERSION (used for cache busting & version enforcement)
// =========================================================================
const APP_VERSION = '3.1.4';

// Default Studio Playlist
const DEFAULT_TRACKS = [
  { id: 'byitAI7kkOM', title: 'Armaan Malik - Dil Mein Ho Tum', addedByName: 'Super Admin', isPinned: false },
  { id: 'W1y8blwMLxY', title: 'Jubin Nautiyal - Barbaad', addedByName: 'Rahul (iPhone)', isPinned: false },
  { id: '2FPTVYj3ouE', title: 'Khaali Salam Dua', addedByName: 'Super Admin', isPinned: false },
  { id: 'ia5CdcuqSWk', title: 'Terre Pyaar Mein', addedByName: 'Guest DJ', isPinned: false },
  { id: 'BvPNWCzQMec', title: 'Bekhudi', addedByName: 'Super Admin', isPinned: false },
  { id: 'kKljXVVkgS4', title: 'Sanam Teri kasam', addedByName: 'Super Admin', isPinned: false },
  { id: 'ztPa6vkM-yY', title: 'Guzarish', addedByName: 'Super Admin', isPinned: false },
  { id: 'u4wmmGrI4pE', title: 'Chaand Jaise Mukhde Pe Bindiya Sitara', addedByName: 'Super Admin', isPinned: false },
  { id: 'TqR_jWfHW4g', title: 'Humnava', addedByName: 'Super Admin', isPinned: false },
  { id: 'ayzN5Il56co', title: 'Chori Chori Yun Jab Ho', addedByName: 'Super Admin', isPinned: false },
  { id: 'R7spJ7YjNOY', title: 'Love Letter', addedByName: 'Super Admin', isPinned: false },
  { id: '1a--6kZ8LCY', title: 'Hug Me', addedByName: 'Super Admin', isPinned: false },
  { id: 'AbkEmIgJMcU', title: 'Pal Pal', addedByName: 'Super Admin', isPinned: false },
  { id: 'wCTmWy43HgM', title: 'Haseen', addedByName: 'Super Admin', isPinned: false },
  { id: 'QRwLbf3PwO8', title: 'Qayade Se', addedByName: 'Super Admin', isPinned: false },
  { id: 'yHJf8MSPHk0', title: 'Baatein ye Kabhi na', addedByName: 'Super Admin', isPinned: false }
];

let videoLinks = JSON.parse(JSON.stringify(DEFAULT_TRACKS));

let player;
let isPlayerReady = false;
let lastLoadedVideoId = '';
let pendingVideoId = null;
let pendingIsPlaying = false;
let pendingStartSeconds = 0;
let timeSyncInterval = null;
let currentIndex = 0;
let usingYouTubePlaylist = false;
let pendingCommandIssuer = null;
let lastCommandIssuer = null;
let lastNowPlayingData = null;
let lastVolumeData = null;
let activePlaylistId = '';
let activePlaylistTitle = '';
const titleCache = {};
let dragFromIndex = -1;
let isLightMode = false;
let isThemeAnimating = false;
let shouldResumeOnFocus = false;
let expectedPlaybackState = null; // 'playing' | 'paused' | null — for health check recovery
let healthCheckInterval = null;
let heartbeatInterval = null;
let activeQueueFilter = 'all'; // 'all', 'pinned', 'requests'

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
  logActivity('Switched theme to ' + (isLightMode ? 'Light mode' : 'Dark obsidian'), 'info', /* forceBroadcast= */ false);
}

// Activity & Telemetry Realtime Stream
const EVENT_ICONS = {
  play: { icon: 'fa-play', cls: 'type-play' },
  pause: { icon: 'fa-pause', cls: 'type-pause' },
  skip: { icon: 'fa-forward', cls: 'type-skip' },
  volume: { icon: 'fa-volume-up', cls: 'type-volume' },
  pin: { icon: 'fa-thumbtack', cls: 'type-pin' },
  add: { icon: 'fa-plus-circle', cls: 'type-add' },
  admin: { icon: 'fa-shield-alt', cls: 'type-admin' },
  clear: { icon: 'fa-trash-alt', cls: 'type-clear' },
  info: { icon: 'fa-bolt', cls: 'type-skip' }
};

const PAGE_BOOT_TIME = Date.now();

function logActivity(text, type = 'info', forceBroadcast = true) {
  const actorName = getDeviceName(deviceId);
  const eventObj = {
    actor: actorName,
    role: currentUserRole || 'guest',
    type: type,
    detail: text,
    timestamp: Date.now(),
    deviceId: deviceId
  };

  renderStreamEventCard(eventObj, /* isLocal= */ true);

  if (forceBroadcast && db && isAuthorizedUser()) {
    db.ref(DB_ROOT + '/events').push(eventObj);
  }
}

function renderStreamEventCard(ev, isLocal = false) {
  const stream = document.getElementById('live-activity-stream');
  if (!stream) return;

  const typeConfig = EVENT_ICONS[ev.type] || EVENT_ICONS.info;
  const timeStr = new Date(ev.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const isSelf = ev.deviceId === deviceId;
  const roleLabel = (ev.role || 'guest').replace('_', ' ');

  const card = document.createElement('div');
  card.className = 'stream-event-card fresh-flash';
  card.innerHTML = `
    <div class="event-icon-box ${typeConfig.cls}">
      <i class="fas ${typeConfig.icon}"></i>
    </div>
    <div class="event-content-block">
      <div class="event-actor-row">
        <div class="event-actor-identity">
          <span>${escapeHtml(ev.actor || 'Device')}</span>
          ${isSelf ? '<span style="font-size:9px;color:var(--text-muted);font-weight:normal;">(You)</span>' : ''}
          <span class="event-role-chip ${escapeHtml(ev.role || 'guest')}">${escapeHtml(roleLabel)}</span>
        </div>
        <span class="event-time">${timeStr}</span>
      </div>
      <div class="event-detail-text">${escapeHtml(ev.detail || '')}</div>
    </div>
  `;

  stream.prepend(card);
  if (stream.children.length > 20) {
    stream.removeChild(stream.lastChild);
  }

  // Show floating toast for events from OTHER devices.
  // Freshness window: 30s after page boot (guarantees unseen events while page was loading show toast at least once)
  const isFreshLiveEvent = ev.timestamp && (ev.timestamp >= PAGE_BOOT_TIME - 30000) && (Date.now() - ev.timestamp < 30000);
  if (!isLocal && !isSelf && ev.detail && isFreshLiveEvent) {
    showEventToast(ev);
  }
}

function showEventToast(ev) {
  const hub = document.getElementById('event-toast-hub');
  if (!hub) return;

  // Cap maximum concurrent visible toasts to 2
  while (hub.children.length >= 2) {
    hub.removeChild(hub.firstChild);
  }

  const typeConfig = EVENT_ICONS[ev.type] || EVENT_ICONS.info;
  const toast = document.createElement('div');
  toast.className = 'event-toast-card';
  toast.innerHTML = `
    <div class="event-icon-box ${typeConfig.cls}" style="width:32px;height:32px;font-size:13px;">
      <i class="fas ${typeConfig.icon}"></i>
    </div>
    <div class="event-content-block">
      <div class="event-actor-row">
        <div class="event-actor-identity" style="font-size:12px;">
          <span>${escapeHtml(ev.actor || 'Device')}</span>
          <span class="event-role-chip ${escapeHtml(ev.role || 'guest')}">${escapeHtml((ev.role || 'guest').replace('_', ' '))}</span>
        </div>
        <span class="event-time">Just now</span>
      </div>
      <div class="event-detail-text" style="font-size:12px;color:var(--text-main);">${escapeHtml(ev.detail || '')}</div>
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

function listenToLiveEvents() {
  if (!db) return;
  const eventsRef = db.ref(DB_ROOT + '/events');

  eventsRef.limitToLast(12).on('child_added', (snap) => {
    const ev = snap.val();
    if (!ev) return;
    if (!isAuthorizedUser()) return;
    if (ev.deviceId === deviceId && ev.timestamp >= PAGE_BOOT_TIME) return;
    renderStreamEventCard(ev, /* isLocal= */ false);
  });
}

// Initialize YouTube Player
function onYouTubeIframeAPIReady() {
  const initialId = (lastNowPlayingData && lastNowPlayingData.videoId)
    ? lastNowPlayingData.videoId
    : (pendingVideoId || (videoLinks[currentIndex] ? videoLinks[currentIndex].id : 'byitAI7kkOM'));
  const savedRole = localStorage.getItem('sas_user_role');
  const isSuper = (savedRole === 'super_admin');

  // For non-super-admin devices: if we already have the host's now-playing
  // data at this point (e.g. on a page refresh, once the nowPlaying listener's
  // first snapshot has already arrived), work out the real elapsed playback
  // position up front. Otherwise the iframe always starts loading at 0:00 and
  // the video visibly "restarts from the beginning" every time, only catching
  // up later via drift correction instead of loading in the right place immediately.
  let initialStartSeconds = 0;
  if (!isSuper && lastNowPlayingData && lastNowPlayingData.videoId === initialId) {
    initialStartSeconds = (typeof lastNowPlayingData.currentTime === 'number') ? lastNowPlayingData.currentTime : 0;
    if (lastNowPlayingData.isPlaying && lastNowPlayingData.timestamp) {
      const elapsed = (Date.now() - lastNowPlayingData.timestamp) / 1000;
      if (elapsed > 0 && elapsed < 600) initialStartSeconds += elapsed;
    }
  }

  player = new YT.Player('yt-iframe', {
    height: '100%',
    width: '100%',
    videoId: initialId,
    playerVars: {
      'autoplay': isSuper ? 0 : 1,
      'mute': isSuper ? 0 : 1,
      'start': Math.floor(initialStartSeconds),
      'controls': 0,
      'rel': 0,
      'playsinline': 1,
      'enablejsapi': 1,
      'disablekb': 1,
      'iv_load_policy': 3,
      'modestbranding': 1
    },
    events: {
      'onReady': onPlayerReady,
      'onStateChange': onPlayerStateChange,
      'onError': (e) => {
        console.warn('[SAS Player] YT Player Error:', e.data);
      }
    }
  });
}

function onPlayerReady(event) {
  isPlayerReady = true;
  // Non-super-admin devices must be muted so browsers permit programmatic autoplay without audio echo
  if (!isSuperAdmin && player && typeof player.mute === 'function') {
    player.mute();
  }

  // If now-playing state is already available from Firebase, apply immediately
  if (lastNowPlayingData && !isSuperAdmin) {
    applyNowPlayingUI(lastNowPlayingData);
  } else if (pendingVideoId) {
    if (isSuperAdmin) {
      if (player && player.loadVideoById) {
        player.loadVideoById(pendingVideoId, pendingStartSeconds || 0);
      }
    } else {
      if (player && typeof player.mute === 'function') player.mute();
      if (pendingIsPlaying) {
        if (player && player.loadVideoById) {
          player.loadVideoById({
            videoId: pendingVideoId,
            startSeconds: Math.floor(pendingStartSeconds || 0)
          });
          if (pendingStartSeconds > 1) {
            setTimeout(() => {
              try {
                if (player && typeof player.seekTo === 'function') player.seekTo(pendingStartSeconds, true);
              } catch (_) { }
            }, 400);
          }
        }
      } else {
        if (player && player.cueVideoById) {
          player.cueVideoById({
            videoId: pendingVideoId,
            startSeconds: Math.floor(pendingStartSeconds || 0)
          });
        }
      }
    }
    lastLoadedVideoId = pendingVideoId;
    pendingVideoId = null;
    pendingStartSeconds = 0;
  }
}

function insertTrack(rawInput, addedByActor = null) {
  if (!rawInput) return;
  const urls = rawInput.trim().split(/\s+/).filter(Boolean);
  const actor = addedByActor || getDeviceName(deviceId);

  // Check for direct video tracks first
  const parsedTracks = [];
  urls.forEach((url) => {
    const videoId = extractVideoID(url);
    if (videoId) {
      parsedTracks.push({
        id: videoId,
        title: '',
        addedByName: actor,
        isPinned: false
      });
    }
  });

  // Case 1: Direct Video Tracks Found
  if (parsedTracks.length > 0) {
    const wasEmpty = videoLinks.length === 0;

    if (usingYouTubePlaylist) {
      syncPlaylistFromPlayer();
      usingYouTubePlaylist = false;
      activePlaylistId = '';
      activePlaylistTitle = '';
    }

    videoLinks.push(...parsedTracks);

    if (wasEmpty) {
      currentIndex = 0;
      initPlaylist();
      const initialTitle = parsedTracks[0].title || 'Loading track title...';
      updateDisplayTitle(initialTitle, /* broadcast= */ true);
      if (isSuperAdmin) {
        loadVideo(0);
      }
    } else {
      initPlaylist();
      updatePlaylistUI();
    }

    hydrateVideoTitles();
    broadcastPlaylist();
    logActivity(`Added ${parsedTracks.length} track(s) to master queue`, 'add');
    return;
  }

  // Case 2: Pure playlist URL
  const playlistId = urls.length === 1 ? extractPlaylistID(urls[0]) : null;
  if (playlistId) {
    if (isSuperAdmin) {
      usingYouTubePlaylist = true;
      activePlaylistId = playlistId;
      videoLinks = [];
      currentIndex = 0;
      initPlaylist();
      loadYouTubePlaylist(playlistId, 0);
    }
    logActivity(`Loaded YouTube Playlist (${playlistId})`, 'add');
    return;
  }

  alert("Please enter valid YouTube video URL(s) or a playlist URL.");
}

function addLink() {
  const input = document.getElementById('link-input');
  if (!input) return;
  const rawInput = input.value.trim();
  if (!rawInput) return;
  insertTrack(rawInput, getDeviceName(deviceId));
  input.value = '';
}

function extractVideoID(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

function extractPlaylistID(url) {
  const match = url.match(/[?&]list=([^#&\s]+)/);
  return match ? match[1] : null;
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
    const sideTitleEl = document.getElementById('sidebar-title');
    if (sideTitleEl && sideTitleEl.innerText !== '44.1 kHz Hi-Fi YouTube Master Feed') {
      // Only update sidebar sub-title if it isn't the default static subtitle
    }
    const remoteTitle = document.getElementById('remote-now-playing-title');
    if (remoteTitle) remoteTitle.textContent = title;
    updateMediaSession(title, 'SAS Player');
  }

  if (typeof trackIndex === 'number' && trackIndex >= 0) {
    currentIndex = trackIndex;
  }
  updatePlaylistUI();
}

// Master Playback State Handler (Fired on Super Admin Host PC)
function onPlayerStateChange(event) {
  // Non-super-admin devices display video visually but do NOT broadcast or control queue
  if (!isSuperAdmin) {
    if (player && typeof player.mute === 'function' && player.isMuted && !player.isMuted()) {
      player.mute();
    }
    return;
  }

  const isPlaying = event.data == YT.PlayerState.PLAYING;

  lastCommandIssuer = pendingCommandIssuer || deviceId;
  pendingCommandIssuer = null;

  // Always get the real title and video ID from the YouTube player (handles track changes)
  let curTitle = '';
  let curVideoId = '';
  if (player && player.getVideoData) {
    const vd = player.getVideoData();
    curTitle = (vd && vd.title) ? vd.title.trim() : '';
    curVideoId = (vd && vd.video_id) ? vd.video_id : '';
  }
  if (!curTitle) {
    const titleEl = document.getElementById('current-title');
    curTitle = titleEl ? titleEl.innerText : 'SAS Player';
  }

  // Update currentIndex to match the real video ID currently in the player
  if (curVideoId) {
    const matchedIdx = videoLinks.findIndex((v) => v.id === curVideoId);
    if (matchedIdx !== -1) {
      currentIndex = matchedIdx;
    }
  }

  // Update local video title cache for currently playing track
  if (curTitle && videoLinks[currentIndex]) {
    videoLinks[currentIndex].title = curTitle;
  }

  updatePlaybackUIState(isPlaying, curTitle, currentIndex);

  if (isPlaying) {
    updateMediaSession(curTitle, 'SAS Player');
  } else {
    clearMediaSession();
  }

  // Broadcast state to remote devices with the real current title
  if (typeof broadcastNowPlaying === 'function') {
    broadcastNowPlaying(curTitle, isPlaying);
  }

  // Track expected playback state for health check recovery
  if (isPlaying) {
    expectedPlaybackState = 'playing';
  } else if (event.data == YT.PlayerState.PAUSED) {
    expectedPlaybackState = 'paused';
  }

  // Autoplay next track on end
  if (event.data == YT.PlayerState.ENDED) {
    playNext();
  }
}

function playNext() {
  if (isSuperAdmin) {
    if (usingYouTubePlaylist) {
      if (player && player.getPlaylistIndex) {
        const playlist = player.getPlaylist();
        const playlistIndex = player.getPlaylistIndex();
        if (Array.isArray(playlist) && playlistIndex < playlist.length - 1) {
          player.nextVideo();
        }
      }
      return;
    }

    currentIndex++;
    if (currentIndex < videoLinks.length) {
      loadVideo(currentIndex);
    } else {
      // End of playlist — loop back to the first track
      currentIndex = 0;
      loadVideo(0);
      logActivity('Playlist looped back to start', 'info');
    }
    logActivity('Skipped to next track', 'skip');
  } else {
    sendCommand('next');
    // Update local index/title for instant UI feedback only — do NOT touch the
    // actual player or lastLoadedVideoId here. The real video load must come
    // exclusively from the authoritative Firebase nowPlaying sync (applyNowPlayingUI),
    // otherwise lastLoadedVideoId gets set to a guess that can mismatch the host's
    // real track and permanently blocks the video from reloading (it looks like
    // "same video, skip reload" even though the visible video is stale).
    currentIndex = (currentIndex + 1 < videoLinks.length) ? currentIndex + 1 : 0;
    const nextVideo = videoLinks[currentIndex];
    if (nextVideo) {
      updateDisplayTitle(nextVideo.title);
      updatePlaylistUI();
    }
    logActivity('Skipped to next track', 'skip');
  }
}

function playPrev() {
  if (isSuperAdmin) {
    if (usingYouTubePlaylist) {
      if (player && player.getPlaylistIndex) {
        const playlistIndex = player.getPlaylistIndex();
        if (playlistIndex > 0) {
          player.previousVideo();
        }
      }
      return;
    }

    currentIndex--;
    if (currentIndex >= 0) {
      loadVideo(currentIndex);
    } else {
      currentIndex = 0;
    }
    logActivity('Returned to previous track', 'skip');
  } else {
    sendCommand('prev');
    // See note in playNext(): no local player.loadVideoById here. The video
    // must only ever be loaded by applyNowPlayingUI() from the real Firebase
    // state, so lastLoadedVideoId stays accurate and the video actually syncs.
    currentIndex = (currentIndex - 1 >= 0) ? currentIndex - 1 : 0;
    const prevVideo = videoLinks[currentIndex];
    if (prevVideo) {
      updateDisplayTitle(prevVideo.title);
      updatePlaylistUI();
    }
    logActivity('Returned to previous track', 'skip');
  }
}

function toggleMainPlayback() {
  if (isSuperAdmin && player && player.getPlayerState) {
    const state = player.getPlayerState();
    if (state === YT.PlayerState.PLAYING) {
      player.pauseVideo();
      sendCommand('pause');
      logActivity('Paused master playback', 'pause');
    } else {
      player.playVideo();
      sendCommand('play');
      logActivity('Resumed master playback', 'play');
    }
  } else {
    const isPlaying = lastNowPlayingData ? lastNowPlayingData.isPlaying : (disk && disk.classList.contains('playing'));
    const willPlay = !isPlaying;
    sendCommand(willPlay ? 'play' : 'pause');
    if (player) {
      if (willPlay && typeof player.playVideo === 'function') {
        if (player.mute) player.mute();
        player.playVideo();
      } else if (!willPlay && typeof player.pauseVideo === 'function') {
        player.pauseVideo();
      }
    }
    logActivity(willPlay ? 'Resumed master playback' : 'Paused master playback', willPlay ? 'play' : 'pause');
  }
}

let volumeLogTimeout = null;
function syncVolume(level, broadcast = true) {
  const vol = Math.max(0, Math.min(100, parseInt(level, 10) || 0));

  // 1. Master Deck Volume Slider & Label
  const masterSlider = document.getElementById('master-volume-slider');
  if (masterSlider) masterSlider.value = vol;
  const label = document.getElementById('master-volume-label');
  if (label) label.textContent = vol + '%';

  // 2. Remote Controller Volume Slider
  const remSlider = document.getElementById('remote-volume-slider');
  if (remSlider) remSlider.value = vol;

  // 3. Live Status Bar Volume
  const liveVol = document.getElementById('live-status-volume');
  if (liveVol) liveVol.textContent = 'Volume: ' + vol + '%';

  // 4. Host player output
  if (isSuperAdmin && player && player.setVolume) {
    player.setVolume(vol);
  }

  // 5. Broadcast across Firebase network bus
  if (broadcast) {
    sendCommand('volume', { level: vol });
    clearTimeout(volumeLogTimeout);
    volumeLogTimeout = setTimeout(() => {
      logActivity(`Adjusted master volume to ${vol}%`, 'volume');
    }, 600);
  }
}

function onMasterVolumeInput(slider) {
  syncVolume(slider.value, true);
}

function loadVideo(index) {
  usingYouTubePlaylist = false;
  activePlaylistTitle = '';
  if (!videoLinks[index]) return;
  currentIndex = index;
  const video = videoLinks[index];
  if (isSuperAdmin && player && player.loadVideoById) {
    player.loadVideoById(video.id);
  } else if (!isSuperAdmin) {
    sendCommand('play-video', { videoId: video.id, index });
    // No local loadVideoById here — same reasoning as playNext()/playPrev():
    // letting the admin load a guessed video locally sets lastLoadedVideoId
    // out from under the real Firebase nowPlaying sync, which then thinks the
    // correct video is "already loaded" and skips reloading it. The video
    // will load a moment later via applyNowPlayingUI() once the host's
    // nowPlaying broadcast comes back, which is what keeps it actually synced.
  }
  updateDisplayTitle(video.title);
  updatePlaylistUI();
}

function loadYouTubePlaylist(playlistId, index = 0) {
  activePlaylistTitle = 'Playlist: ' + playlistId;
  if (player && player.loadPlaylist) {
    player.loadPlaylist({
      listType: 'playlist',
      list: playlistId,
      index: index
    });
  }
  updateDisplayTitle(activePlaylistTitle);
  syncPlaylistFromPlayer();
}

function updateDisplayTitle(title, broadcast = false) {
  const displayTitle = title || 'Select a track to begin';
  const curTitleEl = document.getElementById('current-title');
  const sideTitleEl = document.getElementById('sidebar-title');
  if (curTitleEl) curTitleEl.innerText = displayTitle;
  if (sideTitleEl) sideTitleEl.innerText = displayTitle;

  const remoteTitle = document.getElementById('remote-now-playing-title');
  if (remoteTitle) remoteTitle.textContent = displayTitle;
  updateMediaSession(displayTitle, 'SAS Player');

  if (broadcast) {
    const isPlaying = disk && disk.classList.contains('playing');
    if (typeof broadcastNowPlaying === 'function') broadcastNowPlaying(displayTitle, isPlaying);
  }
}

function refreshDisplayTitleFromPlayer() {
  if (!player || !player.getVideoData) return;
  const videoData = player.getVideoData();
  const playerTitle = videoData && videoData.title ? videoData.title : '';
  const fallbackTitle = usingYouTubePlaylist
    ? activePlaylistTitle
    : (videoLinks[currentIndex] && videoLinks[currentIndex].title);
  updateDisplayTitle(playerTitle || fallbackTitle);
}

function loadCustomQueue(tracks, startIndex = 0) {
  if (!player || !player.loadPlaylist) return;
  if (!Array.isArray(tracks) || tracks.length === 0) {
    clearAllTracks();
    return;
  }

  const knownTitles = {};
  videoLinks.forEach((v) => { if (v.id && v.title) knownTitles[v.id] = v.title; });

  usingYouTubePlaylist = false;
  activePlaylistId = '';
  activePlaylistTitle = '';
  videoLinks = tracks.map(track => {
    const id = (typeof track === 'string') ? track : track.id;
    const title = (typeof track === 'string') ? knownTitles[id] || '' : track.title || knownTitles[id] || '';
    const addedByName = (typeof track === 'string') ? '' : track.addedByName || '';
    return { id, title, addedByName };
  });

  const ids = videoLinks.map(v => v.id);
  currentIndex = Math.max(0, Math.min(startIndex, videoLinks.length - 1));
  initPlaylist();
  player.loadPlaylist(ids, currentIndex, 0);
  updateDisplayTitle(videoLinks[currentIndex].title || 'Track ' + (currentIndex + 1));
  updatePlaylistUI();
  if (videoLinks.some(v => !v.title)) {
    hydrateVideoTitles();
  }
  broadcastPlaylist();
}

function loadCustomQueueSilent(tracks, startIndex = 0) {
  if (!Array.isArray(tracks)) return;

  if (tracks.length === 0) {
    videoLinks = [];
    currentIndex = 0;
    usingYouTubePlaylist = false;
    activePlaylistId = '';
    activePlaylistTitle = '';
    if (player && player.stopVideo) player.stopVideo();
    updateDisplayTitle('Queue cleared');
    initPlaylist();
    return;
  }

  const knownTitles = {};
  videoLinks.forEach((v) => { if (v.id && v.title) knownTitles[v.id] = v.title; });

  usingYouTubePlaylist = false;
  activePlaylistId = '';
  activePlaylistTitle = '';
  const wasEmpty = videoLinks.length === 0;
  videoLinks = tracks.map((track) => ({
    id: track.id || track,
    title: track.title || knownTitles[track.id || track] || '',
    addedByName: track.addedByName || ''
  }));

  currentIndex = Math.max(0, Math.min(currentIndex, videoLinks.length - 1));
  initPlaylist();
  updatePlaylistUI();

  if (wasEmpty && videoLinks.length > 0) {
    const title = videoLinks[0].title || 'Loading track title...';
    updateDisplayTitle(title, /* broadcast= */ isSuperAdmin);
    if (isSuperAdmin && player && player.loadVideoById) {
      player.loadVideoById(videoLinks[0].id);
    }
  }

  hydrateVideoTitles();
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
      <button onclick="loadDefaultPlaylistAction()" style="background: rgba(0, 242, 254, 0.12); border: 1px solid rgba(0, 242, 254, 0.35); color: var(--accent-cyan); padding: 6px 14px; border-radius: var(--radius-sm); font-size: 11.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: var(--transition-fast);">
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

    // Filter matching:
    // Pinned: only tracks where isPinned is explicitly true
    // Requests: songs added remotely by guests/other devices
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
  if (usingYouTubePlaylist) {
    syncPlaylistFromPlayer();
    return;
  }

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

function syncPlaylistFromPlayer() {
  if (!usingYouTubePlaylist || !player) return;
  const playlist = player.getPlaylist && player.getPlaylist();
  if (!Array.isArray(playlist) || playlist.length === 0) return;

  if (videoLinks.length !== playlist.length) {
    videoLinks = playlist.map((id) => ({
      id,
      title: '',
      addedByName: getDeviceName(deviceId)
    }));
  }

  currentIndex = player.getPlaylistIndex ? player.getPlaylistIndex() : 0;
  refreshDisplayTitleFromPlayer();

  if (playlistContainer) {
    playlistContainer.innerHTML = '';
    videoLinks.forEach((link, index) => {
      playlistContainer.appendChild(createTrackItem(link, index, index === currentIndex));
    });
  }
  hydrateVideoTitles();
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
  const tasks = videoLinks.map(async (track, index) => {
    if (!track || track.title) return;
    const title = await fetchVideoTitle(track.id);
    if (title && videoLinks[index] && videoLinks[index].id === track.id) {
      videoLinks[index].title = title;
    }
  });

  await Promise.all(tasks);
  initPlaylist();

  // If the current display title is empty or says 'Queue cleared' but we have songs, update it!
  const currentTitleEl = document.getElementById('current-title');
  const curDisplay = currentTitleEl ? currentTitleEl.innerText.trim() : '';
  if (videoLinks.length > 0 && (!curDisplay || curDisplay === 'Queue cleared' || curDisplay === 'Loading track title...' || curDisplay === 'Select a track to begin')) {
    const activeTrack = videoLinks[currentIndex] || videoLinks[0];
    if (activeTrack && activeTrack.title) {
      updateDisplayTitle(activeTrack.title, /* broadcast= */ isSuperAdmin);
    }
  }

  updatePlaylistUI();
}

function createTrackItem(link, index, isActive) {
  const div = document.createElement('div');
  const isAudioPlaying = disk && disk.classList.contains('playing');
  div.className = `track-card ${isActive ? 'active-playing' : ''}`;
  div.dataset.trackIndex = index;
  div.draggable = !usingYouTubePlaylist;

  const addedBy = link.addedByName || 'Unknown';
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
    if (usingYouTubePlaylist) {
      if (isSuperAdmin && player && player.playVideoAt) player.playVideoAt(index);
      sendCommand('play-video', { index });
    } else {
      loadVideo(index);
    }
  };

  return div;
}

function togglePinTrack(index) {
  if (!videoLinks[index]) return;
  videoLinks[index].isPinned = !videoLinks[index].isPinned;
  initPlaylist();
  updatePlaylistUI();
  broadcastPlaylist();
  logActivity(`${videoLinks[index].isPinned ? 'Pinned track' : 'Unpinned track'}: ${videoLinks[index].title || 'Track'}`, 'pin');
}

function removeTrack(index) {
  if (!videoLinks[index]) return;
  const removedTitle = videoLinks[index].title || 'Track';
  const isRemovingCurrent = (index === currentIndex);

  videoLinks.splice(index, 1);

  if (videoLinks.length === 0) {
    clearAllTracks();
    return;
  }

  if (isRemovingCurrent) {
    currentIndex = Math.min(currentIndex, videoLinks.length - 1);
    if (isSuperAdmin && player && player.loadVideoById) {
      player.loadVideoById(videoLinks[currentIndex].id);
    }
    updateDisplayTitle(videoLinks[currentIndex].title);
  } else if (index < currentIndex) {
    currentIndex--;
  }

  initPlaylist();
  updatePlaylistUI();
  broadcastPlaylist();
  logActivity(`Removed: ${removedTitle}`, 'clear');
}

function clearAllTracks() {
  if (!isAuthorizedUser()) return;
  videoLinks = [];
  currentIndex = 0;
  usingYouTubePlaylist = false;
  activePlaylistId = '';
  activePlaylistTitle = '';
  if (player && player.stopVideo) player.stopVideo();
  updateDisplayTitle('Queue cleared');
  initPlaylist();
  broadcastPlaylist();
  sendCommand('clear-queue');
  logActivity('Cleared master queue', 'clear');
}

function loadDefaultPlaylistAction() {
  if (!isAuthorizedUser()) return;
  videoLinks = JSON.parse(JSON.stringify(DEFAULT_TRACKS));
  currentIndex = 0;
  usingYouTubePlaylist = false;
  activePlaylistId = '';
  activePlaylistTitle = '';

  initPlaylist();
  updatePlaylistUI();
  hydrateVideoTitles();
  broadcastPlaylist();

  const initialTitle = videoLinks[0].title || 'Armaan Malik - Dil Mein Ho Tum';
  updateDisplayTitle(initialTitle, /* broadcast= */ true);

  if (isSuperAdmin && player && player.loadVideoById) {
    player.loadVideoById(videoLinks[0].id);
  } else if (!isSuperAdmin) {
    sendCommand('play-video', { videoId: videoLinks[0].id, index: 0 });
  }

  logActivity('Restored default studio playlist', 'add');
}

function clearPlayedTracks() {
  if (!isAuthorizedUser()) return;
  if (videoLinks.length === 0 || currentIndex <= 0) return;
  const removedCount = currentIndex;
  videoLinks = videoLinks.slice(currentIndex);
  currentIndex = 0;

  initPlaylist();
  updatePlaylistUI();
  broadcastPlaylist();
  logActivity(`Cleared ${removedCount} played track(s)`, 'clear');
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
    [tabAll, tabPin, tabReq].forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeQueueFilter = filter;
    initPlaylist();
  }
});

// Drag & Drop Reordering
if (playlistContainer) {
  playlistContainer.addEventListener('dragstart', (event) => {
    if (usingYouTubePlaylist) return;
    const row = event.target.closest('.track-card[data-track-index]');
    if (!row) return;
    dragFromIndex = Number(row.dataset.trackIndex);
    row.classList.add('dragging');
  });

  playlistContainer.addEventListener('dragover', (event) => {
    if (usingYouTubePlaylist || dragFromIndex < 0) return;
    event.preventDefault();
  });

  playlistContainer.addEventListener('drop', (event) => {
    if (usingYouTubePlaylist || dragFromIndex < 0) return;
    const row = event.target.closest('.track-card[data-track-index]');
    if (!row) return;
    event.preventDefault();
    const dropIndex = Number(row.dataset.trackIndex);
    if (dragFromIndex !== dropIndex) {
      const moved = videoLinks[dragFromIndex];
      videoLinks.splice(dragFromIndex, 1);
      videoLinks.splice(dropIndex, 0, moved);
      if (currentIndex === dragFromIndex) currentIndex = dropIndex;
      initPlaylist();
      updatePlaylistUI();
      broadcastPlaylist();
    }
    dragFromIndex = -1;
  });
}

const linkInput = document.getElementById('link-input');
if (linkInput) {
  linkInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addLink();
  });
}

initPlaylist();

// =========================================================================
//  FIREBASE REAL-TIME REMOTE CONTROL SYSTEM
// =========================================================================
const SUPER_ADMIN_HASH = '0a72a68aee0043b23198c07dde1e0332fb80eef3fb87a5df882470ce7cd64c2c';
const DB_ROOT = 'sas-player';

let db = null;
let deviceId = null;
let deviceStatus = 'unknown';
let currentUserRole = 'guest';
let isAdmin = false;
let isSuperAdmin = false;
let lastAppliedTimestamp = 0;
let isCommandFromRemote = false;
let deviceNamesCache = {};

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

function getDeviceName(id) {
  const targetId = id || deviceId;

  if (targetId === deviceId) {
    const custom = localStorage.getItem('sas_device_name');
    if (custom) return custom;
    if (isSuperAdmin) return 'Super Admin';
    if (isAdmin) return `Admin (${getBrowserDeviceName()})`;
    return getBrowserDeviceName();
  }

  if (deviceNamesCache[targetId]) {
    return deviceNamesCache[targetId];
  }

  return 'Remote Client';
}

function getOrCreateDeviceId() {
  let id = localStorage.getItem('sas_device_id');
  if (!id) {
    id = 'dev_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now().toString(36);
    localStorage.setItem('sas_device_id', id);
  }
  return id;
}

function isAuthorizedUser() {
  return isSuperAdmin || isAdmin || deviceStatus === 'approved';
}

function initFirebase() {
  try {
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp({
        apiKey: atob('QUl6YVN5RHlvbTdoR2YxM1NLNVhEbjVtVl9oRWZHTnIwX2dqQzFJ'),
        authDomain: 'sas-premium-player.firebaseapp.com',
        databaseURL: 'https://sas-premium-player-default-rtdb.firebaseio.com',
        projectId: 'sas-premium-player',
        storageBucket: 'sas-premium-player.firebasestorage.app',
        messagingSenderId: '905309539571',
        appId: '1:905309539571:web:f62f028776dd80074efb86'
      });
    }
    db = firebase.database();
    deviceId = getOrCreateDeviceId();

    db.ref(DB_ROOT + '/devices').on('value', (snap) => {
      const devs = snap.val();
      if (!devs) return;
      for (const id in devs) {
        if (devs[id].name) deviceNamesCache[id] = devs[id].name;
      }
      renderAdminDeviceList(devs);
    });

    const savedRole = localStorage.getItem('sas_user_role');
    // SECURITY: localStorage is fully attacker-controlled (anyone can set it via
    // devtools). It must NEVER be trusted to grant real privilege flags on its
    // own — it's only used here as a cosmetic label so the UI doesn't flash
    // "guest" for a split second. isAdmin/isSuperAdmin are only ever flipped to
    // true inside listenToDeviceStatus(), once Firebase's own device record
    // (the actual source of truth) confirms the role.
    if (savedRole === 'super_admin' || savedRole === 'admin') {
      currentUserRole = savedRole;
    }

    listenToDeviceStatus();
    listenToCommands();
    listenToNowPlaying();
    listenToPlaylist();
    listenToVolume();
    listenToLiveEvents();
    showConnectionBadge('connected');

    // NOTE: activation for returning admins/super-admins now happens inside
    // listenToDeviceStatus() itself, the moment Firebase's real device record
    // confirms the role — never eagerly from localStorage (see note above).

    // Version enforcement: check against Firebase required version

    enforceAppVersion();

    // Populate version badge in navbar
    const versionBadge = document.getElementById('app-version-badge');
    if (versionBadge) versionBadge.textContent = 'v' + APP_VERSION;
  } catch (err) {
    console.error('Firebase error:', err);
    showConnectionBadge('error');
  }
}

function listenToDeviceStatus() {
  if (!db || !deviceId) return;
  let roleConfirmedOnce = false;
  db.ref(DB_ROOT + '/devices/' + deviceId).on('value', (snap) => {
    const data = snap.val();
    const newStatus = data ? data.status : 'unknown';
    const newRole = data ? (data.role || 'guest') : 'guest';

    // SECURITY: Firebase's own record for this device is the ONLY source of
    // truth for privilege flags. This branch both promotes AND demotes —
    // previously it only ever promoted, which meant a role flipped on via a
    // tampered localStorage value at page load was never corrected back down.
    if (newRole === 'super_admin' || newRole === 'admin') {
      const wasElevated = isAdmin || isSuperAdmin;
      isAdmin = true;
      isSuperAdmin = (newRole === 'super_admin');
      currentUserRole = newRole;
      localStorage.setItem('sas_user_role', newRole);
      if (!wasElevated || !roleConfirmedOnce) {
        // First confirmation this session (e.g. a returning admin reloading
        // the page) — run full activation (unmute policy, time-sync, presence).
        activateRoleMode(newRole, /* skipBroadcast= */ true);
        setTimeout(syncInitialState, 800);
      }
    } else {
      if (isAdmin || isSuperAdmin) {
        console.warn('[SAS Security] Firebase device record no longer grants elevated role — revoking locally');
      }
      isAdmin = false;
      isSuperAdmin = false;
      currentUserRole = 'guest';
      localStorage.removeItem('sas_user_role');
    }
    roleConfirmedOnce = true;

    deviceStatus = newStatus;
    if (newStatus === 'approved' || isAdmin || isSuperAdmin) {
      deviceStatus = 'approved';
      syncInitialState();
    }
    updateAccessUI(deviceStatus);
    updateControlAccessUI();
  });
}

function listenToCommands() {
  if (!db) return;
  db.ref(DB_ROOT + '/state').on('value', (snap) => {
    const cmd = snap.val();
    if (!cmd || !cmd.command || !cmd.timestamp) return;
    if (cmd.timestamp <= lastAppliedTimestamp) return;
    if (cmd.issuedBy === deviceId) return;

    if (!isSuperAdmin) return;

    lastAppliedTimestamp = cmd.timestamp;
    isCommandFromRemote = true;
    pendingCommandIssuer = cmd.issuedBy;
    applyRemoteCommand(cmd);
    setTimeout(() => { isCommandFromRemote = false; }, 1000);
  });
}

function listenToNowPlaying() {
  if (!db) return;
  db.ref(DB_ROOT + '/nowPlaying').on('value', (snap) => {
    const data = snap.val();
    if (!data) return;
    lastNowPlayingData = data;
    // Strict authorization guard: never leak or sync now-playing data to unauthorized guests
    if (!isAuthorizedUser()) return;
    applyNowPlayingUI(data);
  });
}

function applyNowPlayingUI(data) {
  if (!data) return;
  const isPlaying = !!data.isPlaying;
  let title = data.title;

  if (videoLinks.length > 0) {
    if (!title || title === 'Queue cleared' || title === 'Select a track to begin') {
      const activeTrack = videoLinks[data.trackIndex || 0] || videoLinks[0];
      title = (activeTrack && activeTrack.title) ? activeTrack.title : (activeTrack ? 'Loading track title...' : 'Select a track to begin');
    }
  } else {
    title = 'Queue cleared';
  }

  updatePlaybackUIState(isPlaying, title, data.trackIndex);

  // Synchronize video feed for non-super-admin (clients / admins)
  if (!isSuperAdmin) {
    const targetVideoId = data.videoId || (videoLinks[data.trackIndex] ? videoLinks[data.trackIndex].id : null);
    if (targetVideoId) {
      // Calculate target position in seconds taking network transit time into account
      let targetPosition = typeof data.currentTime === 'number' ? data.currentTime : 0;
      if (data.isPlaying && data.timestamp) {
        const elapsed = (Date.now() - data.timestamp) / 1000;
        if (elapsed > 0 && elapsed < 600) {
          targetPosition += elapsed;
        }
      }

      if (player && typeof player.loadVideoById === 'function') {
        if (player.mute && player.isMuted && !player.isMuted()) {
          player.mute();
        }

        // Determine what video is currently loaded in the YouTube player
        let currentLoadedId = '';
        if (typeof player.getVideoData === 'function') {
          const vd = player.getVideoData();
          if (vd && vd.video_id) currentLoadedId = vd.video_id;
        }
        if (!currentLoadedId) currentLoadedId = lastLoadedVideoId;

        const isDifferentVideo = (currentLoadedId !== targetVideoId);

        if (isDifferentVideo) {
          lastLoadedVideoId = targetVideoId;
          if (player.mute) player.mute();
          if (isPlaying) {
            player.loadVideoById({
              videoId: targetVideoId,
              startSeconds: Math.floor(targetPosition)
            });
            if (targetPosition > 1) {
              setTimeout(() => {
                try {
                  if (player && typeof player.seekTo === 'function') player.seekTo(targetPosition, true);
                } catch (_) { }
              }, 400);
            }
          } else {
            player.cueVideoById({
              videoId: targetVideoId,
              startSeconds: Math.floor(targetPosition)
            });
          }
        } else {
          // Same video: NEVER reload or cue! Only synchronize play/pause state.
          const playerState = (typeof player.getPlayerState === 'function') ? player.getPlayerState() : -1;

          if (isPlaying) {
            if (playerState !== YT.PlayerState.PLAYING && playerState !== YT.PlayerState.BUFFERING) {
              if (player.mute) player.mute();
              player.playVideo();
            }

            // Frame-accurate synchronization: correct drift whenever we're
            // supposed to be playing, regardless of the exact reported state.
            // Gating this on playerState === PLAYING meant a device stuck at
            // 0:00 (autoplay hiccup, still buffering/cued, etc.) never got
            // nudged to the right position — it just sat there showing the
            // start of the track until it happened to reach PLAYING on its
            // own, which could take a while or never fully catch up.
            if (typeof player.getCurrentTime === 'function' && typeof player.seekTo === 'function') {
              const curTime = player.getCurrentTime();
              if (typeof curTime === 'number') {
                const drift = Math.abs(curTime - targetPosition);
                if (drift > 3.0) {
                  player.seekTo(targetPosition, true);
                }
              }
            }
          } else {
            if (playerState !== YT.PlayerState.PAUSED && playerState !== YT.PlayerState.CUED) {
              player.pauseVideo();
            }
          }
        }
      } else {
        // Player not ready yet — queue target video and start timestamp for onPlayerReady
        pendingVideoId = targetVideoId;
        pendingIsPlaying = isPlaying;
        pendingStartSeconds = targetPosition;
      }
    }
  }
}

function listenToVolume() {
  if (!db) return;
  db.ref(DB_ROOT + '/volume').on('value', (snap) => {
    const data = snap.val();
    if (!data || typeof data.level !== 'number') return;
    lastVolumeData = data;
    // Strict authorization guard: never sync volume from host to unauthorized guests
    if (!isAuthorizedUser()) return;
    if (data.updatedBy === deviceId) return;
    applyVolumeUI(data);
  });
}

function applyVolumeUI(data) {
  syncVolume(data.level, false);
}

function applyRemoteCommand(cmd) {
  switch (cmd.command) {
    case 'play':
      if (isSuperAdmin && player && player.playVideo) player.playVideo();
      break;
    case 'pause':
      if (isSuperAdmin && player && player.pauseVideo) player.pauseVideo();
      break;
    case 'toggle-play-pause':
      toggleMainPlayback();
      break;
    case 'next':
      playNext();
      break;
    case 'prev':
      playPrev();
      break;
    case 'play-video':
      if (cmd.data && cmd.data.videoId) {
        // Update currentIndex so nowPlaying broadcast has the correct track
        if (typeof cmd.data.index === 'number') {
          currentIndex = cmd.data.index;
        }
        if (isSuperAdmin && player && player.loadVideoById) {
          player.loadVideoById(cmd.data.videoId);
        }
        // Update display title from playlist data
        if (videoLinks[currentIndex]) {
          updateDisplayTitle(videoLinks[currentIndex].title || 'Loading track title...');
        }
        updatePlaylistUI();
      }
      break;
    case 'volume':
      if (cmd.data && typeof cmd.data.level === 'number') {
        syncVolume(cmd.data.level, false);
      }
      break;
    case 'clear-queue':
      if (isSuperAdmin && player && player.stopVideo) player.stopVideo();
      videoLinks = [];
      currentIndex = 0;
      updateDisplayTitle('Queue cleared');
      initPlaylist();
      break;
  }
}

function sendCommand(command, data) {
  if (!db || !deviceId) return;
  if (isCommandFromRemote) return;
  if (deviceStatus !== 'approved' && !isAdmin) return;

  if (command === 'volume' && data && typeof data.level === 'number') {
    db.ref(DB_ROOT + '/volume').set({
      level: data.level,
      updatedAt: Date.now(),
      updatedBy: deviceId
    });
    return;
  }

  db.ref(DB_ROOT + '/state').set({
    command,
    data: data || null,
    timestamp: Date.now(),
    issuedBy: deviceId
  });
}

function broadcastNowPlaying(title, isPlaying) {
  if (!db || !deviceId) return;
  if (!isSuperAdmin) return; // Strict: Only Super Admin host can broadcast now-playing state

  let curVideoId = '';
  let curTime = 0;
  if (player) {
    if (typeof player.getVideoData === 'function') {
      const vd = player.getVideoData();
      if (vd && vd.video_id) curVideoId = vd.video_id;
    }
    if (typeof player.getCurrentTime === 'function') {
      curTime = player.getCurrentTime() || 0;
    }
  }
  if (!curVideoId && videoLinks[currentIndex]) {
    curVideoId = videoLinks[currentIndex].id;
  }

  // Ensure currentIndex matches the real playing video in videoLinks
  if (curVideoId) {
    const matchedIdx = videoLinks.findIndex((v) => v.id === curVideoId);
    if (matchedIdx !== -1) {
      currentIndex = matchedIdx;
    }
  }

  const broadcastTitle = title || (videoLinks[currentIndex] ? videoLinks[currentIndex].title : '') || 'SAS Player';

  db.ref(DB_ROOT + '/nowPlaying').set({
    title: broadcastTitle,
    isPlaying: !!isPlaying,
    trackIndex: currentIndex,
    videoId: curVideoId,
    currentTime: Math.round(curTime * 10) / 10,
    timestamp: Date.now(),
    updatedAt: Date.now(),
    updatedBy: lastCommandIssuer || deviceId
  });
}

function broadcastPlaylist() {
  if (!db || !deviceId) return;
  if (isCommandFromRemote) return;
  if (!isAuthorizedUser()) return;
  const tracks = videoLinks.map((v) => ({ id: v.id, title: v.title, addedByName: v.addedByName || '' }));
  db.ref(DB_ROOT + '/playlist').set({
    tracks,
    currentIndex,
    updatedAt: Date.now(),
    updatedBy: deviceId
  });
}

function listenToPlaylist() {
  if (!db) return;
  db.ref(DB_ROOT + '/playlist').on('value', (snap) => {
    const data = snap.val();
    if (!data) return;
    // Strict authorization guard: never sync playlist to unauthorized guests
    if (!isAuthorizedUser()) return;
    if (data.updatedBy === deviceId) return;

    const remoteTracks = data.tracks || (data.ids ? data.ids.map(id => ({ id, addedByName: '' })) : []);
    const remoteIds = remoteTracks.map(t => t.id);
    const localIds = videoLinks.map(v => v.id);

    if (JSON.stringify(remoteIds) === JSON.stringify(localIds)) return;

    isCommandFromRemote = true;
    loadCustomQueueSilent(remoteTracks, currentIndex);
    setTimeout(() => { isCommandFromRemote = false; }, 200);
  });
}

function syncInitialState() {
  if (!db || !isAuthorizedUser()) return;

  // 1. Sync Playlist from Firebase
  db.ref(DB_ROOT + '/playlist').once('value', (snap) => {
    const data = snap.val();
    if (!data) return;
    const remoteTracks = data.tracks || (data.ids ? data.ids.map(id => ({ id, addedByName: '' })) : null);
    if (!Array.isArray(remoteTracks) || remoteTracks.length === 0) return;
    if (!isAuthorizedUser()) return;

    const remoteIds = remoteTracks.map(t => t.id);
    const localIds = videoLinks.map(v => v.id);
    if (JSON.stringify(remoteIds) !== JSON.stringify(localIds)) {
      isCommandFromRemote = true;
      loadCustomQueueSilent(remoteTracks, currentIndex);
      setTimeout(() => { isCommandFromRemote = false; }, 200);
    }
  });

  // 2. Sync Now Playing (Title, Play State, Track Index) for ALL Authorized Devices
  db.ref(DB_ROOT + '/nowPlaying').once('value', (snap) => {
    const data = snap.val();
    if (!data) return;
    lastNowPlayingData = data;
    applyNowPlayingUI(data);

    if (isSuperAdmin && data.videoId) {
      const currentVideoId = videoLinks[currentIndex] ? videoLinks[currentIndex].id : null;
      if (data.videoId !== currentVideoId && player && player.loadVideoById) {
        player.loadVideoById(data.videoId);
      }
    }
  });

  // 3. Sync Volume for ALL Authorized Devices
  db.ref(DB_ROOT + '/volume').once('value', (snap) => {
    const data = snap.val();
    if (data && typeof data.level === 'number') {
      lastVolumeData = data;
      applyVolumeUI(data);
    }
  });
}

function updateRemotePlayPauseIcon(isPlaying) {
  const btn = document.getElementById('remote-play-pause');
  if (btn) {
    const icon = btn.querySelector('i');
    if (icon) icon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
  }
}

function showConnectionBadge(status) {
  const badge = document.getElementById('connection-badge');
  const text = document.getElementById('connection-status-text');
  const chipText = document.getElementById('telemetry-status-text');
  if (!badge) return;

  badge.classList.remove('hidden', 'error');
  if (status === 'connected') {
    if (text) text.textContent = 'Connected to Host Realtime Bus';
    if (chipText) chipText.textContent = 'RTDB: 11ms • Synced';
  } else {
    badge.classList.add('error');
    if (text) text.textContent = 'Connection Offline';
    if (chipText) chipText.textContent = 'RTDB: Offline';
  }
  setTimeout(() => { badge.classList.add('hidden'); }, 3000);
}

function updateAccessUI(status) {
  const btn = document.getElementById('request-access-btn');
  const panel = document.getElementById('remote-control-panel');
  updateControlAccessUI();
  if (!btn) return;

  btn.classList.remove('pending', 'revoked');
  if (status === 'approved' || isAdmin || isSuperAdmin) {
    btn.querySelector('span').textContent = 'Remote';
    if (panel) panel.classList.remove('hidden');
  } else if (status === 'pending') {
    btn.classList.add('pending');
    btn.querySelector('span').textContent = 'Pending';
    if (panel) panel.classList.add('hidden');
  } else if (status === 'revoked') {
    btn.classList.add('revoked');
    btn.querySelector('span').textContent = 'Revoked';
    if (panel) panel.classList.add('hidden');
  } else {
    btn.querySelector('span').textContent = 'Remote';
    if (panel) panel.classList.add('hidden');
  }
}

// Locks the real playback/queue controls in the DOM for anyone who isn't an
// authorized device (approved guest, admin, or super admin). This is a UX
// safety net, not the actual security boundary — the real enforcement is the
// isAuthorizedUser()/isAdmin gates already in sendCommand(), broadcastPlaylist(),
// broadcastNowPlaying(), and the queue-management functions. Locking the UI
// just stops unauthorized visitors from clicking things that will silently
// no-op, which was confusing.
function updateControlAccessUI() {
  const authorized = isAuthorizedUser();
  const selectors = [
    '#link-input', '#remote-link-input',
    '#master-volume-slider', '#remote-volume-slider',
    '.transport-btn', '.remote-btn',
    '.queue-actions button',
    '#play-pause-btn', '#remote-add-btn'
  ];
  document.querySelectorAll(selectors.join(',')).forEach((el) => {
    el.disabled = !authorized;
    el.style.opacity = authorized ? '' : '0.4';
    el.style.cursor = authorized ? '' : 'not-allowed';
  });
  const disk = document.getElementById('spinning-disk');
  if (disk) disk.style.cursor = authorized ? 'pointer' : 'not-allowed';
}

function activateRoleMode(role, skipBroadcast = false) {
  currentUserRole = role;
  isAdmin = (role === 'admin' || role === 'super_admin');
  isSuperAdmin = (role === 'super_admin');
  localStorage.setItem('sas_user_role', role);

  // Audio output policy: super admin hosts audio output; non-super-admin remains muted
  if (player) {
    if (isSuperAdmin && typeof player.unMute === 'function') {
      player.unMute();
    } else if (!isSuperAdmin && typeof player.mute === 'function') {
      player.mute();
    }
  }

  // Time-sync service: super admin broadcasts high-precision timestamps
  if (isSuperAdmin) {
    startTimeSync();
  } else if (timeSyncInterval) {
    clearInterval(timeSyncInterval);
    timeSyncInterval = null;
  }

  const defaultName = isSuperAdmin ? 'Super Admin' : 'Admin';
  const deviceName = localStorage.getItem('sas_device_name') || defaultName;
  if (db && deviceId) {
    db.ref(DB_ROOT + '/devices/' + deviceId).update({
      name: deviceName,
      status: 'approved',
      role: role,
      requestedAt: Date.now(),
      lastActive: Date.now()
    });
  }
  listenToAllDevices();
  deviceStatus = 'approved';
  updateAccessUI('approved');

  if (!skipBroadcast) {
    setTimeout(() => {
      broadcastPlaylist();
      const titleEl = document.getElementById('current-title');
      broadcastNowPlaying(titleEl ? titleEl.innerText : '', disk && disk.classList.contains('playing'));
    }, 300);
  }
}

function listenToAllDevices() {
  if (!db) return;
  db.ref(DB_ROOT + '/devices').on('value', (snap) => {
    const devices = snap.val() || {};
    renderAdminDeviceList(devices);
  });
}

function renderAdminDeviceList(devices) {
  const listEl = document.getElementById('admin-device-list');
  const fleetEl = document.getElementById('fleet-device-list');
  const fleetCountEl = document.getElementById('fleet-count-badge');
  const entries = Object.entries(devices || {});

  // Unauthorized guests only see their isolated local player in the fleet deck
  if (!isAuthorizedUser()) {
    if (fleetCountEl) fleetCountEl.textContent = '1';
    if (fleetEl) {
      fleetEl.innerHTML = `
        <div class="device-node-card">
          <div class="device-node-top">
            <div class="device-node-identity">
              <i class="fas fa-headphones"></i>
              <span>Local Player</span>
              <span style="font-size:10px;color:var(--text-muted);">(You)</span>
            </div>
            <span class="device-role-pill guest">GUEST</span>
          </div>
          <div class="device-node-stats-row">
            <span>Standalone Player</span>
            <span style="color: var(--text-dim);">● Local Only</span>
          </div>
        </div>`;
    }
    return;
  }

  if (fleetCountEl) fleetCountEl.textContent = entries.length || '1';

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
      fleetEl.innerHTML = entries.map(([id, device]) => {
        const isSelf = id === deviceId;
        const role = device.role || 'guest';
        const isHost = (role === 'super_admin');
        const icon = isHost ? 'fa-desktop' : (device.name && device.name.toLowerCase().includes('phone') ? 'fa-mobile-alt' : 'fa-laptop');
        return `
          <div class="device-node-card ${isHost ? 'host-transmitter' : ''}">
            <div class="device-node-top">
              <div class="device-node-identity">
                <i class="fas ${icon}" style="${isHost ? 'color: var(--accent-gold);' : ''}"></i>
                <span>${escapeHtml(device.name || 'Device')}</span>
                ${isSelf ? '<span style="font-size:10px;color:var(--text-muted);">(You)</span>' : ''}
              </div>
              <span class="device-role-pill ${role}">${escapeHtml(role.replace('_', ' '))}</span>
            </div>
            <div class="device-node-stats-row">
              <span>${isHost ? 'Host Master' : 'Client Node'}</span>
              <span style="color: ${device.status === 'approved' ? 'var(--accent-green)' : (device.status === 'pending' ? '#f39c12' : '#e74c3c')};">● ${escapeHtml(device.status || 'Active')}</span>
            </div>
          </div>`;
      }).join('');
    }
  }

  // Render Modal Device List
  if (listEl) {
    if (entries.length === 0) {
      listEl.innerHTML = '<div class="admin-no-devices" style="text-align:center; padding:20px; color:var(--text-muted);">No devices yet. Share the site URL to get started.</div>';
      return;
    }

    listEl.innerHTML = entries.map(([id, device]) => {
      const isSelf = id === deviceId;
      const targetRole = device.role || 'guest';
      const isTargetSuperAdmin = targetRole === 'super_admin';
      const isTargetAdmin = targetRole === 'admin';

      let actionsHtml = '';
      if (!isSelf) {
        if (isSuperAdmin) {
          actionsHtml += '<div class="device-actions">';
          if (!isTargetSuperAdmin) {
            if (isTargetAdmin) {
              actionsHtml += `<button class="demote-btn" onclick="setDeviceRole('${escapeHtml(id)}', 'guest')"><i class="fas fa-user"></i> Demote</button>`;
            } else {
              actionsHtml += `<button class="promote-btn" onclick="setDeviceRole('${escapeHtml(id)}', 'admin')"><i class="fas fa-user-shield"></i> Make Admin</button>`;
            }
            if (device.status === 'approved') {
              actionsHtml += `<button class="revoke-btn" onclick="revokeDevice('${escapeHtml(id)}')"><i class="fas fa-ban"></i> Revoke</button>`;
            } else {
              actionsHtml += `<button class="approve-btn" onclick="approveDevice('${escapeHtml(id)}')"><i class="fas fa-check"></i> Approve</button>`;
            }
          }
          actionsHtml += `<button class="revoke-btn delete-btn" onclick="deleteDevice('${escapeHtml(id)}')"><i class="fas fa-trash"></i></button>`;
          actionsHtml += '</div>';
        }
      }

      return `
        <div class="device-card ${escapeHtml(device.status || '')}">
          <div class="device-info">
            <div class="device-name">
              ${escapeHtml(device.name || 'Unknown Device')} ${isSelf ? '<span style="font-size:10px;color:var(--text-muted);margin-left:6px;">(You)</span>' : ''}
              <span class="device-role-pill ${targetRole}" style="margin-left:8px;">${escapeHtml(targetRole.replace('_', ' '))}</span>
            </div>
            <div class="device-meta">
              <span class="device-status-badge ${escapeHtml(device.status || '')}">${escapeHtml(device.status || '')}</span>
              <span class="device-id-text">${escapeHtml(id.substring(0, 16))}...</span>
            </div>
          </div>
          ${actionsHtml}
        </div>`;
    }).join('');

    const clearBtn = document.getElementById('clear-all-devices-btn');
    if (clearBtn) {
      const hasOthers = entries.some(([id]) => id !== deviceId);
      clearBtn.classList.toggle('hidden', !isSuperAdmin || !hasOthers);
    }
  }
}

function setDeviceRole(id, role) {
  if (!isSuperAdmin || !db) return;
  db.ref(DB_ROOT + '/devices/' + id).update({ role, status: 'approved' });
}

function approveDevice(id) {
  if ((!isAdmin && !isSuperAdmin) || !db) return;
  db.ref(DB_ROOT + '/devices/' + id + '/status').set('approved');
}

function revokeDevice(id) {
  if ((!isAdmin && !isSuperAdmin) || !db) return;
  db.ref(DB_ROOT + '/devices/' + id + '/status').set('revoked');
}

function deleteDevice(id) {
  if ((!isAdmin && !isSuperAdmin) || !db) return;
  if (confirm('Remove this device entry from the list?')) {
    db.ref(DB_ROOT + '/devices/' + id).remove();
  }
}

function clearAllOtherDevices() {
  if (!isSuperAdmin || !db) return;
  if (!confirm('This will remove ALL other device entries except yours. Continue?')) return;
  db.ref(DB_ROOT + '/devices').once('value', (snap) => {
    const devices = snap.val();
    if (!devices) return;
    const updates = {};
    Object.keys(devices).forEach((id) => {
      if (id !== deviceId) updates[id] = null;
    });
    if (Object.keys(updates).length > 0) {
      db.ref(DB_ROOT + '/devices').update(updates);
    }
  });
}

function logoutAdmin() {
  if (confirm('Are you sure you want to logout from admin mode?')) {
    localStorage.removeItem('sas_user_role');
    if (db && deviceId) {
      db.ref(DB_ROOT + '/devices/' + deviceId).update({ role: 'guest', status: 'unknown' });
    }
    isAdmin = false;
    isSuperAdmin = false;
    currentUserRole = 'guest';
    closeAdminPanel();
    updateAccessUI('unknown');
  }
}

function openAccessModal() {
  document.getElementById('access-request-overlay')?.classList.remove('hidden');
}

function closeAccessModal() {
  document.getElementById('access-request-overlay')?.classList.add('hidden');
}

function closeAccessModalOnBackdrop(e) {
  if (e.target === e.currentTarget) closeAccessModal();
}

function requestAccess() {
  const nameInput = document.getElementById('device-name-input');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) { alert('Please enter your device or user name.'); return; }
  localStorage.setItem('sas_device_name', name);
  if (db && deviceId) {
    db.ref(DB_ROOT + '/devices/' + deviceId).set({
      name,
      status: 'pending',
      role: 'guest',
      requestedAt: Date.now(),
      lastActive: Date.now()
    });
  }
  deviceStatus = 'pending';
  updateAccessUI('pending');
  closeAccessModal();
  alert('Access requested! The host admin can approve you in the admin panel.');
}

let remotePanelMinimized = false;
function toggleRemotePanel() {
  const panel = document.getElementById('remote-control-panel');
  const stickyBtn = document.getElementById('sticky-remote-btn');
  if (!panel || !stickyBtn) return;

  if (remotePanelMinimized) {
    panel.classList.remove('hidden');
    stickyBtn.classList.add('hidden');
    remotePanelMinimized = false;
  } else {
    panel.classList.add('hidden');
    stickyBtn.classList.remove('hidden');
    remotePanelMinimized = true;
  }
}

async function hashPassphrase(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.prototype.map.call(new Uint8Array(buf), x => (('00' + x.toString(16)).slice(-2))).join('');
}

async function openAdminPanel() {
  const savedRole = localStorage.getItem('sas_user_role');
  if (savedRole === 'super_admin' || savedRole === 'admin') {
    showAdminPanelModal();
    return;
  }

  const entered = prompt('Enter Super Admin or Admin Passphrase:');
  if (!entered) return;

  const enteredHash = await hashPassphrase(entered.trim());
  if (enteredHash === SUPER_ADMIN_HASH) {
    activateRoleMode('super_admin');
    showAdminPanelModal();
  } else {
    alert('Invalid Passphrase.');
  }
}

function showAdminPanelModal() {
  const overlay = document.getElementById('admin-panel-overlay');
  if (overlay) overlay.classList.remove('hidden');
  if (db) {
    db.ref(DB_ROOT + '/devices').once('value', (snap) => {
      renderAdminDeviceList(snap.val() || {});
    });
  }
}

function closeAdminPanel() {
  document.getElementById('admin-panel-overlay')?.classList.add('hidden');
}

function closeAdminPanelOnBackdrop(e) {
  if (e.target === e.currentTarget) closeAdminPanel();
}

function bindRemoteEvents() {
  const rPlayPause = document.getElementById('remote-play-pause');
  const rPrev = document.getElementById('remote-prev');
  const rNext = document.getElementById('remote-next');
  const rVol = document.getElementById('remote-volume-slider');
  const rAdd = document.getElementById('remote-add-btn');
  const rInput = document.getElementById('remote-link-input');

  if (rPlayPause) {
    rPlayPause.addEventListener('click', toggleMainPlayback);
  }
  if (rPrev) rPrev.addEventListener('click', playPrev);
  if (rNext) rNext.addEventListener('click', playNext);
  if (rVol) {
    rVol.addEventListener('input', (e) => {
      const level = parseInt(e.target.value, 10);
      syncVolume(level, true);
    });
  }
  if (rAdd && rInput) {
    rAdd.addEventListener('click', () => {
      const url = rInput.value.trim();
      if (!url) return;
      insertTrack(url, getDeviceName(deviceId));
      rInput.value = '';
    });
    rInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') rAdd.click();
    });
  }
}

// Media Session Integration
function initMediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.setActionHandler('play', () => { if (player && player.playVideo) player.playVideo(); });
  navigator.mediaSession.setActionHandler('pause', () => { if (player && player.pauseVideo) player.pauseVideo(); });
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

function clearMediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = 'paused';
}

// Picture-in-Picture Mini Player
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

// =========================================================================
//  VISIBILITY RECOVERY & PLAYER HEALTH CHECK (Issue 1)
// =========================================================================

// When the super admin's screen turns off or tab is backgrounded, the YT player
// silently suspends. This system detects when visibility returns and auto-recovers.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isSuperAdmin && player) {
    // Screen just woke up — check if player needs recovery
    setTimeout(() => {
      if (!player || !player.getPlayerState) return;
      const currentState = player.getPlayerState();

      // If we expected playing but player is paused/unstarted/cued, auto-resume
      if (expectedPlaybackState === 'playing' &&
        currentState !== YT.PlayerState.PLAYING &&
        currentState !== YT.PlayerState.BUFFERING) {
        console.log('[SAS Recovery] Visibility restored — resuming frozen playback');
        player.playVideo();
        logActivity('Auto-recovered playback after screen wake', 'play', /* forceBroadcast= */ false);
      }

      // Re-broadcast current state so remote clients get fresh data
      const vd = player.getVideoData && player.getVideoData();
      const title = (vd && vd.title) ? vd.title.trim() : (document.getElementById('current-title')?.innerText || '');
      broadcastNowPlaying(title, player.getPlayerState() === YT.PlayerState.PLAYING);
    }, 500); // Small delay to let the player iframe reactivate
  }
});

function startPlayerHealthCheck() {
  if (healthCheckInterval) clearInterval(healthCheckInterval);
  if (!isSuperAdmin) return;

  healthCheckInterval = setInterval(() => {
    if (!player || !player.getPlayerState || !isSuperAdmin) return;

    const currentState = player.getPlayerState();

    // If we expected playing but player is frozen (paused/unstarted/cued and NOT ended)
    if (expectedPlaybackState === 'playing' &&
      currentState !== YT.PlayerState.PLAYING &&
      currentState !== YT.PlayerState.BUFFERING &&
      currentState !== YT.PlayerState.ENDED) {
      console.log('[SAS HealthCheck] Player desync detected — expected playing, got state:', currentState);
      player.playVideo();
    }
  }, 15000); // Every 15 seconds
}

function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (!isSuperAdmin || !db) return;

  // Write heartbeat immediately, then every 30 seconds
  const writeHeartbeat = () => {
    db.ref(DB_ROOT + '/heartbeat').set({
      timestamp: Date.now(),
      deviceId: deviceId,
      version: APP_VERSION
    });
  };

  writeHeartbeat();
  heartbeatInterval = setInterval(writeHeartbeat, 30000);
}

// Time-sync broadcaster (Super Admin -> All Remotes)
function startTimeSync() {
  if (timeSyncInterval) clearInterval(timeSyncInterval);
  if (!isSuperAdmin) return;

  timeSyncInterval = setInterval(() => {
    if (!isSuperAdmin || !player || typeof player.getPlayerState !== 'function') return;
    const state = player.getPlayerState();
    if (state === YT.PlayerState.PLAYING) {
      const curTitle = document.getElementById('current-title')?.innerText || '';
      broadcastNowPlaying(curTitle, true);
    }
  }, 3000);
}

// =========================================================================
//  VERSION ENFORCEMENT (Issue 6)
// =========================================================================

function enforceAppVersion() {
  if (!db) return;

  // Super admin publishes the current required version
  if (isSuperAdmin) {
    db.ref(DB_ROOT + '/appVersion').set({
      version: APP_VERSION,
      updatedAt: Date.now()
    });
  }

  // ALL clients listen for version changes and force-reload if outdated
  db.ref(DB_ROOT + '/appVersion').on('value', (snap) => {
    const data = snap.val();
    if (!data || !data.version) return;

    if (data.version !== APP_VERSION) {
      console.warn('[SAS Version] Outdated version detected. Local:', APP_VERSION, 'Required:', data.version);
      // Show a brief notice then force reload
      const notice = document.createElement('div');
      notice.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#e50914;color:white;text-align:center;padding:14px;font-weight:700;font-size:14px;font-family:sans-serif;';
      notice.textContent = 'New version available — reloading...';
      document.body.appendChild(notice);

      // Clear service worker caches before reloading
      if ('caches' in window) {
        caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => {
          setTimeout(() => location.reload(true), 1200);
        });
      } else {
        setTimeout(() => location.reload(true), 1200);
      }
    }
  });
}

// =========================================================================
//  SECURITY: ROLE RE-VALIDATION (Issue 5)
// =========================================================================

function validateRoleFromFirebase() {
  if (!db || !deviceId) return;

  db.ref(DB_ROOT + '/devices/' + deviceId).once('value', (snap) => {
    const data = snap.val();
    const savedRole = localStorage.getItem('sas_user_role');

    if (!data) {
      // Device record doesn't exist in Firebase at all — no role, elevated or
      // not, can be trusted from localStorage alone. Nothing self-registers
      // without a real Firebase record (super_admin included).
      if (savedRole === 'admin' || savedRole === 'super_admin') {
        console.warn('[SAS Security] Elevated role claimed but no Firebase record — reverting to guest');
        localStorage.removeItem('sas_user_role');
        isAdmin = false;
        isSuperAdmin = false;
        currentUserRole = 'guest';
        updateAccessUI('unknown');
      }
      return;
    }

    const firebaseRole = data.role || 'guest';

    // If locally claiming an elevated role but Firebase disagrees — revoke
    // (prevents localStorage tampering for admin AND super_admin alike).
    if ((savedRole === 'admin' || savedRole === 'super_admin') && firebaseRole !== savedRole) {
      console.warn(`[SAS Security] Role mismatch: local=${savedRole}, Firebase=${firebaseRole} — reverting`);
      localStorage.removeItem('sas_user_role');
      isAdmin = false;
      isSuperAdmin = false;
      currentUserRole = 'guest';
      updateAccessUI('unknown');
    }
  });
}

// =========================================================================
//  SERVICE WORKER UPDATE LISTENER (Issue 6)
// =========================================================================

function listenForSWUpdates() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SW_UPDATED') {
      console.log('[SAS SW] New service worker activated — reloading for update');
      // Clear caches and reload
      if ('caches' in window) {
        caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => {
          location.reload(true);
        });
      } else {
        location.reload(true);
      }
    }
  });

  // Also check for waiting service workers and skip them
  navigator.serviceWorker.ready.then((registration) => {
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }

    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'activated') {
            // New SW is active — will receive its postMessage
          }
        });
      }
    });
  });
}

// Lifecycle Boot
window.addEventListener('load', () => {
  updateControlAccessUI(); // fail-closed: locked until Firebase confirms otherwise
  bindRemoteEvents();
  if (typeof firebase !== 'undefined') {
    initFirebase();
  }
  initMediaSession();
  initPiPButton();
  listenForSWUpdates();

  // Start health check, heartbeat, and time sync after a delay (allows player to initialize)
  setTimeout(() => {
    startPlayerHealthCheck();
    startHeartbeat();
    startTimeSync();
  }, 3000);
});
