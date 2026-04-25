// Flashcards action — generates a structured flashcard set via Claude tool use.
'use strict';

const FLASHCARD_TOOL = {
  name: 'emit_flashcards',
  description: 'Return a set of active-recall flashcards generated from the page.',
  input_schema: {
    type: 'object',
    required: ['cards'],
    properties: {
      cards: {
        type: 'array',
        minItems: 6,
        maxItems: 12,
        items: {
          type: 'object',
          required: ['front', 'back'],
          properties: {
            front: { type: 'string', description: 'A single concise question or term prompt.' },
            back: { type: 'string', description: 'The answer / definition. ≤ 50 words.' },
            difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] }
          }
        }
      }
    }
  }
};

const FLASHCARD_SYSTEM = `You generate active-recall flashcards from study material.
Cover the most important terms and concepts. Mix definition, application, and synthesis prompts.
Avoid trivia. Always call the emit_flashcards tool exactly once.`;

async function runFlashcards({ pageContext, signal, broadcast }) {
  const text = (pageContext.textContent || '').slice(0, 12000);
  if (!text.trim()) {
    broadcast({ status: 'error', message: 'No readable text on this page.' });
    return;
  }
  broadcast({ status: 'streaming' });
  try {
    const { input } = await self.HephClaude.runTool({
      tier: 'fast',
      system: FLASHCARD_SYSTEM,
      messages: [{ role: 'user', content: `Title: ${pageContext.title || ''}\n\nPAGE TEXT:\n${text}` }],
      tool: FLASHCARD_TOOL,
      maxTokens: 1500,
      signal
    });
    broadcast({ status: 'complete', cards: input.cards || [] });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      broadcast({ status: 'aborted' });
    } else {
      broadcast({ status: 'error', message: err && err.message ? err.message : String(err) });
    }
  }
}

self.HephActions = self.HephActions || {};
self.HephActions.flashcards = runFlashcards;
