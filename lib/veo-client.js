// Veo video generation via the Gemini API.
// Endpoint reference: https://ai.google.dev/gemini-api/docs/video
//   POST  v1beta/models/{model}:predictLongRunning   → returns operation { name }
//   GET   v1beta/{operation.name}                    → poll until done; result has video URI
// Reads geminiApiKey + veoModel from chrome.storage.local. Caches results by
// SHA-256 of the prompt to avoid re-billing during demo retries.

'use strict';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_VEO_MODEL = 'veo-3.0-generate-preview';
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes

const videoCache = new Map(); // sha256(prompt) -> { uri, ts }
const VIDEO_CACHE_TTL_MS = 60 * 60 * 1000;

async function getGeminiKey() {
  const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
  if (!geminiApiKey) {
    throw new Error('Gemini API key not configured. Open the Hephaestus side panel and add one.');
  }
  return geminiApiKey;
}

async function getVeoModel() {
  const { veoModel } = await chrome.storage.local.get('veoModel');
  return veoModel || DEFAULT_VEO_MODEL;
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(id);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

// Returns { uri, model, cached, mimeType }.
// onProgress(state) receives status strings as polling proceeds.
async function generateVideo({
  prompt,
  aspectRatio = '16:9',
  durationSec = 8,
  signal,
  onProgress
} = {}) {
  if (!prompt || !prompt.trim()) {
    throw new Error('Veo prompt is empty.');
  }

  const cacheKey = await sha256(`${prompt}|${aspectRatio}|${durationSec}`);
  const cached = videoCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < VIDEO_CACHE_TTL_MS) {
    if (onProgress) onProgress('cached');
    return { ...cached.value, cached: true };
  }

  const apiKey = await getGeminiKey();
  const model = await getVeoModel();

  if (onProgress) onProgress('submitting');

  const submitUrl = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:predictLongRunning?key=${encodeURIComponent(apiKey)}`;
  const submitBody = {
    instances: [{ prompt }],
    parameters: {
      aspectRatio,
      durationSeconds: durationSec,
      personGeneration: 'allow_adult'
    }
  };

  const submitResp = await fetch(submitUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(submitBody),
    signal
  });

  if (!submitResp.ok) {
    const errText = await submitResp.text().catch(() => '');
    throw new Error(`Veo submit failed ${submitResp.status}: ${errText.slice(0, 300)}`);
  }
  const submitData = await submitResp.json();
  const operationName = submitData.name;
  if (!operationName) {
    throw new Error('Veo submit returned no operation name.');
  }

  // Poll
  const startedAt = Date.now();
  while (true) {
    if (signal && signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      throw new Error('Veo generation timed out.');
    }

    if (onProgress) {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      onProgress(`generating (${elapsed}s)`);
    }

    await sleep(POLL_INTERVAL_MS, signal);

    const pollUrl = `${GEMINI_BASE}/${operationName}?key=${encodeURIComponent(apiKey)}`;
    const pollResp = await fetch(pollUrl, { signal });
    if (!pollResp.ok) {
      const errText = await pollResp.text().catch(() => '');
      throw new Error(`Veo poll failed ${pollResp.status}: ${errText.slice(0, 300)}`);
    }
    const pollData = await pollResp.json();

    if (pollData.error) {
      throw new Error(`Veo error: ${pollData.error.message || JSON.stringify(pollData.error)}`);
    }
    if (!pollData.done) continue;

    // Try the documented response shapes for Veo.
    const response = pollData.response || {};
    const video =
      (response.generateVideoResponse &&
        response.generateVideoResponse.generatedSamples &&
        response.generateVideoResponse.generatedSamples[0] &&
        response.generateVideoResponse.generatedSamples[0].video) ||
      (response.predictions && response.predictions[0]) ||
      null;

    let uri = null;
    let mimeType = 'video/mp4';
    if (video) {
      uri = video.uri || video.videoUri || video.url || null;
      if (video.mimeType) mimeType = video.mimeType;
    }
    if (!uri) {
      throw new Error('Veo finished but returned no video URI.');
    }

    // The Gemini-hosted video URL needs the API key appended for download.
    const downloadUrl = uri.includes('?') ? `${uri}&key=${encodeURIComponent(apiKey)}` : `${uri}?key=${encodeURIComponent(apiKey)}`;

    const value = { uri: downloadUrl, model, mimeType };
    videoCache.set(cacheKey, { value, ts: Date.now() });
    if (onProgress) onProgress('done');
    return { ...value, cached: false };
  }
}

self.HephVeo = { generateVideo };
