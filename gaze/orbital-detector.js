// Orbital detector. Watches for a *double* mouth-open gesture (two `smile:click`
// events from gaze-core.js within ORBITAL_DOUBLE_WINDOW_MS) and dispatches
// `gesture:orbital-open` at the user's current gaze point.
//
// Coordinated with gaze-dwell.js: while window.__orbitalActive is true,
// gaze-dwell ignores `smile:click` so single-click and orbital-confirm don't
// fight for the same event.

(function() {
  'use strict';

  const ORBITAL_DOUBLE_WINDOW_MS = 400;
  const DEBUG = false;

  let lastSmileTs = 0;
  let lastGazeX = window.innerWidth / 2;
  let lastGazeY = window.innerHeight / 2;

  window.addEventListener('gaze:point', (event) => {
    const detail = event.detail || {};
    if (Number.isFinite(detail.x) && Number.isFinite(detail.y)) {
      lastGazeX = detail.x;
      lastGazeY = detail.y;
    }
  });

  window.addEventListener('smile:click', () => {
    // If the orbital menu is already open, the *menu* owns this click as a
    // confirm; bail.
    if (window.__orbitalActive) return;

    const now = performance.now();
    const elapsed = now - lastSmileTs;
    lastSmileTs = now;
    if (elapsed < ORBITAL_DOUBLE_WINDOW_MS && elapsed > 60) {
      // Double-tap! Suppress further matching for a beat.
      lastSmileTs = 0;
      if (DEBUG) console.debug('[Hephaestus/orbital-detector] double-mouth at', lastGazeX, lastGazeY);
      window.dispatchEvent(new CustomEvent('gesture:orbital-open', {
        detail: { x: lastGazeX, y: lastGazeY }
      }));
    }
  });
})();
