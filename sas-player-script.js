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
          'rel': 0
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
      const playlistId = urls.length === 1 ? extractPlaylistID(urls[0]) : null;

      // Case 1: single playlist URL
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

      // Case 2: one or many direct video URLs
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

      if (parsedTracks.length > 0) {
        usingYouTubePlaylist = false;
        activePlaylistId = '';
        videoLinks = parsedTracks;
        currentIndex = 0;
        initPlaylist();
        loadVideo(0);
        hydrateVideoTitles();
        input.value = '';
      } else {
        alert("Please enter valid YouTube video URL(s) or one playlist URL.");
      }
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
      if (event.data == YT.PlayerState.PLAYING) {
        document.body.classList.add('is-playing');
        disk.classList.add('playing');
        playPauseIcon.className = 'fas fa-pause';
        refreshDisplayTitleFromPlayer();
        updatePlaylistUI();
      } else {
        document.body.classList.remove('is-playing');
        disk.classList.remove('playing');
        playPauseIcon.className = 'fas fa-play';
      }

      // Autoplay logic: when video ends, play next
      if (event.data == YT.PlayerState.ENDED) {
        playNext();
      }
    }

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
    }

    // Disk Button Interaction
    playPauseBtn.addEventListener('click', () => {
      const state = player.getPlayerState();
      if (state == YT.PlayerState.PLAYING) {
        player.pauseVideo();
      } else {
        player.playVideo();
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

    initPlaylist();
