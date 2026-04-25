(function() {
  'use strict';

  const POINT_EVENT = 'gaze:point';
  const STATUS_EVENT = 'gaze:status';
  const DEBUG_DWELL = false;
  const DEFAULT_DWELL_MS = 600;
  const EDGE_PAD_PX = 180;
  const EDGE_HOLD_MS = 400;
  const MAX_LINK_SCAN = 500;
  const DEADZONE_PX = 12;
  const STICKY_RADIUS_PX = 45;
  const SCROLL_ZONE_ID = 'gaze-scroll-zones';
  const DWELL_INDICATOR_ID = 'gaze-dwell-indicator';
  // Browser navigation: dwelling on the left/right viewport edge fires
  // history.back() / history.forward(). Slightly longer than the link-dwell
  // threshold so accidental drift to the edges doesn't navigate.
  const NAV_ZONE_WIDTH = 80;
  const NAV_DWELL_MS = 900;
  const NAV_COOLDOWN_MS = 1500;

  let gazeEnabled = false;
  let dwellThreshold = DEFAULT_DWELL_MS;
  let phase = 'ready';
  let dwellTarget = null;
  let dwellAccum = 0;
  let lastPointTs = performance.now();
  let lastPointerX = 0;
  let lastPointerY = 0;
  let effectiveX = null;
  let effectiveY = null;
  let snappedLink = null;
  let lastSnapLink = null;
  let scrollZones = null;
  let dwellIndicator = null;
  const edgeHold = { top: 0, bottom: 0 };
  let navDwellSide = null; // 'back' | 'forward' | null
  let navDwellStart = 0;
  let lastNavFiredAt = 0;

  function ensureScrollZones() {
    if (scrollZones && scrollZones.parentNode) {
      return scrollZones;
    }
    if (!document.body) {
      return null;
    }
    scrollZones = document.createElement('div');
    scrollZones.id = SCROLL_ZONE_ID;
    scrollZones.style.cssText = `
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483645;
    `;

    const topZone = document.createElement('div');
    topZone.id = 'gaze-scroll-top';
    topZone.style.cssText = `
      position: absolute; top: 0; left: 0; right: 0;
      height: ${EDGE_PAD_PX}px;
      background: linear-gradient(180deg, rgba(255, 168, 76, 0.18) 0%, rgba(255, 168, 76, 0) 100%);
      border-bottom: 1px solid rgba(255, 168, 76, 0.35);
      opacity: 0;
      transition: opacity 0.2s ease;
    `;

    const bottomZone = document.createElement('div');
    bottomZone.id = 'gaze-scroll-bottom';
    bottomZone.style.cssText = `
      position: absolute; bottom: 0; left: 0; right: 0;
      height: ${EDGE_PAD_PX}px;
      background: linear-gradient(0deg, rgba(255, 168, 76, 0.18) 0%, rgba(255, 168, 76, 0) 100%);
      border-top: 1px solid rgba(255, 168, 76, 0.35);
      opacity: 0;
      transition: opacity 0.2s ease;
    `;

    const leftZone = document.createElement('div');
    leftZone.id = 'gaze-nav-left';
    leftZone.style.cssText = `
      position: absolute; top: 0; bottom: 0; left: 0;
      width: ${NAV_ZONE_WIDTH}px;
      background: linear-gradient(90deg, rgba(147, 51, 234, 0.20) 0%, rgba(147, 51, 234, 0) 100%);
      border-right: 1px solid rgba(147, 51, 234, 0.40);
      opacity: 0;
      transition: opacity 0.15s ease;
    `;
    const leftFill = document.createElement('div');
    leftFill.id = 'gaze-nav-left-fill';
    leftFill.style.cssText = `
      position: absolute; left: 0; top: 50%; transform: translateY(-50%);
      width: 6px; height: 0%;
      background: rgba(147, 51, 234, 0.85);
      border-radius: 0 4px 4px 0;
      transition: height 0.08s linear;
    `;
    leftZone.appendChild(leftFill);

    const rightZone = document.createElement('div');
    rightZone.id = 'gaze-nav-right';
    rightZone.style.cssText = `
      position: absolute; top: 0; bottom: 0; right: 0;
      width: ${NAV_ZONE_WIDTH}px;
      background: linear-gradient(270deg, rgba(251, 146, 60, 0.20) 0%, rgba(251, 146, 60, 0) 100%);
      border-left: 1px solid rgba(251, 146, 60, 0.40);
      opacity: 0;
      transition: opacity 0.15s ease;
    `;
    const rightFill = document.createElement('div');
    rightFill.id = 'gaze-nav-right-fill';
    rightFill.style.cssText = `
      position: absolute; right: 0; top: 50%; transform: translateY(-50%);
      width: 6px; height: 0%;
      background: rgba(251, 146, 60, 0.85);
      border-radius: 4px 0 0 4px;
      transition: height 0.08s linear;
    `;
    rightZone.appendChild(rightFill);

    scrollZones.appendChild(topZone);
    scrollZones.appendChild(bottomZone);
    scrollZones.appendChild(leftZone);
    scrollZones.appendChild(rightZone);
    document.body.appendChild(scrollZones);
    return scrollZones;
  }

  function updateNavZoneVisibility(side, progress) {
    const left = document.getElementById('gaze-nav-left');
    const right = document.getElementById('gaze-nav-right');
    const leftFill = document.getElementById('gaze-nav-left-fill');
    const rightFill = document.getElementById('gaze-nav-right-fill');
    if (!left || !right) return;
    left.style.opacity = side === 'back' ? '1' : '0';
    right.style.opacity = side === 'forward' ? '1' : '0';
    if (leftFill) leftFill.style.height = side === 'back' ? `${Math.round(progress * 100)}%` : '0%';
    if (rightFill) rightFill.style.height = side === 'forward' ? `${Math.round(progress * 100)}%` : '0%';
  }

  function navLoop(x, ts) {
    if (window.__orbitalActive) {
      navDwellSide = null;
      navDwellStart = 0;
      updateNavZoneVisibility(null, 0);
      return;
    }
    if (ts - lastNavFiredAt < NAV_COOLDOWN_MS) {
      updateNavZoneVisibility(null, 0);
      return;
    }
    const w = window.innerWidth;
    const inLeft = x < NAV_ZONE_WIDTH;
    const inRight = x > w - NAV_ZONE_WIDTH;
    const side = inLeft ? 'back' : inRight ? 'forward' : null;

    if (side !== navDwellSide) {
      navDwellSide = side;
      navDwellStart = side ? ts : 0;
      updateNavZoneVisibility(side, 0);
      return;
    }
    if (!side) {
      updateNavZoneVisibility(null, 0);
      return;
    }
    const elapsed = ts - navDwellStart;
    const progress = Math.min(1, elapsed / NAV_DWELL_MS);
    updateNavZoneVisibility(side, progress);
    if (elapsed >= NAV_DWELL_MS) {
      lastNavFiredAt = ts;
      navDwellSide = null;
      navDwellStart = 0;
      updateNavZoneVisibility(null, 0);
      if (side === 'back') {
        beep(420, 130);
        try { window.history.back(); } catch (_) {}
      } else {
        beep(640, 130);
        try { window.history.forward(); } catch (_) {}
      }
    }
  }

  function updateScrollZoneVisibility(topIntensity, bottomIntensity) {
    if (!scrollZones) return;
    const topZone = document.getElementById('gaze-scroll-top');
    const bottomZone = document.getElementById('gaze-scroll-bottom');
    if (topZone) topZone.style.opacity = topIntensity > 0.5 ? String(Math.min(1, topIntensity)) : '0';
    if (bottomZone) bottomZone.style.opacity = bottomIntensity > 0.5 ? String(Math.min(1, bottomIntensity)) : '0';
  }

  function ensureDwellIndicator() {
    if (dwellIndicator) return dwellIndicator;
    dwellIndicator = document.createElement('div');
    dwellIndicator.id = DWELL_INDICATOR_ID;
    dwellIndicator.style.cssText = `
      position: fixed;
      width: 8px; height: 8px;
      border-radius: 50%;
      background: rgba(255, 168, 76, 0.9);
      box-shadow: 0 0 0 0 rgba(255, 168, 76, 0.6);
      pointer-events: none;
      z-index: 2147483646;
      display: none;
      transition: box-shadow 0.1s ease-out;
    `;
    document.body.appendChild(dwellIndicator);
    return dwellIndicator;
  }

  function updateDwellIndicator(target, progress) {
    const indicator = ensureDwellIndicator();
    if (!target || progress <= 0) {
      indicator.style.display = 'none';
      return;
    }
    const rect = target.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    indicator.style.display = 'block';
    indicator.style.left = `${cx - 4}px`;
    indicator.style.top = `${cy - 4}px`;
    const ringSize = Math.round(progress * 20);
    indicator.style.boxShadow = `0 0 0 ${ringSize}px rgba(255, 168, 76, ${0.4 * (1 - progress)})`;
  }

  function hideDwellIndicator() {
    if (dwellIndicator) dwellIndicator.style.display = 'none';
  }

  function beep(frequency = 440, duration = 120) {
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.10, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration / 1000);
      osc.start(now);
      osc.stop(now + duration / 1000 + 0.05);
      osc.onended = () => ctx.close();
    } catch (_) {}
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
  }

  function nearestLink(x, y, maxDistance = 42) {
    const baseElement = document.elementFromPoint(x, y);
    const immediate = baseElement ? baseElement.closest('a,[role="link"],button,[role="button"]') : null;
    if (immediate) return immediate;
    const candidates = document.querySelectorAll('a,[role="link"],button,[role="button"]');
    let best = null;
    let bestDistance = maxDistance;
    let count = 0;
    for (const candidate of candidates) {
      if (count++ > MAX_LINK_SCAN) break;
      const rect = candidate.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) continue;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dist = Math.hypot(cx - x, cy - y);
      if (dist < bestDistance) {
        bestDistance = dist;
        best = candidate;
      }
    }
    return best;
  }

  function snapLink(x, y) {
    if (snappedLink && !document.contains(snappedLink)) snappedLink = null;
    if (snappedLink) {
      const rect = snappedLink.getBoundingClientRect();
      if (rect && rect.width && rect.height) {
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        if (Math.hypot(cx - x, cy - y) < STICKY_RADIUS_PX) return snappedLink;
      }
      snappedLink = null;
    }
    const next = nearestLink(x, y, 42);
    if (next) {
      snappedLink = next;
      lastSnapLink = next;
    }
    return snappedLink;
  }

  function applyDeadzone(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { x, y };
    if (effectiveX === null || effectiveY === null) {
      effectiveX = x;
      effectiveY = y;
      return { x, y };
    }
    const dist = Math.hypot(x - effectiveX, y - effectiveY);
    if (dist < DEADZONE_PX) return { x: effectiveX, y: effectiveY };
    effectiveX = x;
    effectiveY = y;
    return { x, y };
  }

  function edgeLoop(x, y) {
    ensureScrollZones();
    const now = performance.now();
    const h = window.innerHeight;
    const topIntensity = y < EDGE_PAD_PX ? 1 - (y / EDGE_PAD_PX) : 0;
    const bottomIntensity = y > h - EDGE_PAD_PX ? (y - (h - EDGE_PAD_PX)) / EDGE_PAD_PX : 0;
    const intents = { top: topIntensity, bottom: bottomIntensity };
    for (const key of Object.keys(intents)) {
      const intensity = intents[key];
      if (intensity > 0.65) {
        if (!edgeHold[key]) {
          edgeHold[key] = now;
        } else if (now - edgeHold[key] > EDGE_HOLD_MS) {
          if (key === 'top') {
            window.scrollBy({ top: -(120 + 360 * intensity), behavior: 'smooth' });
          } else {
            window.scrollBy({ top: 120 + 360 * intensity, behavior: 'smooth' });
          }
          edgeHold[key] = now;
        }
      } else {
        edgeHold[key] = 0;
      }
    }
    updateScrollZoneVisibility(topIntensity, bottomIntensity);
  }

  function synthClick(target, button = 0) {
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const clientX = clamp(lastPointerX, rect.left, rect.right);
    const clientY = clamp(lastPointerY, rect.top, rect.bottom);
    if (typeof target.focus === 'function') {
      try { target.focus({ preventScroll: true }); } catch (_) {}
    }
    const downInit = { bubbles: true, cancelable: true, clientX, clientY, button, buttons: 1 };
    const upInit = { bubbles: true, cancelable: true, clientX, clientY, button, buttons: 0 };
    ['pointerover', 'pointerenter', 'mousemove', 'pointerdown', 'mousedown'].forEach((type) => {
      target.dispatchEvent(new MouseEvent(type, downInit));
    });
    ['mouseup', 'pointerup', 'click'].forEach((type) => {
      target.dispatchEvent(new MouseEvent(type, upInit));
    });
  }

  function handlePointEvent(event) {
    if (!gazeEnabled || phase !== 'live') return;
    const detail = event.detail || {};
    if (!Number.isFinite(detail.x) || !Number.isFinite(detail.y)) return;
    const rawX = clamp(detail.x, 0, window.innerWidth - 1);
    const rawY = clamp(detail.y, 0, window.innerHeight - 1);
    lastPointerX = rawX;
    lastPointerY = rawY;
    edgeLoop(rawX, rawY);

    const ts0 = typeof detail.ts === 'number' ? detail.ts : performance.now();
    navLoop(rawX, ts0);

    // Suppress dwell-to-click while orbital menu is active — it owns gaze targeting.
    if (window.__orbitalActive) {
      hideDwellIndicator();
      dwellTarget = null;
      dwellAccum = 0;
      return;
    }

    // Suppress link-dwell focusing while the gaze is parked in a nav edge so
    // the dwell ring doesn't fight with the nav-zone fill animation.
    if (rawX < NAV_ZONE_WIDTH || rawX > window.innerWidth - NAV_ZONE_WIDTH) {
      hideDwellIndicator();
      dwellTarget = null;
      dwellAccum = 0;
      return;
    }

    const { x, y } = applyDeadzone(rawX, rawY);
    const ts = typeof detail.ts === 'number' ? detail.ts : performance.now();
    const delta = Math.max(0, Math.min(500, ts - lastPointTs));
    lastPointTs = ts;

    const target = snapLink(x, y);

    if (target !== dwellTarget) {
      dwellTarget = target;
      dwellAccum = 0;
      hideDwellIndicator();
    }

    if (!target) {
      hideDwellIndicator();
      return;
    }

    // Dwell is a TARGETING indicator only — it shows what's snapped, but never
    // fires a click. Clicks come from explicit gestures (mouth-open, blink-hold).
    dwellAccum += delta;
    const progress = Math.min(1, dwellAccum / dwellThreshold);
    updateDwellIndicator(target, progress);
  }

  // Single mouth-open = click on snapped link. The orbital detector intercepts
  // the *second* mouth-open within ORBITAL_DOUBLE_WINDOW_MS to open the menu;
  // when window.__orbitalActive is true we get out of the way.
  window.addEventListener('smile:click', () => {
    if (window.__orbitalActive) return;
    const target = lastSnapLink || nearestLink(lastPointerX, lastPointerY) || document.elementFromPoint(lastPointerX, lastPointerY);
    if (!target) {
      beep(280, 140);
      return;
    }
    synthClick(target, 0);
    beep(660, 150);
  });

  window.addEventListener('blink:click', (event) => {
    if (window.__orbitalActive) return;
    const button = event && event.detail && event.detail.button === 'right' ? 2 : 0;
    const target = lastSnapLink || nearestLink(lastPointerX, lastPointerY) || document.elementFromPoint(lastPointerX, lastPointerY);
    if (!target) {
      beep(280, 140);
      return;
    }
    synthClick(target, button);
    beep(button === 2 ? 320 : 560, 150);
  });

  function handleStorageChange(changes, areaName) {
    if (areaName !== 'local') return;
    if (changes.gazeEnabled) gazeEnabled = Boolean(changes.gazeEnabled.newValue);
    if (changes.gazeDwellMs) {
      const v = changes.gazeDwellMs.newValue;
      if (typeof v === 'number' && v >= 200) dwellThreshold = v;
    }
  }

  function init() {
    ensureScrollZones();
    window.addEventListener(POINT_EVENT, handlePointEvent);
    window.addEventListener(STATUS_EVENT, (event) => {
      const detail = event.detail || {};
      phase = detail.phase || phase;
      if (phase !== 'live') {
        dwellAccum = 0;
        hideDwellIndicator();
      }
    });
    chrome.storage.onChanged.addListener(handleStorageChange);
    chrome.storage.local.get(['gazeEnabled', 'gazeDwellMs'], (result) => {
      gazeEnabled = Boolean(result && result.gazeEnabled);
      const dwell = result && typeof result.gazeDwellMs === 'number' ? result.gazeDwellMs : DEFAULT_DWELL_MS;
      dwellThreshold = dwell >= 200 ? dwell : DEFAULT_DWELL_MS;
    });
  }

  init();
})();
