// Quiz action — generates a mixed quiz with answer key via Claude tool use.
'use strict';

const QUIZ_TOOL = {
  name: 'emit_quiz',
  description: 'Return a check-for-understanding quiz based on the page.',
  input_schema: {
    type: 'object',
    required: ['questions'],
    properties: {
      questions: {
        type: 'array',
        minItems: 4,
        maxItems: 8,
        items: {
          type: 'object',
          required: ['type', 'prompt', 'answer'],
          properties: {
            type: { type: 'string', enum: ['multiple_choice', 'short_answer'] },
            prompt: { type: 'string' },
            choices: {
              type: 'array',
              items: { type: 'string' },
              description: 'Required when type is multiple_choice. Length 3 or 4.'
            },
            answer: {
              type: 'string',
              description: 'For multiple_choice, the exact text of the correct choice. For short_answer, an ideal response (≤ 40 words).'
            },
            rationale: { type: 'string', description: 'One-sentence explanation of why the answer is correct.' }
          }
        }
      }
    }
  }
};

const QUIZ_SYSTEM = `You design active-recall quizzes from study material.
Mix multiple_choice and short_answer items. Distractors should be plausible.
Each question must be answerable from the page text alone. Call emit_quiz exactly once.`;

async function runQuiz({ pageContext, signal, broadcast }) {
  const text = (pageContext.textContent || '').slice(0, 12000);
  if (!text.trim()) {
    broadcast({ status: 'error', message: 'No readable text on this page.' });
    return;
  }
  broadcast({ status: 'streaming' });
  try {
    const { input } = await self.HephClaude.runTool({
      tier: 'fast',
      system: QUIZ_SYSTEM,
      messages: [{ role: 'user', content: `Title: ${pageContext.title || ''}\n\nPAGE TEXT:\n${text}` }],
      tool: QUIZ_TOOL,
      maxTokens: 1800,
      signal
    });
    broadcast({ status: 'complete', questions: input.questions || [] });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      broadcast({ status: 'aborted' });
    } else {
      broadcast({ status: 'error', message: err && err.message ? err.message : String(err) });
    }
  }
}

self.HephActions = self.HephActions || {};
self.HephActions.quiz = runQuiz;
