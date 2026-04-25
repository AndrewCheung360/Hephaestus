// Claude API via local Hephaestus proxy (see server/). Streams SSE; tool use; AbortSignal.

'use strict';

const ANTHROPIC_VERSION = '2023-06-01';

async function getServerBase() {
  return self.HephApiConfig.getServerBase();
}

async function getModel() {
  return self.HephApiConfig.CLAUDE_MODEL;
}

function parseSSE(buffer) {
  const events = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
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
    } catch (_) {}
  }
  return { events, remainder };
}

async function streamMessage({
  tier: _tier,
  model,
  system,
  messages,
  tools,
  maxTokens = 2048,
  signal,
  onText,
  onToolUse
} = {}) {
  const serverBase = await getServerBase();
  const url = `${serverBase}/anthropic/v1/messages`;
  const resolvedModel = model || (await getModel());

  const body = {
    model: resolvedModel,
    max_tokens: maxTokens,
    stream: true,
    messages
  };
  if (system) body.system = system;
  if (tools && tools.length) body.tools = tools;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify(body),
      signal
    });
  } catch (err) {
    const hint =
      'Cannot reach the Hephaestus proxy. Set the proxy URL below, then run: cd server && npm install && npm start (see server/.env.example).';
    throw new Error(`${hint} (${err && err.message ? err.message : err})`);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Claude proxy error ${response.status}: ${errText.slice(0, 300)}`);
  }
  if (!response.body) {
    throw new Error('Claude proxy returned no stream body.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  let text = '';
  let stopReason = null;

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
            try {
              onText(delta.text);
            } catch (_) {}
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
            try {
              input = JSON.parse(block._input);
            } catch (_) {
              input = {};
            }
          }
          const tu = { name: block.name, input, id: block.id };
          toolUses.push(tu);
          if (onToolUse) {
            try {
              onToolUse(tu);
            } catch (_) {}
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

self.HephClaude = { streamMessage, runTool, getModel };
