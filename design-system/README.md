# Supremacy Live — Design System

**Command Console v1.0** · the visual language for [supremacy.live](https://supremacy.live).

Black ground, grey structure, white signal. The interface is achromatic end to end; every colour on screen belongs to the game — faction, status, coin.

## What to hand Claude Code

| File | Goes where | What it is |
|---|---|---|
| `tokens.css` | `public/tokens.css` | The token layer. 132 custom properties, 4 faction palettes, reduced-motion overrides. The single source of truth for values. |
| `UI-RULES.md` | `design-system/` | The condensed rules — read before any UI work. |
| `HANDOFF.md` | `design-system/` | Full spec: migration order, literal-by-literal replacement tables, board contract, governance. |

`CLAUDE.md` (repo root) is the whole-repo entry point every Claude Code session loads
automatically — scope, process, dos/don'ts, pre-commit checklist. It points here for design-system
specifics rather than restating them.

## The design files

Open these in the browser; they are the visual reference Claude Code builds against.

| File | Covers |
|---|---|
| `Supremacy DS — Foundations.dc.html` | Ground, seams, ink, signal, faction slots, type, space, the four frames, motion, do/don't |
| `Supremacy DS — Components.dc.html` | Every component in every state at real size — buttons, inputs, navigation, data, match, feedback, social |
| `Supremacy DS — Icons.dc.html` | 28 icons on a 16px grid, construction rules, in-use examples |
| `Supremacy DS — Screens.dc.html` | Hub, match HUD, match end, ladder — 1440×900 |
| `Supremacy DS — Screens II.dc.html` | Landing, auth, matchmaking, profile, clan, social, settings, notifications — 1440×900 |

Each design file has a faction-palette switcher in its left rail — use it to check any screen against the two colourblind-safe palettes.

## The one rule

**Feature code contains no raw hex, no px font-size, no ms literal, and no `border-radius`.**

If a value isn't in `tokens.css`, that is a gap in the system. It gets designed here and lands in `tokens.css` — never as a local literal in feature code.

## Pipeline

```
DESIGN (this project) → tokens.css + HANDOFF.md + reference screens → CLAUDE CODE → production
        ↑                                                                    |
        └──────────────── anything that had to be invented ──────────────────┘
```

Revision procedure — how to change a token, add a component, and version the result — is at the bottom of `HANDOFF.md`.

## Out of scope

The match board is a canvas owned by `public/board-render.js`: isometric extruded provinces, orbit camera, territory blocks, structure kit. The system supplies the colours and fonts that renderer paints with, not its geometry. See "The board is out of scope" in `HANDOFF.md`.
