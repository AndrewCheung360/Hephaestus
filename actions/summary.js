// Summary action — Socratic brief of the page content, streamed to the side panel.
'use strict';

const SUMMARY_SYSTEM = `You are Hephaestus, a Socratic study tutor for students with motor disabilities.
Given the page text below, produce a tight study brief in markdown with two sections:

## Key points
- 4 to 6 bullets capturing the essential ideas. Each ≤ 18 words.

## Socratic prompts
- 3 to 5 questions, in increasing depth, that prompt active recall and critical thinking. Each ≤ 18 words.

Do not preamble. Do not invent facts beyond the source text. Use plain language.`;

async function runSummary({ pageContext, signal, broadcast }) {
  const text = (pageContext.textContent || '').slice(0, 12000);
  if (!text.trim()) {
    broadcast({ status: 'error', message: 'No readable text on this page.' });
    return;
  }
  const userMsg = `Title: ${pageContext.title || '(untitled)'}\nURL: ${pageContext.url || ''}\n\nPAGE TEXT:\n${text}`;

  broadcast({ status: 'streaming', chunk: '' });

  try {
    const result = await self.HephClaude.streamMessage({
      tier: 'fast',
      system: SUMMARY_SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
      maxTokens: 900,
      signal,
      onText: (chunk) => broadcast({ status: 'streaming', chunk })
    });
    broadcast({ status: 'complete', text: result.text, model: result.model });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      broadcast({ status: 'aborted' });
    } else {
      broadcast({ status: 'error', message: err && err.message ? err.message : String(err) });
    }
  }
}

self.HephActions = self.HephActions || {};
self.HephActions.summary = runSummary;
