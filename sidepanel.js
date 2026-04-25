// Hephaestus side panel.
// Manages: gaze toggle/calibration controls, local server URL + health, tabbed
// action output, and Web Speech podcast playback.

(function() {
  'use strict';

  const TABS = ['summary', 'flashcards', 'quiz', 'podcast', 'video', 'mastery_path'];
  const MOUTH_CAL_STORAGE_KEY = 'mouthCalV1';

  function $(id) { return document.getElementById(id); }

  /** MV3: `sendMessage` only returns a Promise in newer Chrome; callbacks work everywhere. */
  function runtimeSend(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(response);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  /** Active page tab while the side panel is focused (avoids wrong tab vs `currentWindow`). */
  function queryActivePageTab(callback) {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, callback);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function applyMouthCalStatus(res) {
    const cal = res[MOUTH_CAL_STORAGE_KEY];
    const text = $('mouth-status-text');
    const dot = $('mouth-status-dot');
    if (!text) return;
    const ok = Boolean(cal && typeof cal.threshold === 'number' && cal.timestamp);
    text.textContent = ok ? 'Calibrated' : 'Not calibrated';
    if (dot) dot.classList.toggle('on', ok);
  }

  // ---- Gaze + mouth toggle wiring ----
  function initGazeControls() {
    chrome.storage.local.get(
      ['gazeEnabled', 'mouthClickEnabled', 'gazeDwellMs', MOUTH_CAL_STORAGE_KEY],
      (res) => {
        $('gaze-enabled').checked = Boolean(res.gazeEnabled);
        $('mouth-click-enabled').checked = Boolean(res.mouthClickEnabled);
        const dwell = typeof res.gazeDwellMs === 'number' ? res.gazeDwellMs : 600;
        $('dwell-time').value = dwell;
        $('dwell-value').textContent = String(dwell);
        $('gaze-status-text').textContent = res.gazeEnabled ? 'Enabled' : 'Disabled';
        $('gaze-status-dot').classList.toggle('on', Boolean(res.gazeEnabled));
        applyMouthCalStatus(res);
      }
    );

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[MOUTH_CAL_STORAGE_KEY]) return;
      applyMouthCalStatus({
        [MOUTH_CAL_STORAGE_KEY]: changes[MOUTH_CAL_STORAGE_KEY].newValue
      });
    });

    $('gaze-enabled').addEventListener('change', (e) => {
      chrome.storage.local.set({ gazeEnabled: e.target.checked });
      $('gaze-status-text').textContent = e.target.checked ? 'Enabled' : 'Disabled';
      $('gaze-status-dot').classList.toggle('on', e.target.checked);
    });

    $('mouth-click-enabled').addEventListener('change', (e) => {
      chrome.storage.local.set({ mouthClickEnabled: e.target.checked });
    });

    $('dwell-time').addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      $('dwell-value').textContent = String(v);
      chrome.storage.local.set({ gazeDwellMs: v });
    });

    $('calibrate-btn').addEventListener('click', () => {
      sendToActiveTab({ type: 'gaze:calibrate-head' }, 'Head calibration');
    });
    $('calibrate-mouth-btn').addEventListener('click', () => {
      sendToActiveTab({ type: 'gaze:calibrate-mouth' }, 'Mouth calibration');
    });
    const openOrbital = $('open-orbital-btn');
    if (openOrbital) {
      openOrbital.addEventListener('click', () => {
        sendToActiveTab({ type: 'orbital:open' }, 'Open menu');
      });
    }
  }

  function sendToActiveTab(message, label) {
    queryActivePageTab((tabs) => {
      if (!tabs || !tabs[0]) {
        setStatus(`${label || 'Action'}: no active tab.`);
        return;
      }
      const tab = tabs[0];
      const blocked = !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://');
      if (blocked) {
        setStatus(`${label || 'Action'}: cannot run on ${tab.url}. Switch to a normal page.`);
        return;
      }
      chrome.tabs.sendMessage(tab.id, message).catch((err) => {
        setStatus(`${label || 'Action'} failed: ${err.message}. Reload the page if you just updated the extension.`);
      });
    });
  }

  // ---- Output tabs ----
  let activeTab = 'summary';

  function setActiveTab(tab) {
    if (!TABS.includes(tab)) return;
    activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      const on = btn.dataset.tab === tab;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.pane').forEach((pane) => {
      pane.classList.toggle('active', pane.dataset.pane === tab);
    });
  }

  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
    });
  }

  // ---- Run / cancel ----
  let currentJobId = null;

  function setStatus(msg) {
    const el = $('output-status');
    if (el) el.textContent = msg;
  }

  function requestRun(action) {
    queryActivePageTab((tabs) => {
      if (!tabs || !tabs[0]) {
        setStatus('No active tab.');
        return;
      }
      const tab = tabs[0];
      const blocked = !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:');
      if (blocked) {
        setStatus('Pick a normal web page tab (not chrome:// or the extensions page), then run again.');
        return;
      }
      const tabId = tab.id;
      runtimeSend({ type: 'REQUEST_PAGE_CONTEXT', tabId })
        .then((ctxResp) => {
          if (!ctxResp || ctxResp.error || !ctxResp.pageContext) {
            setStatus(`Could not extract page: ${ctxResp && ctxResp.error ? ctxResp.error : 'unknown error'}`);
            return;
          }
          return runtimeSend({
            type: 'ACTION_REQUEST',
            action,
            pageContext: ctxResp.pageContext,
            tabId
          });
        })
        .then((res) => {
          if (!res) return;
          if (res.error) {
            setStatus(`Error: ${res.error}`);
            return;
          }
          if (res.jobId) {
            currentJobId = res.jobId;
            setStatus(`Running ${action}…`);
            setActiveTab(action);
          }
        })
        .catch((err) => setStatus(`Send failed: ${err.message}`));
    });
  }

  function initActions() {
    $('run-active-btn').addEventListener('click', () => requestRun(activeTab));
    $('cancel-btn').addEventListener('click', () => {
      if (!currentJobId) return;
      runtimeSend({ type: 'ABORT_ACTION', jobId: currentJobId }).catch(() => {});
      setStatus('Cancelled.');
    });
  }

  // ---- Renderers ----
  const renderers = {};

  let summaryBuffer = '';
  renderers.summary = (msg) => {
    if (msg.status === 'started') {
      summaryBuffer = '';
      $('pane-summary').textContent = '';
    } else if (msg.status === 'streaming' && typeof msg.chunk === 'string') {
      summaryBuffer += msg.chunk;
      $('pane-summary').textContent = summaryBuffer;
    } else if (msg.status === 'complete') {
      $('pane-summary').innerHTML = renderMarkdownLite(msg.text || summaryBuffer);
    } else if (msg.status === 'error') {
      $('pane-summary').textContent = `Error: ${msg.message}`;
    } else if (msg.status === 'aborted') {
      $('pane-summary').textContent = (summaryBuffer || '') + '\n\n[Cancelled]';
    }
  };

  renderers.flashcards = (msg) => {
    if (msg.status === 'started' || msg.status === 'streaming') {
      $('pane-flashcards').innerHTML = '<em>Generating…</em>';
    } else if (msg.status === 'complete') {
      const cards = msg.cards || [];
      $('pane-flashcards').innerHTML = cards.length
        ? cards.map((c, i) => `
          <div class="flashcard" data-i="${i}">
            <div class="flashcard-front"><strong>Q${i + 1}.</strong> ${escapeHtml(c.front)}</div>
            <div class="flashcard-back hidden"><strong>A.</strong> ${escapeHtml(c.back)}</div>
            ${c.difficulty ? `<div class="flashcard-tag">${escapeHtml(c.difficulty)}</div>` : ''}
          </div>`).join('')
        : 'No cards returned.';
      document.querySelectorAll('#pane-flashcards .flashcard').forEach((el) => {
        el.addEventListener('click', () => {
          el.querySelector('.flashcard-back').classList.toggle('hidden');
        });
      });
    } else if (msg.status === 'error') {
      $('pane-flashcards').textContent = `Error: ${msg.message}`;
    }
  };

  renderers.quiz = (msg) => {
    if (msg.status === 'started' || msg.status === 'streaming') {
      $('pane-quiz').innerHTML = '<em>Generating…</em>';
    } else if (msg.status === 'complete') {
      const qs = msg.questions || [];
      $('pane-quiz').innerHTML = qs.length
        ? qs.map((q, i) => {
            const choices = (q.choices || []).map((c) =>
              `<label class="quiz-choice"><input type="radio" name="q${i}" value="${escapeHtml(c)}"> ${escapeHtml(c)}</label>`
            ).join('');
            return `
              <div class="quiz-q" data-i="${i}">
                <p class="quiz-prompt"><strong>${i + 1}.</strong> ${escapeHtml(q.prompt)}</p>
                ${q.type === 'multiple_choice' ? `<div class="quiz-choices">${choices}</div>` : `<textarea class="quiz-short" rows="2"></textarea>`}
                <button class="quiz-reveal btn secondary" data-i="${i}">Reveal answer</button>
                <div class="quiz-answer hidden">
                  <strong>Answer:</strong> ${escapeHtml(q.answer)}
                  ${q.rationale ? `<div class="quiz-rationale">${escapeHtml(q.rationale)}</div>` : ''}
                </div>
              </div>`;
          }).join('')
        : 'No questions returned.';
      document.querySelectorAll('#pane-quiz .quiz-reveal').forEach((btn) => {
        btn.addEventListener('click', () => {
          const wrap = btn.closest('.quiz-q');
          wrap.querySelector('.quiz-answer').classList.toggle('hidden');
        });
      });
    } else if (msg.status === 'error') {
      $('pane-quiz').textContent = `Error: ${msg.message}`;
    }
  };

  let podcastBuffer = '';
  renderers.podcast = (msg) => {
    if (msg.status === 'started') {
      podcastBuffer = '';
      $('pane-podcast').textContent = '';
    } else if (msg.status === 'streaming' && typeof msg.chunk === 'string') {
      podcastBuffer += msg.chunk;
      $('pane-podcast').textContent = podcastBuffer;
    } else if (msg.status === 'complete') {
      $('pane-podcast').textContent = msg.script || podcastBuffer;
      speakScript($('pane-podcast').textContent);
    } else if (msg.status === 'error') {
      $('pane-podcast').textContent = `Error: ${msg.message}`;
    }
  };

  renderers.video = (msg) => {
    if (msg.status === 'started' || msg.status === 'planning') {
      $('pane-video').innerHTML = '<em>Drafting Veo prompt…</em>';
    } else if (msg.status === 'prompt-ready') {
      $('pane-video').innerHTML = `<div class="video-prompt"><strong>Prompt:</strong> ${escapeHtml(msg.prompt)}</div><em>Generating video…</em>`;
    } else if (msg.status === 'generating') {
      const promptEl = $('pane-video').querySelector('.video-prompt');
      const promptHtml = promptEl ? promptEl.outerHTML : '';
      $('pane-video').innerHTML = `${promptHtml}<em>Veo: ${escapeHtml(msg.state || 'generating')}</em>`;
    } else if (msg.status === 'complete') {
      $('pane-video').innerHTML = `
        <div class="video-prompt"><strong>Prompt:</strong> ${escapeHtml(msg.prompt || '')}</div>
        <video controls autoplay class="forge-video-preview">
          <source src="${escapeHtml(msg.uri)}" type="${escapeHtml(msg.mimeType || 'video/mp4')}">
        </video>`;
    } else if (msg.status === 'error') {
      $('pane-video').textContent = `Error: ${msg.message}`;
    }
  };

  renderers.mastery_path = (msg) => {
    if (msg.status === 'started' || msg.status === 'planning') {
      $('pane-mastery').innerHTML = '<em>Planning your mastery path…</em>';
    } else if (msg.status === 'complete') {
      const steps = msg.steps || [];
      $('pane-mastery').innerHTML = `
        <h4>${escapeHtml(msg.title || 'Mastery path')}</h4>
        <p class="mastery-rationale">${escapeHtml(msg.rationale || '')}</p>
        <ol class="mastery-steps">
          ${steps.map((s, i) => `
            <li>
              <div class="mastery-step-head">
                <span class="mastery-step-action">${escapeHtml(s.action)}</span>
                <button class="btn secondary mastery-step-run" data-action="${escapeHtml(s.action)}">Run step ${i + 1}</button>
              </div>
              <p class="mastery-step-why">${escapeHtml(s.why)}</p>
            </li>`).join('')}
        </ol>`;
      document.querySelectorAll('#pane-mastery .mastery-step-run').forEach((btn) => {
        btn.addEventListener('click', () => requestRun(btn.dataset.action));
      });
    } else if (msg.status === 'error') {
      $('pane-mastery').textContent = `Error: ${msg.message}`;
    }
  };

  function renderMarkdownLite(text) {
    if (!text) return '';
    let out = escapeHtml(text);
    out = out.replace(/^## (.+)$/gm, '<h4>$1</h4>');
    out = out.replace(/^### (.+)$/gm, '<h5>$1</h5>');
    out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/^- (.+)$/gm, '<li>$1</li>');
    out = out.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m.replace(/\n/g, '')}</ul>`);
    out = out.replace(/\n\n+/g, '</p><p>');
    out = '<p>' + out + '</p>';
    out = out.replace(/<p>(<h\d>)/g, '$1').replace(/(<\/h\d>)<\/p>/g, '$1');
    out = out.replace(/<p>(<ul>)/g, '$1').replace(/(<\/ul>)<\/p>/g, '$1');
    return out;
  }

  // ---- Web Speech podcast playback ----
  function speakScript(text) {
    if (!text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    for (const s of sentences) {
      const utter = new SpeechSynthesisUtterance(s);
      utter.rate = 1.0;
      utter.pitch = 1.0;
      window.speechSynthesis.speak(utter);
    }
  }

  function initPodcastControls() {
    $('podcast-play').addEventListener('click', () => {
      speakScript($('pane-podcast').textContent);
    });
    $('podcast-stop').addEventListener('click', () => {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    });
  }

  // ---- Listen for action updates from the background ----
  // Orbital runs from the content script: only the content script gets ACTION_REQUEST's
  // sendResponse(jobId), so currentJobId would stay stale after a side-panel run and
  // we'd drop every update. Sync from broadcasts instead; adopt job if panel missed `started`.
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== 'ACTION_UPDATE') return;
    const jid = message.jobId;
    if (message.status === 'started') {
      currentJobId = jid;
    } else if (!currentJobId && jid && renderers[message.action]) {
      currentJobId = jid;
    } else if (currentJobId && jid !== currentJobId) {
      return;
    }
    const renderer = renderers[message.action];
    if (renderer) renderer(message);
    if (message.status === 'started') setStatus(`Running ${message.action}…`);
    if (message.status === 'complete') setStatus(`${message.action} complete.`);
    if (message.status === 'error') setStatus(`${message.action} failed.`);
    if (message.status === 'aborted') setStatus(`${message.action} cancelled.`);
  });

  // ---- Boot ----
  document.addEventListener('DOMContentLoaded', () => {
    try {
      initGazeControls();
      initTabs();
      initActions();
      initPodcastControls();
    } catch (e) {
      const el = $('output-status');
      if (el) el.textContent = `Panel init failed: ${e && e.message ? e.message : e}`;
    }
  });
})();
