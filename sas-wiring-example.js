/* ------------------------------------------------------------------ *
 * How your existing sas-player-script.js hooks in.
 * Your render functions, turntable, waveform, modals: all unchanged.
 * Only the data source and the control path move.
 * ------------------------------------------------------------------ */

let player = null;          // YT.Player — built by EVERY device now
let lastAppliedVideo = null;

async function boot() {
  const saved = localStorage.getItem("sas_device_name");
  const name = saved || prompt("Name this device:") || "Guest Device";
  localStorage.setItem("sas_device_name", name);   // cosmetic only; the
                                                   // server-signed name wins

  await SAS.ensureSession(name);

  SAS.on("state", applyState)
     .on("tick", ({ positionSec }) => drift(positionSec))
     .on("denied", (action) => toast(`Not allowed: ${action}`))
     .on("status", (s) => setConnectionBadge(s));

  SAS.connect();
}

/* Single render entry point — replaces every Firebase .on('value') listener */
function applyState(s) {
  renderQueue(s.queue, s.nowPlaying.index);       // your existing function
  renderFleet(s.devices);                          // your existing function
  renderActivity(s.activity);                      // names are server-set now
  applyNowPlaying(s.nowPlaying);

  // Cosmetic gating. Hiding a button is a courtesy, not a control.
  document.body.dataset.role = s.you?.role ?? "pending";
  toggleAdminUI(s.you?.role === "super_admin");
}

function applyNowPlaying(np) {
  document.getElementById("current-title").textContent =
    SAS.state.queue[np.index]?.title ?? "Select a track to begin";

  if (!player || !np.videoId) return;

  if (np.videoId !== lastAppliedVideo) {
    lastAppliedVideo = np.videoId;
    player.loadVideoById({ videoId: np.videoId, startSeconds: SAS.projectedPosition() });
  }

  // The host drives audio; everyone else mirrors muted so autoplay is allowed.
  if (SAS.isHost()) player.unMute(); else player.mute();

  np.isPlaying ? player.playVideo() : player.pauseVideo();
  player.setVolume(np.volume);
}

/* Non-host devices nudge themselves back in sync if they drift >1.5s. */
function drift(serverPos) {
  if (SAS.isHost() || !player?.getCurrentTime) return;
  if (Math.abs(player.getCurrentTime() - serverPos) > 1.5) player.seekTo(serverPos, true);
}

/* Host publishes its true position ~2×/sec so the room stays locked. */
setInterval(() => {
  if (SAS.isHost() && player?.getCurrentTime) SAS.hostTick(player.getCurrentTime());
}, 500);

/* The host's player ending a track advances the room. */
function onPlayerStateChange(e) {
  if (SAS.isHost() && e.data === YT.PlayerState.ENDED) SAS.next();
}

/* --- control handlers: send intents, never mutate local state ------- */
function toggleMainPlayback() { SAS.state.nowPlaying.isPlaying ? SAS.pause() : SAS.play(); }
function playNext() { SAS.next(); }
function playPrev() { SAS.prev(); }
function onMasterVolumeInput(el) { SAS.setVolume(el.value); }
function selectTrack(i) { SAS.goto(i); }
function clearAllTracks() { SAS.clearQueue(); }

function addLink() {
  const raw = document.getElementById("link-input").value;
  const id = extractVideoId(raw);            // your existing parser
  if (!id) return toast("Invalid YouTube link");
  SAS.addTrack(id, raw);                     // server records WHO added it
  document.getElementById("link-input").value = "";
}

/* Replaces the old prompt-and-compare-hash flow entirely. */
async function openAdminPanel() {
  if (SAS.canControl()) return showAdminModal();
  const phrase = prompt("Enter Admin Passphrase:");
  if (!phrase) return;
  const res = await SAS.elevate(phrase);
  res.ok ? showAdminModal() : alert("Invalid passphrase.");
}

function approveDevice(deviceId) { SAS.setDeviceRole(deviceId, "admin", "approved"); }
function revokeDevice(deviceId)  { SAS.setDeviceRole(deviceId, "admin", "revoked"); }
function demoteDevice(deviceId)  { SAS.setDeviceRole(deviceId, "guest", "guest"); }

window.addEventListener("DOMContentLoaded", boot);
