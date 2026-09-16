# Contributing

Two people push to this repo, and `main` deploys straight to production. This document is the
whole process — read it once, it's short.

New here and need to set up git/`gh` auth from scratch? See [`docs/ONBOARDING.md`](docs/ONBOARDING.md)
first — this doc picks up where that one leaves off.

## Setup

```
git clone https://github.com/Synxpsis/supremacylive.git
cd supremacylive
npm install
npm run dev
```

No Cloudflare account, API token, or login is needed for local development. `wrangler dev` runs
the Worker and a local D1 instance entirely on your machine. You only need real Cloudflare
credentials if you're debugging the production deploy itself, and those live in the repo's
GitHub Actions secrets, not on your machine.

## Branching and PRs

`main` is protected: no direct pushes. Every change goes through a branch and a pull request.

```
git checkout -b your-name/short-description
# ... make changes ...
git push -u origin your-name/short-description
gh pr create
```

- Open the PR against `main`. The template will walk you through what to fill in.
- CI (`.github/workflows/ci.yml`) runs `npm run lint` and `npm run validate` (a `wrangler deploy
  --dry-run` — catches broken config/bindings/syntax without touching production) on every PR.
  Both must pass before merge.
- A review approval is **not** currently required to merge — with two people, mandatory
  cross-review would just block whoever's PR lands while the other is offline. Use judgment:
  ping the other person for a look on anything risky (auth, D1 schema, payments, matchmaking
  logic), and don't wait on review for a typo fix.
- Merging to `main` deploys to production within a minute or two (`.github/workflows/deploy.yml`).
  There's no staging environment and no manual approval step before that deploy runs — treat
  every merge as a release.

## Before you open a PR

- `npm run lint` — flat-config ESLint (`eslint.config.js`). Existing pre-lint code has some
  warnings (empty catch blocks, intentionally-unused `_` params); those don't fail CI. New
  `no-undef` / real-bug-shaped errors do.
- `npm run validate` — dry-run build. Catches bad `wrangler.jsonc` bindings and syntax errors
  before they'd fail (or worse, half-succeed) in the real deploy.
- If you touched D1 schema, add a **new** file under `migrations/` — never edit a migration
  that's already shipped. `npm run db:migrations:local` applies it locally.
- If you touched anything in `public/` or added a UI surface, it needs to follow the design
  system: read `CLAUDE.md` (short version) and `design-system/HANDOFF.md` (full spec) first.
  Tokens only, achromatic, zero radius outside the one spinner exception, mono numerals. If the
  value/component/state you need doesn't exist in `public/tokens.css`, that's a gap to flag, not
  something to invent locally.

## Secrets

Never commit `.dev.vars` or anything resembling a Cloudflare token, session secret, or database
credential — `.gitignore` already excludes `.dev.vars*`, keep it that way. Production secrets
(`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) live only in the repo's GitHub Actions secrets
and are never needed locally.

## Where things live

See [`README.md`](README.md) for project layout and [`docs/README.md`](docs/README.md) for the
full technical inventory (mechanics, netcode model, map system, API reference, known issues).
