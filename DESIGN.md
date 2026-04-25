# Hephaestus design system

This document is the single source of truth for product UI. Implementation lives in [`styles/design-tokens.css`](styles/design-tokens.css); the side panel, orbital menu, and gaze overlay consume these CSS variables.

## Principles

- **Modern and calm:** generous whitespace, soft surfaces, one clear primary action per region.
- **Accessible contrast:** body text on white meets WCAG AA; interactive states do not rely on color alone.
- **Consistent rhythm:** spacing uses a 4px base; type uses a small modular scale.

## Color

Brand palette (reference board: Hephaestus Branding).

| Role | Hex | Usage |
|------|-----|--------|
| **Primary** | `#6366F1` | Buttons, toggles on, links, focus rings, dwell progress, orbital focus ring |
| **Secondary** | `#6C6E7E` | Muted labels, secondary button borders, de-emphasized UI |
| **Tertiary** | `#7C3AED` | Accent highlights (tabs, badges, optional emphasis) |
| **Neutral** | `#585A68` | Primary body text on light backgrounds |

Semantic tokens (see `design-tokens.css` for full list) map these to surfaces, borders, and text. Scales follow an 11-step mental model (dark → base → light); we expose the steps needed for the extension UI (`*-50` … `*-900` style names).

## Typography

| Token | Font | Weight | Use |
|-------|------|--------|-----|
| **Sans** | Inter (`--heph-font-sans`) | 400 / 500 / 600 / 700 | All UI copy, headings, buttons |
| **Mono** | JetBrains Mono (`--heph-font-mono`) | 400 / 500 | API key fields, keyboard `kbd`, code-like output |

**Scale (side panel)**

| Name | Size | Line height | Weight |
|------|------|-------------|--------|
| `display` | 1.375rem (22px) | 1.25 | 700 — brand title |
| `overline` | 0.6875rem (11px) | 1.2 | 600 — section labels, uppercase tracking |
| `body` | 0.875rem (14px) | 1.5 | 400–500 — default body |
| `body-sm` | 0.8125rem (13px) | 1.45 | 400 — help text, status |
| `caption` | 0.75rem (12px) | 1.4 | 400–500 — meta, tabs |
| `mono` | 0.8125rem (13px) | 1.4 | 500 — inputs |

Fonts load from Google Fonts in the side panel only; extension pages declare CSP for `fonts.googleapis.com` / `fonts.gstatic.com`.

## Icons

**Orbital command menu** uses a fixed set of **Unicode geometric / symbol** glyphs (no emoji), one per action, for consistent weight and cross-platform rendering:

| Action | Glyph | Rationale |
|--------|-------|-----------|
| Summary | `¶` | Text / document |
| Flashcards | `☰` | Stacked lines |
| Quiz | `◈` | Distinct diamond (question-style) |
| Podcast | `♪` | Audio |
| Video | `▶` | Playback |
| Mastery path | `✦` | Star / path highlight |

Glyphs are defined in [`orbital/orbital-menu.js`](orbital/orbital-menu.js). When adding actions, pick from the same family (Geometric shapes, Dingbats, or common symbols) and keep size controlled via `.heph-orbital-glyph` in CSS.

**Elsewhere:** prefer CSS shapes, system symbols, or the same Unicode discipline; avoid mixing emoji with geometric icons in the same surface.

## Layout and shape

- **Radii:** `--heph-radius-sm` (8px), `--heph-radius-md` (12px), `--heph-radius-lg` (16px), `--heph-radius-pill` (9999px).
- **Shadows:** soft elevation only (`--heph-shadow-sm`, `--heph-shadow-md`); no harsh drop shadows on small controls.
- **Sections:** cards use a light surface (`--heph-surface-raised`) on a tinted page background (`--heph-surface-page`).

## Motion

- Transitions: 150–200ms ease for color/border; orbital uses existing cubic-bezier for open/close.
- Respect `prefers-reduced-motion` where practical (orbital already uses short durations).

## Calibration overlays

Head and mouth calibration UIs are built with inline styles in [`gaze/head-cal.js`](gaze/head-cal.js) and [`gaze/mouth-cal.js`](gaze/mouth-cal.js) (injected into arbitrary web pages). They intentionally mirror the same hex values as the tokens (`#6366f1`, `#4f46e5`, `#059669`, slate neutrals) so the experience matches the side panel without relying on `:root` variables in the host page.

## Files

| File | Role |
|------|------|
| [`styles/design-tokens.css`](styles/design-tokens.css) | CSS custom properties |
| [`sidepanel.css`](sidepanel.css) | Side panel layout and components |
| [`orbital/orbital-menu.css`](orbital/orbital-menu.css) | In-page radial menu |
| [`gaze/gaze-overlay.css`](gaze/gaze-overlay.css) | Pointer, HUD, calibration chrome |
| [`gaze/head-cal.js`](gaze/head-cal.js), [`gaze/mouth-cal.js`](gaze/mouth-cal.js) | Calibration modal styling (inline) |

When changing the system, update **tokens first**, then adjust component CSS; keep this document in sync for human-readable rationale. After token edits, sync the calibration hex values if those colors changed.
