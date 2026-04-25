// Podcast action — Claude scripts a 60–90s conversational explanation, the side
// panel speaks it via the Web Speech API. We stream the script so the panel can
// start playback as soon as the first sentence arrives.
'use strict';

const PODCAST_SYSTEM = `You are scripting a 60-90 second audio mini-lecture for a student listening on headphones.
Conversational tone, no headings, no bullet lists. Speak in continuous prose.
Open with a hook. Cover 3-4 core ideas with a vivid example for each. Close with one question for the listener.
Do not include stage directions, host names, or labels — output only the words to be spoken.`;

async function runPodcast({ pageContext, signal, broadcast }) {
  const text = (pageContext.textContent || '').slice(0, 12000);
  if (!text.trim()) {
    broadcast({ status: 'error', message: 'No readable text on this page.' });
    return;
  }
  broadcast({ status: 'streaming', chunk: '' });
  try {
    const result = await self.HephClaude.streamMessage({
      tier: 'fast',
      system: PODCAST_SYSTEM,
      messages: [{ role: 'user', content: `Title: ${pageContext.title || ''}\n\nPAGE TEXT:\n${text}` }],
      maxTokens: 1100,
      signal,
      onText: (chunk) => broadcast({ status: 'streaming', chunk })
    });
    broadcast({ status: 'complete', script: result.text, model: result.model });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      broadcast({ status: 'aborted' });
    } else {
      broadcast({ status: 'error', message: err && err.message ? err.message : String(err) });
    }
  }
}

self.HephActions = self.HephActions || {};
self.HephActions.podcast = runPodcast;
