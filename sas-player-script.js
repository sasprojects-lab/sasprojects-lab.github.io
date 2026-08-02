// Default Tracks
let videoLinks = [
  { id: 'byitAI7kkOM', title: 'Armaan Malik - Dil Mein Ho Tum' },
  { id: 'W1y8blwMLxY', title: 'Jubin Nautiyal - Barbaad' },
  { id: '2FPTVYj3ouE', title: 'Khaali Salam Dua' },
  { id: 'ia5CdcuqSWk', title: 'Terre Pyaar Mein' },
  { id: 'BvPNWCzQMec', title: 'Bekhudi' },
  { id: 'kKljXVVkgS4', title: 'Sanam Teri kasam' },
  { id: 'ztPa6vkM-yY', title: 'Guzarish' },
  { id: 'u4wmmGrI4pE', title: 'Chaand Jaise Mukhde Pe Bindiya Sitara' },
  { id: 'TqR_jWfHW4g', title: 'Humnava' },
  { id: 'ayzN5Il56co', title: 'Chori Chori Yun Jab Ho' },
  { id: 'R7spJ7YjNOY', title: 'Love Letter' },
  { id: '1a--6kZ8LCY', title: 'Hug Me' },
  { id: 'AbkEmIgJMcU', title: 'Pal Pal' },
  { id: 'wCTmWy43HgM', title: 'Haseen' },
  { id: 'QRwLbf3PwO8', title: 'Qayade Se' },
{ id: 'yHJf8MSPHk0', title: 'Baatein ye Kabhi na' }

];


    let player;
    let currentIndex = 0;
    let usingYouTubePlaylist = false;
    let activePlaylistId = '';
    let activePlaylistTitle = '';
    const titleCache = {};
    let dragFromIndex = -1;
    let isLightMode = false;
    let isThemeAnimating = false;
    let shouldResumeOnFocus = false;
    const disk = document.getElementById('spinning-disk');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const playPauseIcon = playPauseBtn.querySelector('i');
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const skyTransition = document.getElementById('sky-transition');

    function wait(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function toggleTheme() {
      if (isThemeAnimating) {
        return;
      }

      isThemeAnimating = true;
      themeToggleBtn.disabled = true;

      const turningLightOn = !isLightMode;
      skyTransition.classList.remove('dawn', 'dusk', 'active');
      skyTransition.classList.add(turningLightOn ? 'dawn' : 'dusk');
      void skyTransition.offsetWidth;
      skyTransition.classList.add('active');
      isLightMode = turningLightOn;
      document.body.classList.toggle('light-mode', isLightMode);

      await wait(2800);
      skyTransition.classList.remove('active', 'dawn', 'dusk');

      const icon = themeToggleBtn.querySelector('i');
      const label = themeToggleBtn.querySelector('span');
      if (isLightMode) {
        icon.className = 'fas fa-moon';
        label.innerText = 'Dark';
      } else {
        icon.className = 'fas fa-sun';
        label.innerText = 'Light';
      }

      themeToggleBtn.disabled = false;
      isThemeAnimating = false;
    }

    // Initialize YouTube Player
    function onYouTubeIframeAPIReady() {
      player = new YT.Player('yt-iframe', {
        height: '100%',
        width: '100%',
        videoId: videoLinks[0].id,
        playerVars: {
          'autoplay': 0,
          'controls': 1,
          'rel': 0,
          'playsinline': 1,
          'enablejsapi': 1
        },
        events: {
          'onStateChange': onPlayerStateChange
        }
      });
    }

    function addLink() {
      const input = document.getElementById('link-input');
      const rawInput = input.value.trim();

      if (!rawInput) {
        return;
      }

      const urls = rawInput.split(/\s+/).filter(Boolean);

      // Check for direct video tracks first
      const parsedTracks = [];
      urls.forEach((url) => {
        const videoId = extractVideoID(url);
        if (videoId) {
          parsedTracks.push({
            id: videoId,
            title: ''
          });
        }
      });

      // Case 1: Video tracks found (append to existing queue)
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
          loadVideo(0);
        } else {
          initPlaylist();
          updatePlaylistUI();
        }

        hydrateVideoTitles();
        broadcastPlaylist();
        input.value = '';
        return;
      }

      // Case 2: No video tracks found, but a single pure playlist URL was provided
      const playlistId = urls.length === 1 ? extractPlaylistID(urls[0]) : null;
      if (playlistId) {
        usingYouTubePlaylist = true;
        activePlaylistId = playlistId;
        videoLinks = [];
        currentIndex = 0;
        initPlaylist();
        loadYouTubePlaylist(playlistId, 0);
        input.value = '';
        return;
      }

      alert("Please enter valid YouTube video URL(s) or one playlist URL.");
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

    function onPlayerStateChange(event) {
      const isPlaying = event.data == YT.PlayerState.PLAYING;
      if (isPlaying) {
        document.body.classList.add('is-playing');
        disk.classList.add('playing');
        playPauseIcon.className = 'fas fa-pause';
        refreshDisplayTitleFromPlayer();
        updatePlaylistUI();
        // Update OS media widget with current track title
        const titleEl = document.getElementById('current-title');
        updateMediaSession(titleEl ? titleEl.innerText : '', 'SAS Player');
      } else {
        document.body.classList.remove('is-playing');
        disk.classList.remove('playing');
        playPauseIcon.className = 'fas fa-play';
        clearMediaSession();
      }

      updateRemotePlayPauseIcon(isPlaying);
      const npDot = document.getElementById('remote-np-dot');
      if (npDot) npDot.classList.toggle('playing', isPlaying);

      // Autoplay logic: when video ends, play next
      if (event.data == YT.PlayerState.ENDED) {
        playNext();
      }
    }

    document.addEventListener('visibilitychange', () => {
      if (!player || !player.getPlayerState) return;

      if (document.hidden) {
        shouldResumeOnFocus = player.getPlayerState() === YT.PlayerState.PLAYING;
        return;
      }

      if (shouldResumeOnFocus) {
        player.playVideo();
      }
      shouldResumeOnFocus = false;
    });

    window.addEventListener('pageshow', () => {
      if (shouldResumeOnFocus && player && player.playVideo) {
        player.playVideo();
        shouldResumeOnFocus = false;
      }
    });

    window.addEventListener('focus', () => {
      if (shouldResumeOnFocus && player && player.playVideo) {
        player.playVideo();
        shouldResumeOnFocus = false;
      }
    });

    function playNext() {
      if (usingYouTubePlaylist) {
        const playlist = player.getPlaylist();
        const playlistIndex = player.getPlaylistIndex();
        if (Array.isArray(playlist) && playlistIndex < playlist.length - 1) {
          player.nextVideo();
          return;
        }
        return; // stop after reaching last playlist video
      }

      currentIndex++;
      if (currentIndex < videoLinks.length) {
        loadVideo(currentIndex);
      } else {
        currentIndex = videoLinks.length - 1; // stop at end
      }
    }

    function loadVideo(index) {
      usingYouTubePlaylist = false;
      activePlaylistTitle = '';
      if (!videoLinks[index]) return;
      currentIndex = index;
      const video = videoLinks[index];
      player.loadVideoById(video.id);
      updateDisplayTitle(video.title);
      updatePlaylistUI();
      // Sync track selection to all connected browsers
      sendCommand('play-video', { videoId: video.id, index });
    }

    function loadYouTubePlaylist(playlistId, index = 0) {
      activePlaylistTitle = 'Playlist: ' + playlistId;
      player.loadPlaylist({
        listType: 'playlist',
        list: playlistId,
        index: index
      });
      updateDisplayTitle(activePlaylistTitle);
      syncPlaylistFromPlayer();
    }

    function updateDisplayTitle(title) {
      const displayTitle = title || 'Select a track to begin';
      document.getElementById('current-title').innerText = displayTitle;
      document.getElementById('sidebar-title').innerText = displayTitle;
      // Update remote panel now-playing title
      const remoteTitle = document.getElementById('remote-now-playing-title');
      if (remoteTitle) remoteTitle.textContent = displayTitle;
      // Update OS media session metadata
      updateMediaSession(displayTitle, 'SAS Player');
      // Broadcast to Firebase
      const isPlaying = disk.classList.contains('playing');
      if (typeof broadcastNowPlaying === 'function') broadcastNowPlaying(displayTitle, isPlaying);
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

    function loadCustomQueue(ids, startIndex = 0) {
      if (!player || !player.loadPlaylist) {
        return;
      }

      if (!Array.isArray(ids) || ids.length === 0) {
        clearAllTracks();
        return;
      }

      usingYouTubePlaylist = false;
      activePlaylistId = '';
      activePlaylistTitle = '';
      videoLinks = ids.map((id, idx) => ({
        id,
        title: ''
      }));
      currentIndex = Math.max(0, Math.min(startIndex, videoLinks.length - 1));
      initPlaylist();
      player.loadPlaylist(ids, currentIndex, 0);
      updateDisplayTitle('Track ' + (currentIndex + 1));
      updatePlaylistUI();
      hydrateVideoTitles();
      broadcastPlaylist();
    }

    // Applies a remote queue change without triggering a re-broadcast (loop prevention)
    // Applies a remote playlist change to the local data model + sidebar ONLY.
    // NEVER touches the YouTube player — active playback is never interrupted.
    function loadCustomQueueSilent(ids, startIndex = 0) {
      if (!Array.isArray(ids)) return;

      if (ids.length === 0) {
        videoLinks = [];
        currentIndex = 0;
        usingYouTubePlaylist = false;
        activePlaylistId = '';
        activePlaylistTitle = '';
        updateDisplayTitle('Queue cleared');
        initPlaylist();
        return;
      }

      // Preserve any titles we already fetched so the sidebar doesn't blank out
      const knownTitles = {};
      videoLinks.forEach((v) => { if (v.id && v.title) knownTitles[v.id] = v.title; });

      usingYouTubePlaylist = false;
      activePlaylistId = '';
      activePlaylistTitle = '';
      videoLinks = ids.map((id) => ({ id, title: knownTitles[id] || '' }));

      // Keep currentIndex valid; do NOT jump to startIndex — don't interrupt playback
      currentIndex = Math.max(0, Math.min(currentIndex, videoLinks.length - 1));

      initPlaylist();
      updatePlaylistUI();
      hydrateVideoTitles();
      // Intentionally NOT calling player.loadPlaylist() — remote queue updates
      // must NEVER interrupt what is actively playing on this browser.
    }

    // Disk Button Interaction
    playPauseBtn.addEventListener('click', () => {
      const state = player.getPlayerState();
      if (state == YT.PlayerState.PLAYING) {
        player.pauseVideo();
        sendCommand('pause');
      } else {
        player.playVideo();
        sendCommand('play');
      }
    });

    // Populate Sidebar
    const playlistContainer = document.getElementById('track-list');
    function initPlaylist() {
      playlistContainer.innerHTML = '';

      if (videoLinks.length === 0) {
        const helper = document.createElement('div');
        helper.className = 'track-item';
        helper.innerHTML = `<div class="track-item-main"><i class="fas fa-music"></i> <span class="track-name">Queue is empty</span></div>`;
        playlistContainer.appendChild(helper);
        return;
      }

      videoLinks.forEach((link, index) => {
        playlistContainer.appendChild(createTrackItem(link, index, index === currentIndex));
      });
    }

    function updatePlaylistUI() {
      if (usingYouTubePlaylist) {
        syncPlaylistFromPlayer();
        return;
      }

      const items = playlistContainer.querySelectorAll('.track-item[data-track-index]');
      items.forEach((item) => {
        const idx = Number(item.dataset.trackIndex);
        item.classList.toggle('active', idx === currentIndex);
      });
    }

    function syncPlaylistFromPlayer() {
      if (!usingYouTubePlaylist) return;
      const playlist = player.getPlaylist && player.getPlaylist();
      if (!Array.isArray(playlist) || playlist.length === 0) return;

      if (videoLinks.length !== playlist.length) {
        videoLinks = playlist.map((id, idx) => ({
          id,
          title: ''
        }));
      }

      currentIndex = player.getPlaylistIndex ? player.getPlaylistIndex() : 0;

      refreshDisplayTitleFromPlayer();

      playlistContainer.innerHTML = '';
      videoLinks.forEach((link, index) => {
        playlistContainer.appendChild(createTrackItem(link, index, index === currentIndex));
      });
      hydrateVideoTitles();
    }

    function escapeHtml(text) {
      return String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function getDisplayTrackTitle(link, index) {
      const baseTitle = (link && link.title) ? link.title : 'Loading title...';
      return `${index + 1}. ${baseTitle}`;
    }

    async function fetchVideoTitle(videoId) {
      if (!videoId) return '';
      if (titleCache[videoId]) return titleCache[videoId];

      try {
        const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
        if (!response.ok) return '';
        const data = await response.json();
        const title = data && data.title ? data.title.trim() : '';
        if (title) {
          titleCache[videoId] = title;
        }
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
      refreshDisplayTitleFromPlayer();
      updatePlaylistUI();
    }

    function createTrackItem(link, index, isActive) {
      const div = document.createElement('div');
      div.className = `track-item ${isActive ? 'active' : ''}`;
      div.dataset.trackIndex = index;
      div.draggable = !usingYouTubePlaylist;
      if (!usingYouTubePlaylist) {
        div.classList.add('draggable');
        div.title = 'Drag to reorder';
      }

      const main = document.createElement('div');
      main.className = 'track-item-main';
      main.innerHTML = `
        <div class="playing-animation">
          <span></span><span></span><span></span>
        </div>
        <i class="fas fa-play-circle"></i> 
        <span class="track-name">${escapeHtml(getDisplayTrackTitle(link, index))}</span>
      `;
      main.onclick = () => {
        if (usingYouTubePlaylist) {
          player.playVideoAt(index);
        } else {
          loadVideo(index);
        }
      };

      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-track';
      removeBtn.title = 'Remove this track';
      removeBtn.innerHTML = `<i class="fas fa-times"></i>`;
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        removeTrack(index);
      };

      div.appendChild(main);
      div.appendChild(removeBtn);
      return div;
    }

    function reorderTracks(fromIndex, toIndex) {
      if (fromIndex === toIndex) return;
      if (fromIndex < 0 || toIndex < 0) return;
      if (!videoLinks[fromIndex] || !videoLinks[toIndex]) return;

      const moved = videoLinks[fromIndex];
      videoLinks.splice(fromIndex, 1);
      videoLinks.splice(toIndex, 0, moved);

      if (currentIndex === fromIndex) {
        currentIndex = toIndex;
      } else if (fromIndex < currentIndex && toIndex >= currentIndex) {
        currentIndex -= 1;
      } else if (fromIndex > currentIndex && toIndex <= currentIndex) {
        currentIndex += 1;
      }

      initPlaylist();
      updatePlaylistUI();
      broadcastPlaylist();
    }

    playlistContainer.addEventListener('dragstart', (event) => {
      if (usingYouTubePlaylist) return;
      const row = event.target.closest('.track-item[data-track-index]');
      if (!row) return;

      dragFromIndex = Number(row.dataset.trackIndex);
      row.classList.add('dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }
    });

    playlistContainer.addEventListener('dragover', (event) => {
      if (usingYouTubePlaylist || dragFromIndex < 0) return;
      const row = event.target.closest('.track-item[data-track-index]');
      if (!row) return;
      event.preventDefault();
      row.classList.add('drag-over');
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
    });

    playlistContainer.addEventListener('dragleave', (event) => {
      const row = event.target.closest('.track-item[data-track-index]');
      if (row) {
        row.classList.remove('drag-over');
      }
    });

    playlistContainer.addEventListener('drop', (event) => {
      if (usingYouTubePlaylist || dragFromIndex < 0) return;
      const row = event.target.closest('.track-item[data-track-index]');
      if (!row) return;
      event.preventDefault();
      const dropIndex = Number(row.dataset.trackIndex);
      row.classList.remove('drag-over');
      reorderTracks(dragFromIndex, dropIndex);
      dragFromIndex = -1;
    });

    playlistContainer.addEventListener('dragend', () => {
      dragFromIndex = -1;
      playlistContainer.querySelectorAll('.track-item').forEach((item) => {
        item.classList.remove('dragging', 'drag-over');
      });
    });

    function clearAllTracks() {
      videoLinks = [];
      currentIndex = 0;
      usingYouTubePlaylist = false;
      activePlaylistId = '';
      activePlaylistTitle = '';
      if (player && player.stopVideo) {
        player.stopVideo();
      }
      updateDisplayTitle('Queue cleared');
      initPlaylist();
      broadcastPlaylist();
    }

    function clearPlayedTracks() {
      if (usingYouTubePlaylist && player && player.getPlaylistIndex) {
        currentIndex = player.getPlaylistIndex();
      }
      if (videoLinks.length === 0 || currentIndex <= 0) return;

      const remaining = videoLinks.slice(currentIndex).map((v) => v.id);
      if (remaining.length === 0) {
        clearAllTracks();
        return;
      }

      loadCustomQueue(remaining, 0);
    }

    function removeTrack(index) {
      if (usingYouTubePlaylist && player && player.getPlaylistIndex) {
        currentIndex = player.getPlaylistIndex();
      }
      if (!videoLinks[index]) return;

      const isCurrent = index === currentIndex;
      const remaining = videoLinks
        .filter((_, idx) => idx !== index)
        .map((v) => v.id);

      if (remaining.length === 0) {
        clearAllTracks();
        return;
      }

      let nextIndex = currentIndex;
      if (index < currentIndex) {
        nextIndex = currentIndex - 1;
      } else if (isCurrent) {
        nextIndex = Math.min(currentIndex, remaining.length - 1);
      }

      loadCustomQueue(remaining, nextIndex);
    }

    const linkInput = document.getElementById('link-input');
    if (linkInput) {
      linkInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addLink();
      });
    }

    initPlaylist();

    // =============================================
    //  FIREBASE REAL-TIME REMOTE CONTROL SYSTEM
    //  Super Admin & Admin Passphrases
    // =============================================
    const SUPER_ADMIN_SECRET = 'sas2026super';
    const ADMIN_SECRET = 'sas2026admin';
    const DB_ROOT = 'sas-player';

    let db = null;
    let deviceId = null;
    let deviceStatus = 'unknown';
    let currentUserRole = 'guest'; // 'guest', 'approved', 'admin', 'super_admin'
    let isAdmin = false;
    let isSuperAdmin = false;
    let lastAppliedTimestamp = 0;
    let isCommandFromRemote = false;

    function getOrCreateDeviceId() {
      let id = localStorage.getItem('sas_device_id');
      if (!id) {
        id = 'dev_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now().toString(36);
        localStorage.setItem('sas_device_id', id);
      }
      return id;
    }

    function initFirebase() {
      try {
        if (!firebase.apps || !firebase.apps.length) {
          firebase.initializeApp({
            apiKey: 'AIzaSyDyom7hGf13SK5XDn5mV_hEfGNr0_gjC1I',
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

        const savedRole = localStorage.getItem('sas_user_role');
        if (savedRole === 'super_admin') {
          isSuperAdmin = true;
          isAdmin = true;
          currentUserRole = 'super_admin';
        } else if (savedRole === 'admin') {
          isAdmin = true;
          currentUserRole = 'admin';
        }

        listenToDeviceStatus();
        listenToCommands();
        listenToNowPlaying();
        listenToPlaylist();
        showConnectionBadge('connected');
        if (isAdmin || isSuperAdmin) activateRoleMode(currentUserRole);
        // Read current state once so this browser catches up immediately
        setTimeout(syncInitialState, 800);
      } catch (err) {
        console.error('Firebase error:', err);
        showConnectionBadge('error');
      }
    }

    function listenToDeviceStatus() {
      if (!db || !deviceId) return;
      db.ref(DB_ROOT + '/devices/' + deviceId).on('value', (snap) => {
        const data = snap.val();
        deviceStatus = data ? data.status : 'unknown';
        updateAccessUI(deviceStatus);
      });
    }

    function listenToCommands() {
      if (!db) return;
      db.ref(DB_ROOT + '/state').on('value', (snap) => {
        const cmd = snap.val();
        if (!cmd || !cmd.command || !cmd.timestamp) return;
        if (cmd.timestamp <= lastAppliedTimestamp) return;
        if (cmd.issuedBy === deviceId) return;
        lastAppliedTimestamp = cmd.timestamp;
        isCommandFromRemote = true;
        applyRemoteCommand(cmd);
        setTimeout(() => { isCommandFromRemote = false; }, 200);
      });
    }

    function listenToNowPlaying() {
      if (!db) return;
      db.ref(DB_ROOT + '/nowPlaying').on('value', (snap) => {
        const data = snap.val();
        if (!data || data.updatedBy === deviceId) return;

        const title = data.title || '—';

        // Update remote control panel
        const titleEl = document.getElementById('remote-now-playing-title');
        if (titleEl) titleEl.textContent = title;
        const dotEl = document.getElementById('remote-np-dot');
        if (dotEl) dotEl.classList.toggle('playing', !!data.isPlaying);
        updateRemotePlayPauseIcon(!!data.isPlaying);

        // Also sync the main title + sidebar — PiP titleObserver watches these
        const mainTitle = document.getElementById('current-title');
        if (mainTitle && data.title) mainTitle.innerText = data.title;
        const sidebarTitle = document.getElementById('sidebar-title');
        if (sidebarTitle && data.title) sidebarTitle.innerText = data.title;
      });
    }

    function applyRemoteCommand(cmd) {
      if (!player || !player.playVideo) return;
      switch (cmd.command) {
        case 'play': player.playVideo(); break;
        case 'pause': player.pauseVideo(); break;
        case 'next': playNext(); break;
        case 'prev': playPrev(); break;
        case 'play-video':
          if (cmd.data && cmd.data.videoId) {
            const remoteVideoId = cmd.data.videoId;
            const remoteIndex   = typeof cmd.data.index === 'number' ? cmd.data.index : -1;
            // Try to find video in our local playlist by index first, then by ID
            const localIdx =
              remoteIndex >= 0 && videoLinks[remoteIndex] && videoLinks[remoteIndex].id === remoteVideoId
                ? remoteIndex
                : videoLinks.findIndex((v) => v.id === remoteVideoId);
            if (localIdx >= 0) {
              currentIndex = localIdx;
              player.loadVideoById(remoteVideoId);
              updateDisplayTitle(videoLinks[localIdx].title || '');
              updatePlaylistUI();
            } else {
              // Video not in our list — just play it
              player.loadVideoById(remoteVideoId);
            }
          }
          break;
        case 'volume':
          if (cmd.data && typeof cmd.data.level === 'number') {
            player.setVolume(cmd.data.level);
            const sl = document.getElementById('remote-volume-slider');
            if (sl) { sl.value = cmd.data.level; updateVolumeSliderStyle(sl); }
          }
          break;
        case 'add-video':
          if (cmd.data && cmd.data.url) {
            const li = document.getElementById('link-input');
            if (li) { li.value = cmd.data.url; addLink(); }
          }
          break;
        case 'load-queue':
          if (cmd.data && Array.isArray(cmd.data.ids)) {
            loadCustomQueueSilent(cmd.data.ids, cmd.data.startIndex || 0);
          }
          break;
      }
    }

    function sendCommand(command, data) {
      if (!db || !deviceId) return;
      if (isCommandFromRemote) return;
      // Playlist-mutating commands still require approval or admin.
      // Basic playback commands (play/pause/next/prev/play-video/volume) are open
      // to any connected browser so that all browsers can participate in sync.
      const requiresApproval = ['add-video', 'load-queue'];
      if (requiresApproval.includes(command) && deviceStatus !== 'approved' && !isAdmin) return;
      db.ref(DB_ROOT + '/state').set({
        command,
        data: data || null,
        timestamp: Date.now(),
        issuedBy: deviceId
      });
    }

    function broadcastNowPlaying(title, isPlaying) {
      if (!db || !deviceId) return;
      if (deviceStatus !== 'approved' && !isAdmin) return;
      if (isCommandFromRemote) return;
      const currentVideoId = videoLinks[currentIndex] ? videoLinks[currentIndex].id : '';
      db.ref(DB_ROOT + '/nowPlaying').set({
        title: title || '',
        isPlaying: !!isPlaying,
        trackIndex: currentIndex,
        videoId: currentVideoId,
        updatedAt: Date.now(),
        updatedBy: deviceId
      });
    }

    // Broadcast the full current playlist to Firebase so all browsers stay in sync
    function broadcastPlaylist() {
      if (!db || !deviceId) return;
      if (isCommandFromRemote) return;
      if (deviceStatus !== 'approved' && !isAdmin) return;
      const ids = videoLinks.map((v) => v.id);
      db.ref(DB_ROOT + '/playlist').set({
        ids,
        currentIndex,
        updatedAt: Date.now(),
        updatedBy: deviceId
      });
    }

    // Listen to /playlist node — syncs track LIST mutations (add/remove/reorder) only.
    // NEVER changes the currently playing video — that is controlled exclusively via /state commands.
    function listenToPlaylist() {
      if (!db) return;
      db.ref(DB_ROOT + '/playlist').on('value', (snap) => {
        const data = snap.val();
        if (!data) return;
        // Ignore our own broadcasts
        if (data.updatedBy === deviceId) return;
        if (!Array.isArray(data.ids)) return;

        const remoteIds = data.ids;
        const localIds  = videoLinks.map((v) => v.id);

        // Only react to list content changes, NOT to currentIndex changes.
        // Which track is PLAYING is the business of /state commands (play/pause/next/prev).
        if (JSON.stringify(remoteIds) === JSON.stringify(localIds)) return;

        isCommandFromRemote = true;
        loadCustomQueueSilent(remoteIds, currentIndex);
        setTimeout(() => { isCommandFromRemote = false; }, 200);
      });
    }

    // Read Firebase state once on connect — catches this browser up to whatever is currently playing.
    // This is a one-shot read, not a persistent listener, so it doesn't cause loops.
    function syncInitialState() {
      if (!db || !player) return;

      // Sync playlist first
      db.ref(DB_ROOT + '/playlist').once('value', (snap) => {
        const data = snap.val();
        if (!data || data.updatedBy === deviceId) return;
        if (!Array.isArray(data.ids) || data.ids.length === 0) return;
        const localIds = videoLinks.map((v) => v.id);
        if (JSON.stringify(data.ids) !== JSON.stringify(localIds)) {
          isCommandFromRemote = true;
          loadCustomQueueSilent(data.ids, currentIndex);
          setTimeout(() => { isCommandFromRemote = false; }, 200);
        }
      });

      // Sync currently playing track
      db.ref(DB_ROOT + '/nowPlaying').once('value', (snap) => {
        const data = snap.val();
        if (!data || data.updatedBy === deviceId) return;
        if (!data.videoId) return;
        // Only sync if we're not already playing the same video
        const currentVideoId = videoLinks[currentIndex] ? videoLinks[currentIndex].id : null;
        if (data.videoId === currentVideoId) return;

        isCommandFromRemote = true;
        player.loadVideoById(data.videoId);
        // Find the track in our local list and update index
        const idx = videoLinks.findIndex((v) => v.id === data.videoId);
        if (idx >= 0) {
          currentIndex = idx;
          updateDisplayTitle(videoLinks[idx].title || data.title || '');
          updatePlaylistUI();
        } else if (data.title) {
          updateDisplayTitle(data.title);
        }
        // Don't auto-play unless remote says it was playing
        if (!data.isPlaying) {
          setTimeout(() => { if (player && player.pauseVideo) player.pauseVideo(); }, 1000);
        }
        setTimeout(() => { isCommandFromRemote = false; }, 300);
      });
    }

    function updateRemotePlayPauseIcon(isPlaying) {
      const btn = document.getElementById('remote-play-pause');
      if (!btn) return;
      btn.querySelector('i').className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
    }

    function updateVolumeSliderStyle(slider) {
      if (!slider) return;
      const pct = slider.value + '%';
      slider.style.background = 'linear-gradient(to right, var(--yt-red) ' + pct + ', rgba(255,255,255,0.15) ' + pct + ')';
    }

    function updateAccessUI(status) {
      const requestBtn = document.getElementById('request-access-btn');
      const remotePanel = document.getElementById('remote-control-panel');
      if (isAdmin) {
        if (remotePanel) remotePanel.classList.remove('hidden');
        if (requestBtn) requestBtn.classList.add('hidden');
        return;
      }
      switch (status) {
        case 'unknown':
          if (requestBtn) {
            requestBtn.className = 'remote-access-btn';
            requestBtn.innerHTML = '<i class="fas fa-wifi"></i><span>Remote</span>';
            requestBtn.onclick = openAccessModal;
            requestBtn.disabled = false;
          }
          if (remotePanel) remotePanel.classList.add('hidden');
          break;
        case 'pending':
          if (requestBtn) {
            requestBtn.className = 'remote-access-btn pending';
            requestBtn.innerHTML = '<i class="fas fa-hourglass-half"></i><span>Pending...</span>';
            requestBtn.disabled = true;
          }
          if (remotePanel) remotePanel.classList.add('hidden');
          break;
        case 'approved':
          if (requestBtn) requestBtn.classList.add('hidden');
          if (remotePanel) {
            remotePanel.classList.remove('hidden');
            if (player && player.getVolume) {
              try {
                const vol = player.getVolume();
                const sl = document.getElementById('remote-volume-slider');
                if (sl) { sl.value = vol; updateVolumeSliderStyle(sl); }
              } catch(e) {}
            }
          }
          break;
        case 'revoked':
          if (requestBtn) {
            requestBtn.className = 'remote-access-btn revoked';
            requestBtn.innerHTML = '<i class="fas fa-ban"></i><span>Revoked</span>';
            requestBtn.disabled = true;
          }
          if (remotePanel) remotePanel.classList.add('hidden');
          break;
      }
    }

    function activateRoleMode(role) {
      currentUserRole = role;
      isAdmin = (role === 'admin' || role === 'super_admin');
      isSuperAdmin = (role === 'super_admin');
      localStorage.setItem('sas_user_role', role);

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

      // Broadcast current state immediately so any already-connected browsers sync up
      setTimeout(() => {
        broadcastPlaylist();
        const titleEl = document.getElementById('current-title');
        broadcastNowPlaying(titleEl ? titleEl.innerText : '', disk.classList.contains('playing'));
      }, 300);
    }

    function listenToAllDevices() {
      if (!db) return;
      db.ref(DB_ROOT + '/devices').on('value', (snap) => {
        const devices = snap.val() || {};
        renderAdminDeviceList(devices);
        const pendingCount = Object.values(devices).filter(d => d.status === 'pending').length;
        const dot = document.querySelector('#admin-panel-btn .notif-dot');
        if (dot) dot.classList.toggle('visible', pendingCount > 0);
        const badge = document.getElementById('pending-badge');
        if (badge) { badge.textContent = pendingCount; badge.classList.toggle('hidden', pendingCount === 0); }
      });
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function renderAdminDeviceList(devices) {
      const listEl = document.getElementById('admin-device-list');
      if (!listEl) return;
      const entries = Object.entries(devices);
      if (entries.length === 0) {
        listEl.innerHTML = '<div class="admin-no-devices">No devices yet. Share the site URL to get started.</div>';
        return;
      }

      // Priority sort: Pending first, then Super Admin, Admin, Guest
      const statusOrder = { pending: 0, approved: 1, revoked: 2 };
      const roleOrder = { super_admin: 0, admin: 1, guest: 2 };
      entries.sort((a, b) => {
        const roleA = a[1].role || 'guest';
        const roleB = b[1].role || 'guest';
        if (roleA !== roleB) return (roleOrder[roleA] ?? 2) - (roleOrder[roleB] ?? 2);
        return (statusOrder[a[1].status] ?? 3) - (statusOrder[b[1].status] ?? 3);
      });

      listEl.innerHTML = entries.map(([id, device]) => {
        const isSelf = id === deviceId;
        const targetRole = device.role || 'guest';
        const isTargetSuperAdmin = targetRole === 'super_admin';
        const isTargetAdmin = targetRole === 'admin';

        // Badges
        let roleBadge = '';
        if (isTargetSuperAdmin) {
          roleBadge = '<span class="role-badge super-admin"><i class="fas fa-crown"></i> SUPER ADMIN</span>';
        } else if (isTargetAdmin) {
          roleBadge = '<span class="role-badge admin"><i class="fas fa-user-shield"></i> ADMIN</span>';
        }

        // Actions:
        // Super Admin can manage anyone except themselves.
        // Admin can manage regular users (not super_admin or other admins).
        let actionsHtml = '';
        if (!isSelf && !isTargetSuperAdmin) {
          if (isSuperAdmin) {
            actionsHtml += '<div class="device-actions">';
            if (isTargetAdmin) {
              actionsHtml += '<button class="demote-btn" onclick="setDeviceRole(\'' + escapeHtml(id) + '\', \'guest\')" title="Demote to User"><i class="fas fa-user"></i> Demote</button>';
            } else {
              actionsHtml += '<button class="promote-btn" onclick="setDeviceRole(\'' + escapeHtml(id) + '\', \'admin\')" title="Promote to Admin"><i class="fas fa-user-shield"></i> Make Admin</button>';
            }
            if (device.status === 'approved') {
              actionsHtml += '<button class="revoke-btn" onclick="revokeDevice(\'' + escapeHtml(id) + '\')"><i class="fas fa-ban"></i> Revoke</button>';
            } else {
              actionsHtml += '<button class="approve-btn" onclick="approveDevice(\'' + escapeHtml(id) + '\')"><i class="fas fa-check"></i> Approve</button>';
            }
            actionsHtml += '</div>';
          } else if (isAdmin && !isTargetAdmin) {
            actionsHtml += '<div class="device-actions">';
            if (device.status === 'approved') {
              actionsHtml += '<button class="revoke-btn" onclick="revokeDevice(\'' + escapeHtml(id) + '\')"><i class="fas fa-ban"></i> Revoke</button>';
            } else {
              actionsHtml += '<button class="approve-btn" onclick="approveDevice(\'' + escapeHtml(id) + '\')"><i class="fas fa-check"></i> Approve</button>';
            }
            actionsHtml += '</div>';
          }
        }

        return '<div class="device-card ' + escapeHtml(device.status || '') + '">'
          + '<div class="device-info">'
          + '<div class="device-name">' + escapeHtml(device.name || 'Unknown Device')
          + (isSelf ? '<span style="font-size:10px;color:var(--text-muted);margin-left:6px;">(You)</span>' : '')
          + roleBadge
          + '</div>'
          + '<div class="device-meta">'
          + '<span class="device-status-badge ' + escapeHtml(device.status || '') + '">' + escapeHtml(device.status || '') + '</span>'
          + '<span class="device-id-text">' + escapeHtml(id.substring(0, 18)) + '...</span>'
          + '</div></div>'
          + actionsHtml
          + '</div>';
      }).join('');
    }

    function setDeviceRole(id, role) {
      if (!isSuperAdmin || !db) return;
      db.ref(DB_ROOT + '/devices/' + id).update({
        role: role,
        status: 'approved'
      });
    }

    function approveDevice(id) {
      if ((!isAdmin && !isSuperAdmin) || !db) return;
      db.ref(DB_ROOT + '/devices/' + id + '/status').set('approved');
    }

    function revokeDevice(id) {
      if ((!isAdmin && !isSuperAdmin) || !db) return;
      db.ref(DB_ROOT + '/devices/' + id + '/status').set('revoked');
    }

    function openAccessModal() {
      const overlay = document.getElementById('access-request-overlay');
      if (overlay) overlay.classList.remove('hidden');
      const nameInput = document.getElementById('device-name-input');
      if (nameInput) {
        nameInput.value = localStorage.getItem('sas_device_name') || '';
        setTimeout(() => nameInput.focus(), 80);
      }
    }

    function closeAccessModal() {
      const el = document.getElementById('access-request-overlay');
      if (el) el.classList.add('hidden');
    }

    function closeAccessModalOnBackdrop(e) {
      if (e.target === e.currentTarget) closeAccessModal();
    }

    function openAdminPanel() {
      if (!isAdmin && !isSuperAdmin) {
        const secret = prompt('Enter Super Admin or Admin Passphrase:');
        if (!secret) return;
        if (secret === SUPER_ADMIN_SECRET) {
          activateRoleMode('super_admin');
        } else if (secret === ADMIN_SECRET) {
          activateRoleMode('admin');
        } else {
          alert('Incorrect passphrase.');
          return;
        }
      }
      const overlay = document.getElementById('admin-panel-overlay');
      if (overlay) overlay.classList.remove('hidden');
    }

    function closeAdminPanel() {
      const el = document.getElementById('admin-panel-overlay');
      if (el) el.classList.add('hidden');
    }

    function closeAdminPanelOnBackdrop(e) {
      if (e.target === e.currentTarget) closeAdminPanel();
    }

    function requestAccess() {
      const nameInput = document.getElementById('device-name-input');
      const name = (nameInput ? nameInput.value : '').trim();
      if (!name) { if (nameInput) nameInput.focus(); return; }
      if (!db || !deviceId) return;
      localStorage.setItem('sas_device_name', name);
      db.ref(DB_ROOT + '/devices/' + deviceId).set({
        name, status: 'pending', requestedAt: Date.now(), lastActive: Date.now()
      }).then(() => closeAccessModal());
    }

    function showConnectionBadge(type) {
      const badge = document.getElementById('connection-badge');
      const text = document.getElementById('connection-status-text');
      if (!badge || !text) return;
      badge.classList.remove('hidden', 'error', 'connected');
      badge.classList.add(type);
      text.textContent = type === 'connected' ? 'Synced' : 'Offline';
      if (type === 'connected') setTimeout(() => badge.classList.add('hidden'), 2500);
    }

    function playPrev() {
      if (usingYouTubePlaylist) {
        const idx = player.getPlaylistIndex ? player.getPlaylistIndex() : 0;
        if (idx > 0) player.previousVideo();
        return;
      }
      if (currentIndex > 0) loadVideo(currentIndex - 1);
    }

    function bindRemoteEvents() {
      const rPP = document.getElementById('remote-play-pause');
      const rNext = document.getElementById('remote-next');
      const rPrev = document.getElementById('remote-prev');
      const rVol = document.getElementById('remote-volume-slider');
      const rAdd = document.getElementById('remote-add-btn');
      const rInput = document.getElementById('remote-link-input');

      if (rPP) {
        rPP.addEventListener('click', () => {
          if (!player) return;
          try {
            const state = player.getPlayerState();
            if (state === YT.PlayerState.PLAYING) {
              player.pauseVideo(); sendCommand('pause');
            } else {
              player.playVideo(); sendCommand('play');
            }
          } catch(e) {}
        });
      }
      if (rNext) rNext.addEventListener('click', () => { playNext(); sendCommand('next'); });
      if (rPrev) rPrev.addEventListener('click', () => { playPrev(); sendCommand('prev'); });
      if (rVol) {
        rVol.addEventListener('input', (e) => {
          const vol = parseInt(e.target.value, 10);
          if (player && player.setVolume) player.setVolume(vol);
          updateVolumeSliderStyle(e.target);
          sendCommand('volume', { level: vol });
        });
        updateVolumeSliderStyle(rVol);
      }
      if (rAdd) {
        rAdd.addEventListener('click', () => {
          if (!rInput) return;
          const url = rInput.value.trim();
          if (!url) return;
          sendCommand('add-video', { url });
          const li = document.getElementById('link-input');
          if (li) { li.value = url; addLink(); }
          rInput.value = '';
        });
      }
      if (rInput) rInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && rAdd) rAdd.click(); });
    }

    // Boot Firebase and remote events after page fully loads
    window.addEventListener('load', () => {
      bindRemoteEvents();
      if (typeof firebase !== 'undefined') {
        initFirebase();
      }
      registerServiceWorker();
      initPWAInstallPrompt();
      initMediaSession();
      initPiPButton();
    });

    // =========================================================================
    //  LAYER 1 — MEDIA SESSION API
    //  Hooks into OS-level media controls:
    //    • Windows: taskbar media flyout + keyboard media keys
    //    • macOS:   Control Center, Touch Bar, headphone button
    //    • Ubuntu:  GNOME top-bar media widget, lock screen
    // =========================================================================
    function initMediaSession() {
      if (!('mediaSession' in navigator)) return;

      navigator.mediaSession.setActionHandler('play', () => {
        if (player && player.playVideo) {
          player.playVideo();
          sendCommand('play');
        }
      });

      navigator.mediaSession.setActionHandler('pause', () => {
        if (player && player.pauseVideo) {
          player.pauseVideo();
          sendCommand('pause');
        }
      });

      navigator.mediaSession.setActionHandler('nexttrack', () => {
        playNext();
        sendCommand('next');
      });

      navigator.mediaSession.setActionHandler('previoustrack', () => {
        playPrev();
        sendCommand('prev');
      });

      navigator.mediaSession.setActionHandler('seekbackward', null);
      navigator.mediaSession.setActionHandler('seekforward', null);
    }

    // Call this every time the track changes to update the OS media widget
    function updateMediaSession(title, artist) {
      if (!('mediaSession' in navigator)) return;

      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || 'SAS Premium Player',
        artist: artist || 'SAS Player',
        album: 'YouTube Queue',
        artwork: [
          { src: './sas-icon.jpg', sizes: '192x192', type: 'image/jpeg' },
          { src: './sas-icon.jpg', sizes: '512x512', type: 'image/jpeg' }
        ]
      });

      navigator.mediaSession.playbackState = 'playing';
    }

    function clearMediaSession() {
      if (!('mediaSession' in navigator)) return;
      navigator.mediaSession.playbackState = 'paused';
    }

    // =========================================================================
    //  LAYER 2 — PWA: Service Worker + Install Prompt
    // =========================================================================
    function registerServiceWorker() {
      if (!('serviceWorker' in navigator)) return;
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('SW registration failed:', err);
      });
    }

    let _deferredInstallPrompt = null;

    function initPWAInstallPrompt() {
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        _deferredInstallPrompt = e;
        const btn = document.getElementById('install-app-btn');
        if (btn) {
          btn.classList.remove('hidden');
          btn.addEventListener('click', installPWA);
        }
      });

      // Hide install button if already installed
      window.addEventListener('appinstalled', () => {
        _deferredInstallPrompt = null;
        const btn = document.getElementById('install-app-btn');
        if (btn) btn.classList.add('hidden');
      });
    }

    function installPWA() {
      if (!_deferredInstallPrompt) return;
      _deferredInstallPrompt.prompt();
      _deferredInstallPrompt.userChoice.then(() => {
        _deferredInstallPrompt = null;
      });
    }

    // =========================================================================
    //  LAYER 3 — DOCUMENT PICTURE-IN-PICTURE MINI PLAYER
    //  An always-on-top floating mini player window (Chrome/Edge 116+)
    // =========================================================================
    let _pipWindow = null;

    function initPiPButton() {
      if (!('documentPictureInPicture' in window)) return;
      const btn = document.getElementById('pip-btn');
      if (btn) btn.classList.remove('hidden');
    }

    async function openMiniPlayer() {
      if (!('documentPictureInPicture' in window)) {
        alert('Picture-in-Picture mini player requires Chrome 116+ or Edge 116+.');
        return;
      }

      // Close existing PiP window if open
      if (_pipWindow && !_pipWindow.closed) {
        _pipWindow.close();
        _pipWindow = null;
        return;
      }

      try {
        _pipWindow = await window.documentPictureInPicture.requestWindow({
          width: 300,
          height: 180
        });

        // Clone Font Awesome stylesheet into the PiP window
        [...document.styleSheets].forEach((sheet) => {
          try {
            if (sheet.href && sheet.href.includes('font-awesome')) {
              const link = _pipWindow.document.createElement('link');
              link.rel = 'stylesheet';
              link.href = sheet.href;
              _pipWindow.document.head.appendChild(link);
            }
          } catch (_) {}
        });

        // Inject mini player styles
        const style = _pipWindow.document.createElement('style');
        style.textContent = `
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background: #0a0a0f;
            color: #fff;
            font-family: 'Segoe UI', system-ui, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            gap: 14px;
            padding: 16px;
            overflow: hidden;
          }
          .pip-title {
            font-size: 11px;
            color: rgba(255,255,255,0.55);
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            width: 100%;
            max-width: 260px;
            letter-spacing: 0.3px;
          }
          .pip-track {
            font-size: 13px;
            font-weight: 600;
            color: #fff;
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            width: 100%;
            max-width: 260px;
          }
          .pip-controls {
            display: flex;
            align-items: center;
            gap: 18px;
          }
          .pip-btn-ctrl {
            background: none;
            border: none;
            color: rgba(255,255,255,0.75);
            font-size: 18px;
            cursor: pointer;
            padding: 6px;
            border-radius: 50%;
            transition: color 0.15s, background 0.15s;
            line-height: 1;
          }
          .pip-btn-ctrl:hover { color: #fff; background: rgba(255,255,255,0.1); }
          .pip-btn-ctrl.play {
            font-size: 22px;
            color: #fff;
            background: #c0392b;
            width: 46px;
            height: 46px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .pip-btn-ctrl.play:hover { background: #e74c3c; }
          .pip-eq {
            display: flex;
            align-items: flex-end;
            gap: 2px;
            height: 14px;
          }
          .pip-eq span {
            display: block;
            width: 3px;
            background: #c0392b;
            border-radius: 2px;
            animation: pip-bar 0.8s ease-in-out infinite alternate;
          }
          .pip-eq span:nth-child(2) { animation-delay: 0.2s; }
          .pip-eq span:nth-child(3) { animation-delay: 0.4s; }
          @keyframes pip-bar {
            from { height: 4px; }
            to   { height: 14px; }
          }
          .pip-eq.paused span { animation-play-state: paused; height: 4px; }
        `;
        _pipWindow.document.head.appendChild(style);

        // Get current track title
        const currentTitle = document.getElementById('current-title').innerText || 'SAS Player';
        const isCurrentlyPlaying = disk.classList.contains('playing');

        // Build mini player HTML
        _pipWindow.document.body.innerHTML = `
          <div class="pip-title">▶ SAS PREMIUM PLAYER</div>
          <div class="pip-track" id="pip-track-name">${currentTitle}</div>
          <div class="pip-controls">
            <button class="pip-btn-ctrl" id="pip-prev" title="Previous"><i class="fas fa-step-backward"></i></button>
            <button class="pip-btn-ctrl play" id="pip-play" title="Play / Pause">
              <i class="${isCurrentlyPlaying ? 'fas fa-pause' : 'fas fa-play'}"></i>
            </button>
            <button class="pip-btn-ctrl" id="pip-next" title="Next"><i class="fas fa-step-forward"></i></button>
          </div>
          <div class="pip-eq ${isCurrentlyPlaying ? '' : 'paused'}" id="pip-eq">
            <span></span><span></span><span></span>
          </div>
        `;

        // Wire up controls — these call back into the main window's player
        _pipWindow.document.getElementById('pip-play').addEventListener('click', () => {
          if (!player) return;
          const state = player.getPlayerState();
          if (state === YT.PlayerState.PLAYING) {
            player.pauseVideo(); sendCommand('pause');
          } else {
            player.playVideo(); sendCommand('play');
          }
        });

        _pipWindow.document.getElementById('pip-next').addEventListener('click', () => {
          playNext(); sendCommand('next');
        });

        _pipWindow.document.getElementById('pip-prev').addEventListener('click', () => {
          playPrev(); sendCommand('prev');
        });

        // Keep mini player in sync with main player state
        const syncPiP = () => {
          if (!_pipWindow || _pipWindow.closed) return;
          const trackName = _pipWindow.document.getElementById('pip-track-name');
          const playBtn   = _pipWindow.document.getElementById('pip-play');
          const eq        = _pipWindow.document.getElementById('pip-eq');
          if (trackName) trackName.textContent = document.getElementById('current-title').innerText || 'SAS Player';
          const playing = disk.classList.contains('playing');
          if (playBtn) playBtn.querySelector('i').className = playing ? 'fas fa-pause' : 'fas fa-play';
          if (eq) eq.classList.toggle('paused', !playing);
        };

        // Observe changes to current-title and disk class
        const titleObserver = new MutationObserver(syncPiP);
        titleObserver.observe(document.getElementById('current-title'), { childList: true, subtree: true, characterData: true });
        const diskObserver = new MutationObserver(syncPiP);
        diskObserver.observe(disk, { attributes: true, attributeFilter: ['class'] });

        _pipWindow.addEventListener('pagehide', () => {
          titleObserver.disconnect();
          diskObserver.disconnect();
          _pipWindow = null;
          const btn = document.getElementById('pip-btn');
          if (btn) {
            btn.querySelector('i').className = 'fas fa-external-link-alt';
            btn.querySelector('span').textContent = 'Pop Out';
          }
        });

        // Update pip-btn label to show it's open
        const pipBtn = document.getElementById('pip-btn');
        if (pipBtn) {
          pipBtn.querySelector('i').className = 'fas fa-compress-alt';
          pipBtn.querySelector('span').textContent = 'Close PiP';
        }

      } catch (err) {
        console.error('PiP error:', err);
      }
    }
