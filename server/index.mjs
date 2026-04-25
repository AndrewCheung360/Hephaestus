import 'dotenv/config';
import express from 'express';
import { Readable } from 'stream';

const PORT = Number(process.env.PORT) || 8787;
const PROXY_SECRET = process.env.HEPHAESTUS_PROXY_SECRET;

const app = express();

function cors(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, anthropic-version, x-hephaestus-secret');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

function checkSecret(req, res, next) {
  if (!PROXY_SECRET) return next();
  if (req.get('x-hephaestus-secret') !== PROXY_SECRET) {
    return res.status(401).json({ error: 'invalid or missing x-hephaestus-secret' });
  }
  next();
}

app.use(cors);

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

const DIAGNOSTIC_ANTHROPIC_MODEL = process.env.ANTHROPIC_DIAGNOSTIC_MODEL || 'claude-haiku-4-5';

async function probeAnthropicKey(apiKey) {
  const trimmed = apiKey && String(apiKey).trim();
  if (!trimmed) {
    return { configured: false };
  }
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': trimmed,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: DIAGNOSTIC_ANTHROPIC_MODEL,
        max_tokens: 1,
        stream: false,
        messages: [{ role: 'user', content: 'ping' }]
      })
    });
    if (upstream.ok) {
      return { configured: true, ok: true, status: upstream.status };
    }
    const text = await upstream.text().catch(() => '');
    return {
      configured: true,
      ok: false,
      status: upstream.status,
      message: text.slice(0, 240)
    };
  } catch (err) {
    return { configured: true, ok: false, message: String(err && err.message ? err.message : err) };
  }
}

async function probeGeminiKey(apiKey) {
  const trimmed = apiKey && String(apiKey).trim();
  if (!trimmed) {
    return { configured: false };
  }
  try {
    const u = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    u.searchParams.set('pageSize', '1');
    u.searchParams.set('key', trimmed);
    const upstream = await fetch(u.toString(), { method: 'GET' });
    if (upstream.ok) {
      return { configured: true, ok: true, status: upstream.status };
    }
    const text = await upstream.text().catch(() => '');
    return {
      configured: true,
      ok: false,
      status: upstream.status,
      message: text.slice(0, 240)
    };
  } catch (err) {
    return { configured: true, ok: false, message: String(err && err.message ? err.message : err) };
  }
}

app.get('/diagnostics', checkSecret, async (req, res) => {
  try {
    const anthropic = await probeAnthropicKey(process.env.ANTHROPIC_API_KEY);
    const gemini = await probeGeminiKey(process.env.GEMINI_API_KEY);
    res.json({ ok: true, anthropic, gemini });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
});

app.post(
  '/anthropic/v1/messages',
  checkSecret,
  express.json({ limit: '32mb' }),
  async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on server' });
    }
    try {
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': req.get('anthropic-version') || '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(req.body)
      });

      res.status(upstream.status);
      const ct = upstream.headers.get('content-type');
      if (ct) res.setHeader('Content-Type', ct);

      if (!upstream.body) {
        const text = await upstream.text();
        return res.send(text);
      }

      const nodeReadable = Readable.fromWeb(upstream.body);
      nodeReadable.on('error', () => {
        try {
          res.end();
        } catch (_) {}
      });
      nodeReadable.pipe(res);
    } catch (err) {
      if (!res.headersSent) res.status(502).json({ error: String(err && err.message ? err.message : err) });
    }
  }
);

function allowedGeminiHost(hostname) {
  return (
    hostname === 'generativelanguage.googleapis.com' ||
    hostname === 'storage.googleapis.com' ||
    hostname.endsWith('.googleapis.com')
  );
}

const geminiRouter = express.Router();

geminiRouter.get('/proxy-video', async (req, res) => {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return res.status(500).send('GEMINI_API_KEY not set on server');
  }
  const target = req.query.target;
  if (!target || typeof target !== 'string') {
    return res.status(400).send('missing target query param');
  }
  let u;
  try {
    u = new URL(target);
  } catch {
    try {
      u = new URL(target, 'https://generativelanguage.googleapis.com/');
    } catch {
      return res.status(400).send('invalid target URL');
    }
  }
  if (!allowedGeminiHost(u.hostname)) {
    return res.status(403).send('target host not allowed');
  }
  u.searchParams.delete('key');
  u.searchParams.set('key', geminiKey);
  try {
    const upstream = await fetch(u.toString(), { method: 'GET' });
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    if (!upstream.body) {
      const t = await upstream.text().catch(() => '');
      return res.send(t);
    }
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(502).send(String(err && err.message ? err.message : err));
  }
});

geminiRouter.use(express.json({ limit: '64mb' }));

geminiRouter.use(async (req, res) => {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not set on server' });
  }
  try {
    const u = new URL(`https://generativelanguage.googleapis.com${req.url}`);
    u.searchParams.delete('key');
    u.searchParams.set('key', geminiKey);

    const init = {
      method: req.method,
      headers: {}
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(req.body ?? {});
    }

    const upstream = await fetch(u.toString(), init);
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    if (!upstream.body) {
      const t = await upstream.text().catch(() => '');
      return res.send(t);
    }
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: String(err && err.message ? err.message : err) });
  }
});

app.use('/gemini', checkSecret, geminiRouter);

const httpServer = app.listen(PORT, '127.0.0.1', () => {
  console.error(`Hephaestus proxy listening on http://127.0.0.1:${PORT}`);
});

httpServer.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use (EADDRINUSE). Stop the other process, e.g.:\n` +
        `  lsof -nP -iTCP:${PORT}\n` +
        `  kill <pid>\n` +
        `Or set PORT=8790 in server/.env and use the same URL in the extension side panel (Save URL).`
    );
    process.exit(1);
  }
  throw err;
});
