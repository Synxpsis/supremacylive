# Supremacy Live — Design System Handoff

**Rev 1.0 · "Command Console" · 2026-09**

Artifacts in this project:

| File | What it is |
|---|---|
| `tokens.css` | The token layer. Drop into `public/tokens.css`. 132 custom properties + 4 faction palettes + reduced-motion overrides. |
| `Supremacy DS — Foundations.dc.html` | The visual law: ground, seams, ink, signal, faction slots, type, space, frames, motion, do/don't. |
| `Supremacy DS — Components.dc.html` | Every component in every state, at real size. Seven groups: buttons, inputs, navigation, data display, match, feedback, social. |
| `Supremacy DS — Screens.dc.html` | Four reference screens at 1440×900: hub, match HUD, match end, ladder. Chrome only — the board region is a canvas the system does not specify. |
| `Supremacy DS — Screens II.dc.html` | Eight more at 1440×900: landing, auth, matchmaking, profile, clan, social, settings, notifications. |
| `Supremacy DS — Icons.dc.html` | 28 icons on a 16px grid, 1.5 stroke, square caps. Construction rules, the set, and in-use examples. |
| `CLAUDE.md` | The condensed rules, for the repo root. Every Claude Code session loads it automatically. |

---

## The rule that matters most

**Feature code contains no raw hex, no px font-size, no ms literal, and no `border-radius`.**

Everything comes from `tokens.css`. If a value you need is not in there, that is a gap in the system — raise it, don't invent it locally. The whole point of this pipeline is that the same decision is never made twice in two files.

---

## Wiring

```html
<html data-faction="cobalt-ember">
<head>
  <link rel="stylesheet" href="./tokens.css">
</head>
```

In a Design Component, the link goes in `<helmet>`. `tokens.css` only declares custom properties — it styles nothing on its own, so it is safe to load in every page and never fights the inline styles.

Usage in inline styles, exactly as the client already writes them:

```html
<div style="background: var(--sl-ink-200);
            border: var(--sl-border) solid var(--sl-seam-strong);
            padding: var(--sl-pad-panel);
            color: var(--sl-text);
            font-family: var(--sl-font-ui);
            font-size: var(--sl-fs-ui-sm);">
```

---

## Naming

`--sl-<group>-<role>[-<modifier>]`

| Group | Holds |
|---|---|
| `ink` | Ground steps `000`–`500` |
| `seam` | Hairline colours: default, `strong`, `signal`, `dash` |
| `text` | `text`, `-dim`, `-mute`, `-ghost`, `-invert` |
| `signal` | The white interface accent: base, `-hot`, `-dim`, `-wash`, `-glow` |
| `coin` | Gameplay currency accent (gold): base, `-wash` |
| `ok / warn / danger / info` | Status, each with `-wash` and `-fill` |
| `faction` | `-self`, `-foe`, `-third`, `-fourth`, `-neutral`, each with `-wash` / `-edge` |
| `font / fs / lh / tr / fw` | Family, size, line-height, tracking, weight |
| `space` | `0`–`9` on a 4px base |
| `ctl` | Control heights and padding |
| `dur / ease` | Motion |
| `z` | Layers |

---

## Non-negotiables

1. **Radius is 0.** The corner language is the 9px bracket tick, and it is reserved for the one *armed* region in a view.
2. **Depth is ground steps + seams.** `box-shadow` is legal in exactly two places: the modal scrim and `--sl-focus-ring`.
3. **The interface is achromatic.** White, grey, black. Hue is reserved for game state the player acts on — faction, status, coin — so anything coloured on screen is meaningful. A gold icon, a green nav item or a tinted heading is a bug.
4. **One white fill per view.** The primary action. Everything else that wants emphasis gets a white *edge*, white *numerals*, or a step up the ground.
5. **Gold is coin, not chrome.** `--sl-coin` appears on currency values, costs and the coin glyph. Nowhere else. (`--sl-warn` shares the hue but means "under threat" — different token, different job.)
4. **Every player-facing number is `--sl-font-mono`.** Counts, coin, timers, deltas, costs, ranks, scores. A count that reflows when it ticks is a defect.
5. **Never hardcode a seat colour.** Read `--sl-faction-self` / `-foe` / `-neutral`. `self` is always the viewing player, which is what makes spectate and replay work with no per-element branching.
6. **Display type is always uppercase** Barlow Condensed 700. Sentences are always Barlow Semi Condensed.
7. **In-match motion is capped at `--sl-dur-3` (220ms)** and limited to colour and opacity. State must never arrive after the player has already acted.
8. **Layout uses flex/grid `gap`.** Not margins on children, not whitespace between inline siblings.
9. **Four frames only** — panel, armed, telemetry, void. A new feature picks one. If none fits, the frame set changes in the system first.

---

## Migration order

Do these in sequence; each step is independently shippable.

**01 — Land the token layer.** Add `public/tokens.css`, link from `index.html`, `game.html`, `editor.html`. No visual change.

**02 — Strip hue from chrome, then wire faction slots.** Every gold in UI chrome — links, headings, active tabs, panel accents, focus rings, the hub's gold fills — becomes `var(--sl-signal)` (white) or a grey step. Gold survives **only** on coin values, as `var(--sl-coin)`. Then `data-faction="cobalt-ember"` on `<html>`. In `game.html`, `seatColour()` currently returns `'#48a37c'` / `'#c0483c'` / `'#8b8272'` and the props default to those literals — return `var(--sl-faction-self)` / `var(--sl-faction-foe)` / `var(--sl-faction-neutral)` instead. `board-render.js` and `board-render-3d.js` draw to canvas and cannot read `var()`, so read the computed values once at init via `getComputedStyle(document.documentElement).getPropertyValue('--sl-faction-self')` and cache them; re-read on palette change.

**03 — Ground, seams, radius.** Mechanical replacement across `public/`:

| Was | Now |
|---|---|
| `#0b1219` | `var(--sl-ink-100)` |
| `#080e14` | `var(--sl-ink-000)` |
| `#101a23` | `var(--sl-ink-200)` |
| `#131e28` | `var(--sl-ink-300)` |
| `#16202c` | `var(--sl-ink-300)` |
| `#efe6d5` | `var(--sl-text)` |
| `#c8c2b4` | `var(--sl-text-dim)` |
| `#9aa1a8` | `var(--sl-text-dim)` |
| `#6f7883` | `var(--sl-text-mute)` |
| `#4a5158` | `var(--sl-text-ghost)` |
| `#d9a441` | `var(--sl-coin)` *(currency)* or `var(--sl-signal)` *(chrome)* — check each site; most are chrome and become white |
| `rgba(217,164,65,0.14)` | `var(--sl-signal-wash)` *(chrome)* or `var(--sl-coin-wash)` *(currency)* |
| `#48a37c` | `var(--sl-ok)` *(status)* or faction slot *(seat)* — check each site |
| `#c0483c` | `var(--sl-danger)` *(status)* or faction slot *(seat)* |
| `rgba(239,230,213,0.14)` | `var(--sl-seam-strong)` |
| `rgba(239,230,213,0.08)` | `var(--sl-seam)` |
| `border-radius: 3px` / `2px` | delete |

`#8b8272` (neutral seat) → `var(--sl-faction-neutral)`. `#e8d3a8` and `#e7b3ac` (tinted notice text) → `var(--sl-text)` on the matching status wash.

**04 — Retire Bitter.** Replace the Google Fonts link with:

```html
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow+Semi+Condensed:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
```

Then every `font-family: Bitter, serif` becomes either display (`--sl-font-display`, uppercase, `--sl-tr-display`) or mono (`--sl-font-mono`) depending on whether it labels or counts. Rule of thumb from the current code: headings and panel titles → display; `myCoin`, `headerLeft.terr`, `multiTroops`, `overTitle`'s score → mono.

**05 — Re-cut panels into frames.** `index.html` hub and `game.html` HUD first. The blurred `theatreDrift` / `hazeBreathe` / `scanSweep` backdrop stack in the hub is retired — ambient motion belongs to the board canvas, not to DOM layers behind the UI.

**06 — Component sheet, screen by screen.** Match each surface to its reference screen in `Supremacy DS — Screens.dc.html`. A screen is done when it contains no raw hex, no px font-size, and no ms literal.

---

## Screen geometry

From the reference screens. These are exact, not approximate.

| | Out of match | In match |
|---|---|---|
| Header height | 56px | 44px |
| Gutter between regions | 20px | 10px |
| Panel padding | 24px (`--sl-pad-panel-lg`) | 16px (`--sl-pad-panel`) |
| Table / list row | 44px | 36px |
| Side rail | 320–340px | 300px |
| Primary action height | 44px | 36px |

Minimum viewport 1280×760. Below that the match HUD collapses its left rail to icons; the hub stacks the side rail under the main column.

---

## The board is out of scope

`public/board-render.js` owns the board: extruded province volumes through an orbit camera, territory blocks, the structure kit (`barracks` / `industry` / `capital` / `city`), depth-sorted paint, roads, frontier outlines, garrison badges and in-transit stacks. **The design system does not specify board geometry** and the reference screens deliberately do not mock it — that region is drawn as a void frame.

What the system *does* own there is the colour and type the renderer paints with. Canvas cannot resolve `var()`, so read the tokens once at init and cache them:

```js
const tok = n => getComputedStyle(document.documentElement)
  .getPropertyValue(n).trim();
```

Re-read on palette change. Current literals in `board-render.js` and their replacements:

| Literal | Where | Now |
|---|---|---|
| `#48a37c` / `#c0483c` | `defaultSeatColour` | `--sl-faction-self` / `--sl-faction-foe` |
| `#8b8272` (`NEUTRAL`) | unowned roofs, default seat | `--sl-faction-neutral` |
| `#6d675a` (`LAND`) | unowned tiles | `--sl-ink-300` |
| `#0c1620` (`BOARD_EDGE`) | board slab faces | `--sl-ink-000` |
| `#8f887a` / `#68624f` | `WALL_NEAR` / `WALL_SIDE` | `--sl-ink-400` / `--sl-ink-300` |
| `rgba(217,164,65,…)` | frontier fill/stroke, selection | `--sl-signal-wash` / `--sl-signal` |
| `rgba(239,230,213,…)` | roads, slot placeholders | `--sl-seam` / `--sl-seam-dash` |
| `rgba(11,18,25,…)` | badge grounds, tile grid, label plates | `--sl-ink-000` at the same alpha |
| `#efe6d5` | garrison numerals | `--sl-text` |
| `#0b1219` | stack count on a faction dot | `--sl-text-invert` |
| `'Barlow Semi Condensed'` 600 | garrison + stack counts | `--sl-font-mono` 500 — these are numbers |
| `Bitter, serif` | territory labels | `--sl-font-display`, uppercase |

The `LAND` / `WALL_*` swaps move the board from warm khaki to the graphite ground; without them the board stays sepia while the chrome goes achromatic.

---

## Iconography

28 drawn icons, no library. Full set and construction rules in `Supremacy DS — Icons.dc.html`; copy the SVG out of that file rather than reaching for a package.

```html
<svg width="16" height="16" viewBox="0 0 16 16" fill="none"
     stroke="currentColor" stroke-width="1.5"
     stroke-linecap="square" stroke-linejoin="miter"
     vector-effect="non-scaling-stroke"
     aria-hidden="true">…</svg>
```

- **Square caps, mitre joins.** Rounded strokes are every icon library's default and they quietly contradict the zero-radius frames.
- **`currentColor` only.** The icon inherits its parent's ink, so it dims with disabled text and takes faction hue inside a seat pill with no extra rule. An icon carrying its own hex is a bug.
- **`vector-effect="non-scaling-stroke"`** pins the rendered stroke at 1.5px at 14, 16 and 20. Without it a 20px icon draws at 1.875 and outweighs the 1px seams beside it.
- **Play is the only filled glyph.** Everything else is stroke on nothing.
- Sizes are 14 (dense rows), 16 (default), 20 (headers). Never below 14.
- Icon-only control: `aria-label` on the control, `aria-hidden` on the svg.
- A twenty-ninth icon gets drawn in the Icons file first, never in a feature.

---

## Copy voice

Command-console clipped. Uppercase mono for labels; sentence case for the one line of explanation underneath.

- Labels are nouns, abbreviated where a player would abbreviate: `COIN`, `GARRISON`, `COIN/S`, `ETA`, `RANK`.
- Actions are verb-first and state the consequence: `FORFEIT MATCH — 3 CAPITALS SURRENDERED`, not "Are you sure?"
- Numbers carry their unit in `--sl-text-dim` at one step down: **148** `TROOPS`. Coin values are the one exception that takes hue: `--sl-coin`.
- No exclamation marks. No second person plural. No "Oops".
- Empty states say what will appear and what causes it: "No orders issued. Select a province to open its orders."

---

## Accessibility floor

- Body and label text: ≥ 4.5:1 against its own ground. `--sl-text-mute` at 5.0:1 is the smallest passing step; `--sl-text-ghost` is disabled/decorative only and must never carry information.
- Faction identity is never colour alone: holdings are also hatched (45°, 1px on 5px), and seat pills carry the seat letter.
- Two colourblind-safe palettes ship as options: `cobalt-amber` (deutan/protan) and `rose-verdant` (tritan).
- Focus is always visible: `--sl-focus-ring`, never `outline: none` without a replacement.
- `prefers-reduced-motion` collapses `dur-2`…`dur-4` to 80ms and `dur-5` to 0; ambient board motion stops.

---

## Pipeline

```
DESIGN (this project)  →  tokens.css + HANDOFF.md + reference screens  →  CLAUDE CODE  →  production
        ↑                                                                       |
        └───────────────── anything that had to be invented ────────────────────┘
```

Anything Claude Code has to invent to finish a screen is a gap in this system. It comes back here, gets designed, and lands in `tokens.css` — not in feature code.

---

## Revision procedure

The design files and `tokens.css` are synced by hand, so they fork the moment someone edits one without the other. The procedure exists to stop that.

**A change starts here, never in the repo.** If production needs a value the system doesn't have, that is a request back to this project — not a local literal with a TODO on it.

### Changing a token value

1. Edit `tokens.css`. It is the single source of truth for values.
2. Update every design file that shows that value literally. The `.dc.html` files use inline literals (they must paint while streaming), so a token change means a find-and-replace across `Foundations`, `Components`, `Icons`, `Screens`, `Screens II`.
3. Bump the rev in each file's header block and in this document.
4. Hand over: `tokens.css` + `HANDOFF.md` + the changed design files.

A token value that appears in `tokens.css` but nowhere in the design files is unverified — it has never been looked at. Either show it or delete it.

### Adding a component

1. Draw it in `Supremacy DS — Components.dc.html`, in the group it belongs to, **in every state it can hold** — rest, hover, focus, active, disabled, empty, loading. A state that isn't drawn will be improvised.
2. If it needs a value that isn't in `tokens.css`, add the token first and follow the procedure above. Do not introduce a one-off literal.
3. Put it into at least one reference screen. A component that has never been placed in a layout has untested density.
4. Note it in the artifacts table at the top of this file.

### Adding a screen

Assemble from the component sheet only. If the screen needs something the sheet doesn't have, stop and add the component first — that ordering is the whole point. Match the geometry table above: header 56/44, gutter 20/10, panel padding 24/16, rows 44/36.

### Versioning

`Rev MAJOR.MINOR` in each file header.

- **MINOR** — new component, new screen, new icon, copy change. Additive; existing code stays correct.
- **MAJOR** — a token value or name changes, a rule is reversed, a frame is redefined. Production code must be revisited. Say so explicitly in the handover.

Rename a token only on a MAJOR bump, and list the old → new mapping in this document the way the migration table does. A silently renamed token is an unresolved `var()` in production, which falls back to the browser default and fails quietly.

### Keeping a big revision from breaking

For a substantial change, copy the design file first (`Components v2.dc.html`) and edit the copy, so the current production reference stays intact while the new direction is being reviewed. Merge back to the canonical name once it is approved.
