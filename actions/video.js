// Video action — Claude crafts a Veo prompt from the page concept, then
// lib/veo-client.js does the long-running generation.
'use strict';

const VEO_PROMPT_TOOL = {
  name: 'emit_veo_prompt',
  description: 'Return a single Veo prompt that will visualize the central concept of the page in a short explanatory clip.',
  input_schema: {
    type: 'object',
    required: ['prompt', 'aspect_ratio'],
    properties: {
      prompt: {
        type: 'string',
        description: 'Cinematic, concrete, ≤ 80 words. Describe scene, motion, and visual style. Avoid text-on-screen requests.'
      },
      aspect_ratio: { type: 'string', enum: ['16:9', '9:16'] },
      duration_sec: { type: 'integer', minimum: 4, maximum: 8 }
    }
  }
};

const VEO_PROMPT_SYSTEM = `You translate a study topic into a single Veo video prompt that will help a learner visualize the concept.
Pick the single most teachable visual. Keep it concrete and observable; no abstract metaphors.
Always call emit_veo_prompt exactly once.`;

async function runVideo({ pageContext, signal, broadcast }) {
  const text = (pageContext.textContent || '').slice(0, 6000);
  if (!text.trim()) {
    broadcast({ status: 'error', message: 'No readable text on this page.' });
    return;
  }

  broadcast({ status: 'planning' });

  let veoPrompt;
  let aspectRatio = '16:9';
  let durationSec = 6;
  try {
    const { input } = await self.HephClaude.runTool({
      tier: 'fast',
      system: VEO_PROMPT_SYSTEM,
      messages: [{ role: 'user', content: `Title: ${pageContext.title || ''}\n\nPAGE TEXT:\n${text}` }],
      tool: VEO_PROMPT_TOOL,
      maxTokens: 600,
      signal
    });
    veoPrompt = input.prompt;
    if (input.aspect_ratio) aspectRatio = input.aspect_ratio;
    if (input.duration_sec) durationSec = input.duration_sec;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      broadcast({ status: 'aborted' });
      return;
    }
    broadcast({ status: 'error', message: `Prompt drafting failed: ${err.message || err}` });
    return;
  }

  broadcast({ status: 'prompt-ready', prompt: veoPrompt });

  try {
    const result = await self.HephVeo.generateVideo({
      prompt: veoPrompt,
      aspectRatio,
      durationSec,
      signal,
      onProgress: (state) => broadcast({ status: 'generating', state })
    });
    broadcast({ status: 'complete', uri: result.uri, mimeType: result.mimeType, prompt: veoPrompt, cached: result.cached });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      broadcast({ status: 'aborted' });
    } else {
      broadcast({ status: 'error', message: err && err.message ? err.message : String(err) });
    }
  }
}

self.HephActions = self.HephActions || {};
self.HephActions.video = runVideo;
