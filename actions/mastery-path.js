// Mastery Path — Claude (deep tier) plans a 3–4 step study pipeline for the
// page, then the side panel walks the user through each step using the same
// page context.
'use strict';

const MASTERY_TOOL = {
  name: 'emit_mastery_path',
  description: 'Return a short ordered study plan tailored to the page.',
  input_schema: {
    type: 'object',
    required: ['title', 'rationale', 'steps'],
    properties: {
      title: { type: 'string', description: 'Short title for the path, ≤ 8 words.' },
      rationale: { type: 'string', description: 'One sentence on why this order suits the material.' },
      steps: {
        type: 'array',
        minItems: 3,
        maxItems: 4,
        items: {
          type: 'object',
          required: ['action', 'why'],
          properties: {
            action: {
              type: 'string',
              enum: ['summary', 'flashcards', 'quiz', 'podcast', 'video'],
              description: 'Which Hephaestus action to run for this step.'
            },
            why: { type: 'string', description: 'One sentence explaining what the learner gains from this step.' }
          }
        }
      }
    }
  }
};

const MASTERY_SYSTEM = `You design short adaptive study paths for one page of learning material.
Pick the best ordered subset of these actions: summary, flashcards, quiz, podcast, video.
Match the order to the material — e.g. dense theory benefits from summary → video → quiz; vocabulary-heavy → flashcards → quiz.
Always call emit_mastery_path exactly once. 3 or 4 steps total.`;

async function runMasteryPath({ pageContext, signal, broadcast }) {
  const text = (pageContext.textContent || '').slice(0, 12000);
  if (!text.trim()) {
    broadcast({ status: 'error', message: 'No readable text on this page.' });
    return;
  }
  broadcast({ status: 'planning' });
  try {
    const { input } = await self.HephClaude.runTool({
      tier: 'deep',
      system: MASTERY_SYSTEM,
      messages: [{ role: 'user', content: `Title: ${pageContext.title || ''}\n\nPAGE TEXT:\n${text}` }],
      tool: MASTERY_TOOL,
      maxTokens: 800,
      signal
    });
    broadcast({
      status: 'complete',
      title: input.title,
      rationale: input.rationale,
      steps: input.steps || []
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      broadcast({ status: 'aborted' });
    } else {
      broadcast({ status: 'error', message: err && err.message ? err.message : String(err) });
    }
  }
}

self.HephActions = self.HephActions || {};
self.HephActions.mastery_path = runMasteryPath;
