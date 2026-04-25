// Orbital detector. Watches for a *double blink* gesture from gaze-core.js
// (two natural `blink:released` events within ORBITAL_DOUBLE_WINDOW_MS) and
// dispatches `gesture:orbital-open` at the user's current gaze point.
//
// We use double-blink instead of double-mouth-open because the EAR/blink
// pipeline auto-calibrates on every session, while mouth detection requires a
// successful Alt+M calibration. Double-blink "just works" the moment head
// tracking is on.
//
// Coordinated with gaze-dwell.js + orbital-menu.js: while window.__orbitalActive
// is true, this detector ignores further blinks so menu-confirm clicks (mouth)
// don't accidentally re-open the menu.

(function() {
  'use strict';

  const ORBITAL_DOUBLE_WINDOW_MS = 500;
  const QUICK_BLINK_MAX_MS = 400; // a "quick" blink is < 400ms; longer = a deliberate hold
  // Head nod tuning. We watch a short pitch history and look for a deflection
  // (down then back to baseline, OR up then back) of at least NOD_AMPLITUDE_DEG
  // within NOD_WINDOW_MS. Cooldown prevents repeats.
  const NOD_WINDOW_MS = 700;
  const NOD_AMPLITUDE_DEG = 10;
  const NOD_BASELINE_TOLERANCE_DEG = 4;
  const NOD_COOLDOWN_MS = 1500;
  const DEBUG = false;

  let lastBlinkTs = 0;
  let lastNodTs = 0;
  let lastGazeX = window.innerWidth / 2;
  let lastGazeY = window.innerHeight / 2;
  const pitchHistory = []; // { ts, pitch }

  window.addEventListener('gaze:point', (event) => {
    const detail = event.detail || {};
    if (Number.isFinite(detail.x) && Number.isFinite(detail.y)) {
      lastGazeX = detail.x;
      lastGazeY = detail.y;
    }
  });

  function openMenuAt(x, y) {
    if (window.__orbitalActive) return;
    const cx = Number.isFinite(x) ? x : lastGazeX;
    const cy = Number.isFinite(y) ? y : lastGazeY;
    if (DEBUG) console.debug('[Hephaestus/orbital-detector] open at', cx, cy);
    window.dispatchEvent(new CustomEvent('gesture:orbital-open', {
      detail: { x: cx, y: cy }
    }));
  }

  window.addEventListener('blink:released', (event) => {
    if (window.__orbitalActive) return;

    const detail = event.detail || {};
    const duration = typeof detail.duration === 'number' ? detail.duration : 0;
    // Skip long deliberate blinks — gaze-core.js promotes those into blink:click
    // events (used for clicking links). We only want quick natural blinks here.
    if (duration > QUICK_BLINK_MAX_MS) {
      lastBlinkTs = 0;
      return;
    }

    const now = performance.now();
    const elapsed = now - lastBlinkTs;
    lastBlinkTs = now;

    if (elapsed < ORBITAL_DOUBLE_WINDOW_MS && elapsed > 80) {
      lastBlinkTs = 0;
      openMenuAt(lastGazeX, lastGazeY);
    }
  });

  // Keyboard fallback: Alt+O opens the menu at viewport center.
  // Robust path for demos when biometric calibration isn't cooperating.
  document.addEventListener('keydown', (event) => {
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyO') {
      event.preventDefault();
      openMenuAt(window.innerWidth / 2, window.innerHeight / 2);
    }
  }, true);

  // Head-nod detector — calibration-free biometric trigger. Listens to the
  // head:frame stream from gaze-core.js and looks for a quick pitch deflection
  // (chin down then back up) within a short window.
  window.addEventListener('head:frame', (event) => {
    if (window.__orbitalActive) return;
    const detail = event.detail || {};
    const pitch = typeof detail.pitchDeg === 'number' ? detail.pitchDeg : null;
    if (pitch === null) return;
    const now = performance.now();
    pitchHistory.push({ ts: now, pitch });
    // Drop samples older than the nod window.
    while (pitchHistory.length && now - pitchHistory[0].ts > NOD_WINDOW_MS) {
      pitchHistory.shift();
    }
    if (pitchHistory.length < 5) return;
    if (now - lastNodTs < NOD_COOLDOWN_MS) return;

    const first = pitchHistory[0].pitch;
    const last = pitchHistory[pitchHistory.length - 1].pitch;
    let extremePitch = first;
    let extremeIdx = 0;
    for (let i = 1; i < pitchHistory.length; i++) {
      if (Math.abs(pitchHistory[i].pitch - first) > Math.abs(extremePitch - first)) {
        extremePitch = pitchHistory[i].pitch;
        extremeIdx = i;
      }
    }
    const amplitude = Math.abs(extremePitch - first);
    const returnedToBaseline = Math.abs(last - first) < NOD_BASELINE_TOLERANCE_DEG;
    // Need a proper there-and-back: extreme must be in the middle of the window,
    // not at the very end (otherwise it's a sustained head turn, not a nod).
    const extremeInMiddle = extremeIdx > 0 && extremeIdx < pitchHistory.length - 1;

    if (amplitude >= NOD_AMPLITUDE_DEG && returnedToBaseline && extremeInMiddle) {
      lastNodTs = now;
      pitchHistory.length = 0;
      if (DEBUG) console.debug('[Hephaestus/orbital-detector] head nod amplitude=', amplitude.toFixed(1));
      openMenuAt(lastGazeX, lastGazeY);
    }
  });

  // Allow other content scripts (e.g. content.js, side panel via message bridge)
  // to programmatically request the menu.
  window.addEventListener('orbital:request-open', (event) => {
    const detail = (event && event.detail) || {};
    openMenuAt(detail.x, detail.y);
  });
})();
