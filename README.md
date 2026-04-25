# Hephaestus

Hands-Free Learning Forge — a Chrome extension that lets students with motor disabilities study with no mouse or keyboard. Head tracking moves the cursor; double-mouth-open opens an **Orbital Command Menu** at the user's gaze. Selecting an icon runs a Claude-powered learning action on the current page (Summary, Flashcards, Quiz, Podcast, Veo Video, Mastery Path).

Built on the gaze layer from [Nutshell](../Nutshell). All biometrics stay on-device; only page text and Claude/Veo prompts hit the network.

## Install

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, select this folder.
2. Click the Hephaestus action icon to open the side panel.
3. Paste an Anthropic API key (https://console.anthropic.com) and a Gemini API key with Veo enabled (https://aistudio.google.com/apikey). Click **Save**.
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
  mastery-path.js               Claude (deep) plans an ordered pipeline

lib/
  claude-client.js              Anthropic SSE client + tool runner
  veo-client.js                 Gemini Veo long-running operation client
  Readability.js                Mozilla content extraction
```

## Models

- Default fast tier: `claude-sonnet-4-6`
- Default deep tier (Mastery Path): `claude-opus-4-7`
- Veo: `veo-3.0-generate-preview` via the Gemini API

Override per-action models in the side panel.
