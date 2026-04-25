# Hephaestus

Hands-Free Learning Forge — a Chrome extension that lets students with motor disabilities study with no mouse or keyboard. Head tracking moves the cursor; double-mouth-open opens an **Orbital Command Menu** at the user's gaze. Selecting an icon runs a Claude-powered learning action on the current page (Summary, Flashcards, Quiz, Podcast, Veo Video, Mastery Path).

Built on the Hephaestus gaze layer. All biometrics stay on-device; only page text and model prompts hit the network via a **local Node proxy** (API keys never live in the extension).

## Install

1. **Start the local proxy** (from this repo root):

   ```bash
   cp server/.env.example server/.env
   ```

   Edit `server/.env` and set `ANTHROPIC_API_KEY` and `GEMINI_API_KEY`. Then start the proxy from the repo root using any of these:

   - **`npm run server`** — installs `server/` dependencies if needed, then starts the proxy
   - **`./start-server.sh`** — same idea via shell
   - **`cd server && npm install && npm start`** — manual

   Default listen address: `http://127.0.0.1:8787`.

   **Port already in use (`EADDRINUSE`):** another process (often a previous `npm run server`) is bound to 8787. Find and stop it, for example:

   ```bash
   lsof -nP -iTCP:8787
   kill <pid>
   ```

   Or pick another port: set `PORT=8790` in `server/.env`, restart the server, then in the extension side panel set **Server base URL** to `http://127.0.0.1:8790` and click **Save URL**.

2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, select this folder (the extension root, not `server/`).
3. Click the Hephaestus action icon to open the side panel. Confirm **Server: OK** (or set **Server base URL** if you changed the port, then **Save URL**).
4. Toggle **Enable** on Head Tracking and grant the camera permission.
5. Press **Alt+H** to calibrate head position (5 points). Press **Alt+M** to calibrate mouth-open.

## Use

| Gesture | Action |
|---|---|
| Move head | Move cursor |
| Hover a link until the ring fills | Dwell-click |
| Single mouth-open | Click the snapped element |
| **Double mouth-open** (≤ 0.4s) | Open the **Orbital Command Menu** at your gaze |
| Look at a menu icon | Focus it (highlights orange) |
| Mouth-open while focused | Confirm — runs that action on the current page |
| Esc | Close menu / cancel running action |

The side panel shows streamed output for whichever action you ran. The Mastery Path planner produces a 3–4 step pipeline you can advance one step at a time.

## Layout

```
manifest.json                   MV3 config
background.js                   service worker; ACTION_REQUEST router
content.js                      Readability extract + orbital→background bridge
sidepanel.{html,js,css}         settings + tabbed action output

server/
  index.mjs                     localhost proxy (Anthropic + Gemini/Veo)
  .env.example                  copy to .env; keys for the proxy only

gaze/
  gaze-core.js                  Human.js head/mouth/blink signals
  gaze-dwell.js                 dwell-to-click + edge auto-scroll
  gaze-overlay.js               pointer + camera preview
  head-cal.js, mouth-cal.js     calibration UIs
  orbital-detector.js           double-mouth → gesture:orbital-open
  human/                        Human.js model files

orbital/
  orbital-menu.{js,css}         radial command UI

actions/
  summary.js                    Socratic brief (streaming)
  flashcards.js                 tool-use; flashcard set
  quiz.js                       tool-use; mixed quiz
  podcast.js                    Claude script → Web Speech playback
  video.js                      Claude → Veo prompt → Veo video
  mastery-path.js               Claude plans an ordered pipeline

lib/
  api-config.js                 default server URL + model id constants
  claude-client.js              local proxy → Anthropic SSE + tool runner
  veo-client.js                 local proxy → Gemini Veo long-running client
  Readability.js                Mozilla content extraction
```

## Models

- Claude (all actions): `claude-haiku-4-5` (hardcoded in the extension; requests go through the proxy).
- Veo: `veo-3.0-generate-preview` via the Gemini API (through the proxy).
- Reserved constant for future Gemini text use: `gemini-3-flash-preview` (see `lib/api-config.js`).
