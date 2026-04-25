// Shared API defaults for the Hephaestus background worker.
// All LLM / Veo traffic goes through the local proxy; keys live in server/.env only.

'use strict';

const DEFAULT_SERVER_BASE = 'http://127.0.0.1:8787';

/** Single Claude model for every tier (fast / deep). */
const CLAUDE_MODEL = 'claude-haiku-4-5';

/** Reserved for future Gemini text / generateContent use (not Veo). */
const DEFAULT_GEMINI_TEXT_MODEL = 'gemini-3-flash-preview';

/** Veo long-running video model id. */
const DEFAULT_VEO_MODEL = 'veo-3.0-generate-preview';

async function getServerBase() {
  const { hephaestusServerUrl } = await chrome.storage.local.get('hephaestusServerUrl');
  const raw = (hephaestusServerUrl && String(hephaestusServerUrl).trim()) || DEFAULT_SERVER_BASE;
  return raw.replace(/\/+$/, '');
}

self.HephApiConfig = {
  DEFAULT_SERVER_BASE,
  getServerBase,
  CLAUDE_MODEL,
  DEFAULT_GEMINI_TEXT_MODEL,
  DEFAULT_VEO_MODEL
};
