# Security

This repo is public; the running game handles real accounts (usernames, emails, password
hashes, session cookies) in D1.

## Reporting a vulnerability

Don't open a public issue for anything exploitable (auth bypass, session/token leakage, SQL
injection, XSS, secrets exposure). Email alex@lab168.ca instead with what you found and how to
reproduce it. You'll get an acknowledgment and a fix timeline back.

Non-exploitable bugs (broken UI, incorrect game logic) are fine as normal public issues.

## Scope

In scope: `src/worker.js`, `src/match.js`, `src/matchmaker.js` (accounts, sessions, match/
matchmaking APIs), `migrations/` (schema), anything touching `/api/auth/*`.

Out of scope: the game client's rendering/simulation code (`public/`) unless the issue lets a
player affect another player's account or another match's server-side state.
