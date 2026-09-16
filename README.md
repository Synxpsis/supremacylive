# Supremacy Live

Real-time, no-turns territory-control game. Territories, each a block of provinces, joined by one
road network — every capital you hold pays for the army that takes the next. Live 1v1 (and an AI
test match) runs on the 4-territory `duel` board today; a 25-territory `grand` board exists and is
fully playable but is currently shelved (see `docs/`).

Served from a single Cloudflare Worker: static client via Workers Assets, accounts + live map content
backed by D1.

## Documentation

Full technical inventory — mechanics, map system, AI, rendering, architecture, API reference, content
inventory, known issues — lives in [`docs/`](docs/). Start at [`docs/README.md`](docs/README.md).

UI design-system rules (Command Console v1.0) live in [`design-system/`](design-system/) and
[`CLAUDE.md`](CLAUDE.md).

Branching, PR, and CI process — read this before your first PR — is in
[`CONTRIBUTING.md`](CONTRIBUTING.md). New to this repo entirely? Start at
[`docs/ONBOARDING.md`](docs/ONBOARDING.md) instead — it covers git/gh auth and local setup from zero.

## Project layout

- `public/` — static client (HTML/CSS/JS, no build step)
- `src/worker.js` — Worker `fetch` handler: serves assets, `/api/auth/*`, `/api/maps/*`, routing
- `src/match.js` / `src/matchmaker.js` — Durable Objects for live 1v1 matches and the matchmaking queue
- `migrations/` — D1 schema
- `wrangler.jsonc` — Worker config (assets binding, D1 binding, Durable Object bindings, routes)
- `docs/` — technical documentation (see above)
- `design-system/` — Command Console v1.0 design system and reference screens

## Develop

```
npm install
npm run dev
```

## Deploy

```
npm run deploy
```

Merges to `main` deploy automatically via GitHub Actions (`.github/workflows/deploy.yml`). `main`
is protected — changes land via PR, see [`CONTRIBUTING.md`](CONTRIBUTING.md).
