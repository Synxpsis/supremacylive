# Supremacy Live — UI rules for Claude Code

The client's visual language is **Command Console v1.0**. Full spec in `design-system/HANDOFF.md`; token layer is `public/tokens.css`. This file is the short version — read it before writing any UI.

## The one rule

**Feature code contains no raw hex, no px font-size, no ms literal, and no `border-radius`.**

Every value comes from `public/tokens.css` as a `var(--sl-*)`. If the value you need isn't there, that is a gap in the design system — raise it, don't invent it locally.

## Non-negotiables

1. **The interface is achromatic.** White, grey, black. Hue is reserved for game state the player acts on — faction, status, coin. A gold icon, a green nav item or a tinted heading is a bug.
2. **Radius is 0.** The corner language is the 9px bracket tick, reserved for the one *armed* region in a view. The only non-zero radius in the system is the loading spinner.
3. **Depth is ground steps + seams**, never shadows. `box-shadow` is legal in exactly two places: the modal scrim and `--sl-focus-ring`.
4. **One white fill per view** — the primary action. Everything else that wants emphasis gets a white *edge*, white *numerals*, or a step up the ground.
5. **Every player-facing number is `--sl-font-mono`.** Counts, coin, timers, deltas, costs, ranks, scores. A count that reflows when it ticks is a defect.
6. **Never hardcode a seat colour.** Read `--sl-faction-self` / `-foe` / `-neutral`. `self` is always the viewing player, which is what makes spectate and replay work with no per-element branching.
7. **Display type is always uppercase** Barlow Condensed 700. Sentences are Barlow Semi Condensed. Numbers are JetBrains Mono. Bitter is retired.
8. **In-match motion is capped at 220ms** (`--sl-dur-3`) and limited to colour and opacity. State must never arrive after the player has already acted.
9. **Layout uses flex/grid `gap`** — not margins on children, not whitespace between inline siblings.
10. **Four frames only** — panel, armed, telemetry, void. A new feature picks one; if none fits, the frame set changes in the design system first.

## Wiring

```html
<html data-faction="cobalt-ember">
<head>
  <link rel="stylesheet" href="./tokens.css">
</head>
```

```html
<div style="background: var(--sl-ink-200);
            border: var(--sl-border) solid var(--sl-seam-strong);
            padding: var(--sl-pad-panel);
            color: var(--sl-text);
            font-family: var(--sl-font-ui);
            font-size: var(--sl-fs-ui-sm);">
```

## Token groups

`--sl-<group>-<role>[-<modifier>]`

| Group | Holds |
|---|---|
| `ink` | Ground steps `000`–`500` |
| `seam` | Hairlines: default, `strong`, `signal`, `dash` |
| `text` | `text`, `-dim`, `-mute`, `-ghost`, `-invert` |
| `signal` | The **white** interface accent: base, `-hot`, `-dim`, `-wash`, `-glow` |
| `coin` | Gameplay currency accent (gold): base, `-wash` |
| `ok / warn / danger / info` | Status, each with `-wash` and `-fill` |
| `faction` | `-self`, `-foe`, `-third`, `-fourth`, `-neutral`, each with `-wash` / `-edge` |
| `font / fs / lh / tr / fw` | Family, size, line-height, tracking, weight |
| `space` | `0`–`9` on a 4px base |
| `ctl` | Control heights (24/30/36/44) and padding |
| `dur / ease` | Motion |
| `z` | Layers |

## Screen geometry

| | Out of match | In match |
|---|---|---|
| Header height | 56px | 44px |
| Gutter between regions | 20px | 10px |
| Panel padding | 24px | 16px |
| Table / list row | 44px | 36px |
| Side rail | 320–380px | 300px |
| Primary action height | 44px | 36px |

Desktop only for v1. Minimum viewport 1280×760.

## Icons

28 drawn icons, no library. Copy the SVG from the design system's Icons file.

```html
<svg width="16" height="16" viewBox="0 0 16 16" fill="none"
     stroke="currentColor" stroke-width="1.5"
     stroke-linecap="square" stroke-linejoin="miter"
     vector-effect="non-scaling-stroke"
     aria-hidden="true">…</svg>
```

Square caps and mitre joins — rounded strokes contradict the zero-radius frames. `currentColor` only. Sizes 14 / 16 / 20, never below 14. Icon-only control gets an `aria-label`.

## The board is out of scope

`public/board-render.js` owns the board: isometric extruded province volumes, orbit camera, territory blocks, structure kit, depth sort. **The design system does not specify board geometry.**

It does own the colour and type the renderer paints with. Canvas can't resolve `var()`, so read tokens once at init and cache:

```js
const tok = n => getComputedStyle(document.documentElement)
  .getPropertyValue(n).trim();
```

Re-read on palette change. Full literal-by-literal mapping in `HANDOFF.md`.

## Copy voice

Command-console clipped. Uppercase mono for labels, sentence case for the explanation underneath.

- Labels are nouns, abbreviated where a player would: `COIN`, `GARRISON`, `COIN/S`, `ETA`, `RANK`.
- Actions are verb-first and state the consequence: `FORFEIT MATCH — 3 CAPITALS SURRENDERED`, not "Are you sure?"
- No exclamation marks. No "Oops".
- Empty states say what will appear and what triggers it: "No orders issued. Select a province to open its orders."

## Accessibility floor

- Text ≥ 4.5:1 against its own ground. `--sl-text-mute` (5.0:1) is the smallest passing step; `--sl-text-ghost` is disabled/decorative only and must never carry information.
- Faction identity is never colour alone — holdings are hatched, seat pills carry the seat letter.
- Focus always visible via `--sl-focus-ring`. Never `outline: none` without a replacement.
- `prefers-reduced-motion` is handled in `tokens.css`; don't re-implement it per component.

## When something is missing

If you have to invent a value, a component, or a state to finish a screen, that is a gap in the design system. Flag it rather than filling it — it gets designed in the design project and lands in `tokens.css`, not in feature code.
