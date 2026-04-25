// Hephaestus background service worker.
// Imports the Claude + Veo clients and the action handlers, then exposes a
// single ACTION_REQUEST router that the orbital menu (via content.js) and the
// side panel both call into. Streaming output is broadcast as ACTION_UPDATE
// messages tagged with the originating jobId.

'use strict';

importScripts(
  'lib/claude-client.js',
  'lib/veo-client.js',
  'actions/summary.js',
  'actions/flashcards.js',
  'actions/quiz.js',
  'actions/podcast.js',
  'actions/video.js',
  'actions/mastery-path.js'
);

const VALID_ACTIONS = new Set(['summary', 'flashcards', 'quiz', 'podcast', 'video', 'mastery_path']);
const activeJobs = new Map(); // jobId -> { controller, action, startedAt }
let jobCounter = 0;

function newJobId(action) {
  jobCounter += 1;
  return `job-${action}-${Date.now()}-${jobCounter}`;
}

function broadcast(jobId, action, payload) {
  const msg = { type: 'ACTION_UPDATE', jobId, action, ...payload };
  // Side panel listens on the runtime channel.
  chrome.runtime.sendMessage(msg).catch(() => {});
  // Best-effort: fan out to the originating tab so content.js / orbital UI can react.
  if (payload && payload.tabId) {
    try { chrome.tabs.sendMessage(payload.tabId, msg).catch(() => {}); } catch (_) {}
  }
}

function startJob({ action, pageContext, tabId, sourceJobId }) {
  if (!VALID_ACTIONS.has(action)) {
    return { error: `Unknown action: ${action}` };
  }
  const handler = self.HephActions[action];
  if (!handler) {
    return { error: `Handler not registered: ${action}` };
  }

  const jobId = sourceJobId || newJobId(action);
  const controller = new AbortController();
  activeJobs.set(jobId, { controller, action, startedAt: Date.now(), tabId });

  const send = (payload) => broadcast(jobId, action, { ...payload, tabId });
  send({ status: 'started', startedAt: Date.now() });

  Promise.resolve()
    .then(() => handler({ pageContext, signal: controller.signal, broadcast: send }))
    .catch((err) => {
      send({ status: 'error', message: err && err.message ? err.message : String(err) });
    })
    .finally(() => {
      activeJobs.delete(jobId);
    });

  return { jobId };
}

function abortJob(jobId, reason) {
  const job = activeJobs.get(jobId);
  if (!job) return false;
  try { job.controller.abort(reason || 'cancelled'); } catch (_) {}
  activeJobs.delete(jobId);
  return true;
}

function abortAll(reason) {
  let count = 0;
  for (const [jobId] of activeJobs) {
    if (abortJob(jobId, reason)) count += 1;
  }
  return count;
}

async function probeKeys() {
  const status = { anthropic: 'missing', gemini: 'missing' };
  const { anthropicApiKey, geminiApiKey } = await chrome.storage.local.get(['anthropicApiKey', 'geminiApiKey']);
  if (anthropicApiKey) status.anthropic = 'set';
  if (geminiApiKey) status.gemini = 'set';
  return status;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) return;
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  if (message.type === 'ACTION_REQUEST') {
    const tabId = message.tabId || (sender && sender.tab && sender.tab.id);
    const result = startJob({
      action: message.action,
      pageContext: message.pageContext || {},
      tabId,
      sourceJobId: message.jobId
    });
    sendResponse(result);
    return true;
  }

  if (message.type === 'ABORT_ACTION') {
    const ok = message.jobId ? abortJob(message.jobId, message.reason) : (abortAll(message.reason || 'cancelled') > 0);
    sendResponse({ aborted: ok });
    return true;
  }

  if (message.type === 'GET_KEY_STATUS') {
    probeKeys().then(sendResponse);
    return true;
  }

  if (message.type === 'REQUEST_PAGE_CONTEXT') {
    // Side panel asks the active tab for fresh Readability extract.
    const targetTabId = message.tabId;
    if (!targetTabId) {
      sendResponse({ error: 'No tabId provided' });
      return true;
    }
    chrome.tabs.sendMessage(targetTabId, { type: 'GET_PAGE_CONTEXT' })
      .then((ctx) => sendResponse({ pageContext: ctx }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  return false;
});
