// Orbital menu — renders a radial command UI at the user's gaze point on
// `gesture:orbital-open`, focuses the icon nearest the gaze, and confirms the
// selection on the next `smile:click`. Sets window.__orbitalActive while open so
// gaze-dwell.js stays out of the way.

(function() {
  'use strict';

  const ITEMS = [
    { action: 'summary',       label: 'Summary',     glyph: '❖' },
    { action: 'flashcards',    label: 'Flashcards',  glyph: '❖' },
    { action: 'quiz',          label: 'Quiz',        glyph: '❖' },
    { action: 'podcast',       label: 'Podcast',     glyph: '❖' },
    { action: 'video',         label: 'Video',       glyph: '❖' },
    { action: 'mastery_path',  label: 'Mastery Path',glyph: '❖' }
  ];

  // Use distinct emoji-style glyphs without crossing into emoji (per house rules).
  // We use Dingbats / geometric symbols so each icon is visually distinct.
  const GLYPHS = {
    summary:      '¶',  // ¶
    flashcards:   '☰',  // ☰
    quiz:         '❔',  // ❔ (kept — non-decorative)
    podcast:      '♫',  // ♫
    video:        '▶',  // ▶
    mastery_path: '★'   // ★
  };
  for (const item of ITEMS) item.glyph = GLYPHS[item.action] || item.glyph;

  const RADIUS = 130;
  const FOCUS_RADIUS = 70;
  const CSS_HREF = chrome.runtime.getURL('orbital/orbital-menu.css');

  let root = null;
  let veil = null;
  let hint = null;
  let itemEls = [];
  let focusedIndex = -1;
  let openCenter = null; // {x, y}
  let lastGazeX = 0;
  let lastGazeY = 0;
  let cssInjected = false;

  function ensureCss() {
    if (cssInjected) return;
    cssInjected = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_HREF;
    document.head.appendChild(link);
  }

  function buildMenu(cx, cy) {
    teardown();
    ensureCss();

    root = document.createElement('div');
    root.className = 'heph-orbital-root';
    root.style.setProperty('--heph-cx', `${cx}px`);
    root.style.setProperty('--heph-cy', `${cy}px`);

    veil = document.createElement('div');
    veil.className = 'heph-orbital-veil';
    root.appendChild(veil);

    itemEls = ITEMS.map((item, i) => {
      const angle = -Math.PI / 2 + (i / ITEMS.length) * Math.PI * 2;
      const x = cx + Math.cos(angle) * RADIUS;
      const y = cy + Math.sin(angle) * RADIUS;
      const el = document.createElement('div');
      el.className = 'heph-orbital-item';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.dataset.action = item.action;
      el.dataset.cx = String(x);
      el.dataset.cy = String(y);

      const glyph = document.createElement('div');
      glyph.className = 'heph-orbital-glyph';
      glyph.textContent = item.glyph;
      el.appendChild(glyph);

      const label = document.createElement('div');
      label.className = 'heph-orbital-label';
      label.textContent = item.label;
      el.appendChild(label);

      root.appendChild(el);
      return el;
    });

    hint = document.createElement('div');
    hint.className = 'heph-orbital-hint';
    hint.textContent = 'Look at an option • open mouth to confirm • Esc to cancel';
    root.appendChild(hint);

    document.documentElement.appendChild(root);
    // Force layout, then add the open class so the CSS transitions kick in.
    requestAnimationFrame(() => {
      if (root) root.classList.add('heph-open');
    });
  }

  function teardown() {
    window.__orbitalActive = false;
    focusedIndex = -1;
    openCenter = null;
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    veil = null;
    hint = null;
    itemEls = [];
  }

  function updateFocus(x, y) {
    if (!itemEls.length) return;
    let bestIdx = -1;
    let bestDist = FOCUS_RADIUS;
    for (let i = 0; i < itemEls.length; i++) {
      const el = itemEls[i];
      const cx = parseFloat(el.dataset.cx);
      const cy = parseFloat(el.dataset.cy);
      const d = Math.hypot(cx - x, cy - y);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx === focusedIndex) return;
    if (focusedIndex >= 0 && itemEls[focusedIndex]) {
      itemEls[focusedIndex].classList.remove('heph-focused');
    }
    focusedIndex = bestIdx;
    if (focusedIndex >= 0) {
      itemEls[focusedIndex].classList.add('heph-focused');
    }
  }

  function close() {
    teardown();
  }

  function confirm() {
    if (focusedIndex < 0) {
      close();
      return;
    }
    const action = ITEMS[focusedIndex].action;
    teardown();
    window.dispatchEvent(new CustomEvent('gesture:orbital-select', { detail: { action } }));
  }

  // ---- Event wiring ----
  window.addEventListener('gesture:orbital-open', (event) => {
    const detail = event.detail || {};
    const cx = Number.isFinite(detail.x) ? detail.x : window.innerWidth / 2;
    const cy = Number.isFinite(detail.y) ? detail.y : window.innerHeight / 2;
    openCenter = { x: cx, y: cy };
    window.__orbitalActive = true;
    buildMenu(cx, cy);
    // Default focus: snap to the user's current gaze (which is the center).
    updateFocus(cx, cy);
  });

  window.addEventListener('gaze:point', (event) => {
    const detail = event.detail || {};
    if (Number.isFinite(detail.x) && Number.isFinite(detail.y)) {
      lastGazeX = detail.x;
      lastGazeY = detail.y;
      if (root) updateFocus(detail.x, detail.y);
    }
  });

  // Mouth-open while the menu is open = confirm. We add this listener with
  // `capture: true` and a higher priority by being defined here AFTER the gaze
  // detector — but window.__orbitalActive is the real gate (gaze-dwell + the
  // orbital detector both bail out when it's true).
  window.addEventListener('smile:click', () => {
    if (!window.__orbitalActive) return;
    confirm();
  });

  document.addEventListener('keydown', (event) => {
    if (!window.__orbitalActive) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }, true);

  // Click outside the menu also cancels (useful while developing with mouse).
  window.addEventListener('mousedown', (event) => {
    if (!window.__orbitalActive || !openCenter) return;
    const dist = Math.hypot(event.clientX - openCenter.x, event.clientY - openCenter.y);
    if (dist > RADIUS + 60) close();
  }, true);
})();
