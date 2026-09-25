<div align="center">

<img src="assets/mark.svg" alt="Skaro" width="60" />

# Skaro

### Desktop workspace for orchestrating AI coding agents

![GitHub License](https://img.shields.io/github/license/skarodev/skaro?style=flat)
![GitHub Repo stars](https://img.shields.io/github/stars/skarodev/skaro?style=flat)

[Website](https://skaro.dev) · [Telegram](https://t.me/skarodev) · [Discord](https://discord.gg/zUv6AHuJwD)

</div>

> **Skaro v2 is in active development.** The previous version (Python CLI + web dashboard) lives in the [`legacy/v1`](https://github.com/skarodev/skaro/tree/legacy/v1) branch.

Skaro doesn't write code itself. Your coding agents — **Claude Code** and **Codex** — do. Skaro keeps the project under control:

- projects with their brief, architecture and ADRs, stored next to the code in `.skaro/`;
- milestones and tasks with dependencies, planned together with an agent in chat;
- run tasks with the agent and model of your choice, in parallel, each in its own git worktree;
- watch agent output live, answer its questions, approve actions;
- merge a finished task right from its chat — Skaro merges safely, only after your confirmation.

Runs locally, uses your own agent subscriptions, no account required.

Design docs: [docs/](docs/).

## Development

Requires Node.js 24+ and pnpm 10.

```sh
pnpm install
pnpm dev          # run the app with hot reload
pnpm lint         # ESLint
pnpm typecheck    # tsc + svelte-check
pnpm test         # Vitest
pnpm test:e2e     # Playwright, launches the built app (run `pnpm build` first)
pnpm dist         # installers for the current OS (apps/desktop/release/)
```

Layout: `apps/desktop` — Electron app (main, preload, Svelte 5 renderer); `packages/*` — core, timeline, agent adapters, MCP server, UI components; `fixtures/golden` — recorded agent sessions for adapter tests.

## License

AGPL-3.0 — see [LICENSE](LICENSE).
