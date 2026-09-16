# Supremacy Live — documentation index

This is the technical inventory of the game as it exists on `main` right now: mechanics, content,
architecture, routes, and known gaps. It's meant to stay accurate — when a change lands that makes
one of these pages wrong, update the page in the same PR, the way `CLAUDE.md` already works for the
design system.

This is the GitHub-side, code-grounded half of the documentation. A Notion workspace (natural-language,
less structurally tied to file/line references, easier to browse for non-code questions) mirrors and
expands on this content — see the note at the bottom of this file.

| Doc | Covers |
|---|---|
| [ONBOARDING.md](ONBOARDING.md) | New-contributor setup — git/gh auth, clone, local dev, first PR |
| [OVERVIEW.md](OVERVIEW.md) | What the game is, current maturity, what's live vs. shelved |
| [GLOSSARY.md](GLOSSARY.md) | Terminology — **read this first**, the code and the UI don't always use the same words for the same thing |
| [MECHANICS.md](MECHANICS.md) | The simulation: territories, garrisons, combat, structures, currency, win/loss |
| [MAP_SYSTEM.md](MAP_SYSTEM.md) | Board definitions, the slot-grid model, roads, symmetry, the camera/projection math — the standard going forward, full schema reference |
| [AI.md](AI.md) | The opponent bot: difficulty levels, its per-tick decision passes |
| [RENDERING.md](RENDERING.md) | The 3D Three.js rendering contract (the standard going forward) and the 2D isometric canvas renderer, and how each reads the design system |
| [EDITOR_UPGRADE.md](EDITOR_UPGRADE.md) | Gap list and sequencing plan for bringing the map editor up to the 3D/map standard |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Cloudflare Worker, Durable Objects, D1, the lockstep netcode model, deploy pipeline |
| [API.md](API.md) | Every HTTP route and WebSocket message shape, client and server side |
| [CONTENT_INVENTORY.md](CONTENT_INVENTORY.md) | Units, currencies, structures, maps, factions/cosmetics — what exists today, and what doesn't yet |
| [KNOWN_ISSUES.md](KNOWN_ISSUES.md) | Open bugs and gaps, with source and status |

Design-system-specific documentation (`Command Console v1.0` — tokens, components, UI rules) already
lives in [`design-system/`](../design-system/), condensed in
[`design-system/UI-RULES.md`](../design-system/UI-RULES.md); this docs set links to it rather than
duplicating it.

## Keeping this current

- These are living documents, not a one-time snapshot. When code changes the facts on one of these
  pages, the page should change in the same commit/PR — the way `CLAUDE.md` is already treated for
  the design system.
- Prefer describing *behavior and shape*, not pasting large code blocks — link to `file:line` instead,
  since line numbers drift and prose survives a refactor better than a quote does.
- `KNOWN_ISSUES.md` is a ledger, not a wishlist: only things that are actually broken, missing, or
  inconsistent right now. Feature ideas belong wherever the team tracks roadmap, not here.

## Notion

The Notion connector is wired up. The **Claude Documentation Hub** database in the Supremacy Live
Notion team space holds the natural-language, easier-to-browse counterpart to this set — same
subject matter, written for someone who wants an answer without reading source. It is not
auto-synced with this `docs/` set: when a change here changes a fact a Hub page states, update that
Hub page as a deliberate follow-up (see the Notion workspace's own `Claude.md` page for the working
conventions). The Hub currently has one page per doc here except `ONBOARDING.md` (human/agent dev
setup, not in scope for the natural-language hub).
