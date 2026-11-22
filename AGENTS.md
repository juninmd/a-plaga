# AGENTS.md

A Plaga: multiplayer browser game with a Vite/TypeScript client and a Node WebSocket server (`/ws`). The server also serves the built client on port 8080.

## Stack

- TypeScript (client, server and shared code), Vite, Vitest
- Node 24 at runtime (`Dockerfile`), `ws` for WebSocket
- Docker image published to GHCR by `.github/workflows/deploy.yml`

## Commands

```bash
npm ci
npm run dev          # Vite client; proxies /ws and /rooms to :8080, so run the server too
npm start            # server on :8080 (serves dist/ and /ws); needs npm run build first
npm run build        # tsc for the server, then vite build
npm run play         # build + server; prints http://<LAN-IP>:8080 for other devices
npm run typecheck    # client and server
npm test             # vitest run
```

Visual checks with `npm run dev`: `/dev-viewer.html` (skins) and `/dev-viewmodel.html` (first person).

## Structure

- `src/client/` - game client (rendering, input, HUD, lobby)
- `src/server/` - WebSocket server, rooms, bots, limits per IP and total
- `src/shared/` - code used by both sides (map, physics, loadout)
- `test/` - Vitest suites, one per game system
- `scripts/` - `lan.mjs` (used by `play` and `start:lan`), `ws-smoke*.mjs` (manual WebSocket smoke tests)
- `docs/` - research notes (`PESQUISA*.md`, `ONLINE.md`) and screenshots
- `public/` - game assets; `dev-viewer*.html` - dev viewers

## Conventions

- Commits: conventional prefix with scope, as in `fix(server): ...`, with the PR number in the subject.
- CI: `validate.yml` calls the reusable validate workflow from `juninmd/base-actions`; `sast.yml` and `security.yml` run SAST and gitleaks.

<!-- base-actions-main-policy -->
## GitHub Actions — padrão obrigatório (@main)

- Referencie as actions internas sempre pelo branch, nunca por SHA:
  - `uses: juninmd/base-actions/<action>@main`
  - `uses: juninmd/base-actions/.github/workflows/<arquivo>.yml@main`
- Não fixe `@<sha>` em `juninmd/base-actions`: a atualização é centralizada no
  `main` e passa a valer no próximo run.
- PRs cujos checks não iniciam por billing/spending limit são mesclados pelo bot central
  `juninmd/base-actions/.github/workflows/auto-merge-billing-blocked.yml`.
  Para impedir o merge automático de um PR, aplique a label `do-not-merge`.

## Gotchas

- Runtime env vars (names only): `PORT` (8080 in the image), `MAX_CONN_PER_IP`, `MAX_CONN_TOTAL`. Per-IP limits use the proxy's X-Forwarded-For entry.
- Run the server (`npm start`) while using `npm run dev`; the client proxy needs it on :8080.
- `dist/` and `dist-server/` are build output; do not commit them (`.gitignore`).
