// Veo video generation via local Hephaestus proxy → Gemini API.
// Endpoint reference: https://ai.google.dev/gemini-api/docs/video

'use strict';

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes

const videoCache = new Map(); // sha256(prompt) -> { uri, ts }
const VIDEO_CACHE_TTL_MS = 60 * 60 * 1000;

async function getServerBase() {
  return self.HephApiConfig.getServerBase();
}

async function getVeoModel() {
  return self.HephApiConfig.DEFAULT_VEO_MODEL;
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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

  const serverBase = await getServerBase();
  const model = await getVeoModel();

  if (onProgress) onProgress('submitting');

  const submitPath = `/gemini/v1beta/models/${encodeURIComponent(model)}:predictLongRunning`;
  const submitUrl = `${serverBase}${submitPath}`;

  const submitBody = {
    instances: [{ prompt }],
    parameters: {
      aspectRatio,
      durationSeconds: durationSec,
      personGeneration: 'allow_adult'
    }
  };

  let submitResp;
  try {
    submitResp = await fetch(submitUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(submitBody),
      signal
    });
  } catch (err) {
    const hint =
      'Cannot reach the Hephaestus proxy. Set the proxy URL in the side panel, then run: cd server && npm start (see server/.env.example).';
    throw new Error(`${hint} (${err && err.message ? err.message : err})`);
  }

  if (!submitResp.ok) {
    const errText = await submitResp.text().catch(() => '');
    throw new Error(`Veo submit failed ${submitResp.status}: ${errText.slice(0, 300)}`);
  }
  const submitData = await submitResp.json();
  const operationName = submitData.name;
  if (!operationName) {
    throw new Error('Veo submit returned no operation name.');
  }

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

    const op = String(operationName).replace(/^\//, '');
    const pollPath = `/gemini/v1beta/${op}`;
    const pollUrl = `${serverBase}${pollPath}`;

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

    const playbackUrl = `${serverBase}/gemini/proxy-video?target=${encodeURIComponent(uri)}`;

    const value = { uri: playbackUrl, model, mimeType };
    videoCache.set(cacheKey, { value, ts: Date.now() });
    if (onProgress) onProgress('done');
    return { ...value, cached: false };
  }
}

self.HephVeo = { generateVideo };
