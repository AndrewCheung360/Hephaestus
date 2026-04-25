// Claude API client for the Hephaestus background service worker.
// Streams responses via SSE; supports tool-use; AbortController-friendly.
// Reads anthropicApiKey + model preferences from chrome.storage.local.

'use strict';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const DEFAULT_FAST_MODEL = 'claude-sonnet-4-6';
const DEFAULT_DEEP_MODEL = 'claude-opus-4-7';

async function getApiKey() {
  const { anthropicApiKey } = await chrome.storage.local.get('anthropicApiKey');
  if (!anthropicApiKey) {
    throw new Error('Anthropic API key not configured. Open the Hephaestus side panel and add one.');
  }
  return anthropicApiKey;
}

async function getModel(tier = 'fast') {
  const { hephaestusModels } = await chrome.storage.local.get('hephaestusModels');
  const fast = (hephaestusModels && hephaestusModels.fast) || DEFAULT_FAST_MODEL;
  const deep = (hephaestusModels && hephaestusModels.deep) || DEFAULT_DEEP_MODEL;
  return tier === 'deep' ? deep : fast;
}

// Lightweight SSE parser — splits a string on blank lines, then for each
// `event:` / `data:` block yields { event, data }.
function parseSSE(buffer) {
  const events = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  // The last block may be incomplete; caller passes it back as the new buffer.
  const remainder = blocks.pop();
  for (const block of blocks) {
    if (!block.trim()) continue;
    let event = 'message';
    const dataLines = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) continue;
    const dataStr = dataLines.join('\n');
    try {
      events.push({ event, data: JSON.parse(dataStr) });
    } catch (_) {
      // ignore malformed events
    }
  }
  return { events, remainder };
}

// streamMessage({ tier, system, messages, tools, maxTokens, signal, onText, onToolUse })
// Returns a promise that resolves with { text, toolUses, stopReason } when the
// stream finishes. onText(chunk) fires for every text delta; onToolUse({ name, input })
// fires once per completed tool call.
async function streamMessage({
  tier = 'fast',
  model,
  system,
  messages,
  tools,
  maxTokens = 2048,
  signal,
  onText,
  onToolUse
} = {}) {
  const apiKey = await getApiKey();
  const resolvedModel = model || (await getModel(tier));

  const body = {
    model: resolvedModel,
    max_tokens: maxTokens,
    stream: true,
    messages
  };
  if (system) body.system = system;
  if (tools && tools.length) body.tools = tools;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Claude API error ${response.status}: ${errText.slice(0, 300)}`);
  }
  if (!response.body) {
    throw new Error('Claude API returned no stream body.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  let text = '';
  let stopReason = null;

  // content blocks indexed by their `index` field; each block accumulates either
  // text (for text blocks) or a JSON-stringified input (for tool_use blocks).
  const blocks = new Map();
  const toolUses = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, remainder } = parseSSE(buffer);
    buffer = remainder;

    for (const { event, data } of events) {
      if (event === 'content_block_start') {
        const { index, content_block } = data;
        blocks.set(index, { type: content_block.type, ...content_block, _input: '' });
      } else if (event === 'content_block_delta') {
        const { index, delta } = data;
        const block = blocks.get(index);
        if (!block) continue;
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          block.text = (block.text || '') + delta.text;
          text += delta.text;
          if (onText) {
            try { onText(delta.text); } catch (_) {}
          }
        } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          block._input += delta.partial_json;
        }
      } else if (event === 'content_block_stop') {
        const { index } = data;
        const block = blocks.get(index);
        if (block && block.type === 'tool_use') {
          let input = {};
          if (block._input) {
            try { input = JSON.parse(block._input); } catch (_) { input = {}; }
          }
          const tu = { name: block.name, input, id: block.id };
          toolUses.push(tu);
          if (onToolUse) {
            try { onToolUse(tu); } catch (_) {}
          }
        }
      } else if (event === 'message_delta') {
        if (data && data.delta && data.delta.stop_reason) {
          stopReason = data.delta.stop_reason;
        }
      } else if (event === 'message_stop') {
        // end of stream
      } else if (event === 'error') {
        const message = (data && data.error && data.error.message) || 'Stream error';
        throw new Error(`Claude stream error: ${message}`);
      }
    }
  }

  return { text, toolUses, stopReason, model: resolvedModel };
}

// Convenience: one-shot tool call. Returns the parsed input from the first
// matching tool_use block.
async function runTool({ tier, system, messages, tool, signal, maxTokens }) {
  const result = await streamMessage({
    tier,
    system,
    messages,
    tools: [tool],
    maxTokens: maxTokens || 2048,
    signal
  });
  const match = result.toolUses.find((t) => t.name === tool.name);
  if (!match) {
    throw new Error(`Claude did not call expected tool '${tool.name}'.`);
  }
  return { input: match.input, raw: result };
}

self.HephClaude = { streamMessage, runTool, getModel, getApiKey };
