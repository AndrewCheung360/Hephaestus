// Hephaestus content script.
// 1. Replies to GET_PAGE_CONTEXT with a Readability extract of the current page.
// 2. Listens for `gesture:orbital-select` from the orbital menu and dispatches
//    the corresponding ACTION_REQUEST to the background service worker.

(function() {
  'use strict';

  const DEBUG = false;

  function log(...args) {
    if (DEBUG) console.debug('[Hephaestus/content]', ...args);
  }

  function pickSelectionText() {
    try {
      const sel = window.getSelection && window.getSelection();
      const text = sel ? sel.toString() : '';
      return text && text.trim().length > 20 ? text.trim() : null;
    } catch (_) {
      return null;
    }
  }

  function readabilityExtract() {
    try {
      // Readability mutates the document it walks, so always pass a clone.
      const docClone = document.cloneNode(true);
      // eslint-disable-next-line no-undef
      const article = new Readability(docClone).parse();
      if (!article) return null;
      return {
        title: article.title || document.title || '',
        textContent: (article.textContent || '').trim(),
        excerpt: article.excerpt || '',
        length: article.length || 0
      };
    } catch (err) {
      log('Readability failed', err);
      return null;
    }
  }

  function fallbackExtract() {
    const main = document.querySelector('main, article, [role="main"]') || document.body;
    return {
      title: document.title || '',
      textContent: main ? main.innerText.trim() : '',
      excerpt: '',
      length: main ? main.innerText.length : 0
    };
  }

  function getPageContext() {
    const extracted = readabilityExtract() || fallbackExtract();
    const selectionText = pickSelectionText();
    return {
      url: location.href,
      title: extracted.title,
      textContent: selectionText || extracted.textContent || '',
      selectionText,
      extractedAt: Date.now()
    };
  }

  // Cache the most recent context so the orbital menu doesn't have to re-extract
  // on every selection. The cache lives for one page navigation.
  let cachedContext = null;
  let cachedAt = 0;
  const CONTEXT_TTL_MS = 30 * 1000;

  function getOrFreshenContext() {
    if (cachedContext && Date.now() - cachedAt < CONTEXT_TTL_MS) return cachedContext;
    cachedContext = getPageContext();
    cachedAt = Date.now();
    return cachedContext;
  }

  // ---- Message bridge ----
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;
    if (message.type === 'GET_PAGE_CONTEXT') {
      sendResponse(getPageContext());
      return true;
    }
    if (message.type === 'gaze:calibrate-head') {
      window.dispatchEvent(new CustomEvent('head-cal:start'));
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === 'gaze:calibrate-mouth') {
      window.dispatchEvent(new CustomEvent('mouth-cal:start'));
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  // ---- Orbital menu → background ----
  window.addEventListener('gesture:orbital-select', (event) => {
    const detail = event.detail || {};
    const action = detail.action;
    if (!action) return;
    const pageContext = getOrFreshenContext();
    log('dispatch action', action);
    try {
      chrome.runtime.sendMessage({
        type: 'ACTION_REQUEST',
        action,
        pageContext
      }).catch((err) => log('ACTION_REQUEST send failed', err));
    } catch (err) {
      log('ACTION_REQUEST exception', err);
    }
  });

  // Refresh cached context on SPA navigation (e.g. Canvas modules).
  let lastHref = location.href;
  const hrefObserver = new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      cachedContext = null;
    }
  });
  if (document.body) {
    hrefObserver.observe(document.body, { childList: true, subtree: true });
  }
})();
