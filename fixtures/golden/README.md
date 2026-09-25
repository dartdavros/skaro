# Golden sessions

Recorded agent sessions, one folder per `<agent>/<scenario>/`:

- `raw.jsonl` — the native stream in both directions (`in` — what Skaro sent, `out` — what the agent emitted, `err` — stderr, `meta` — probe notes). Source of truth.
- `canonical.jsonl` — canonical timeline events the adapter builds from it.
- `timeline.json` — the timeline assembled from those events (what the feed renders).
- `meta.json` — scenario, adapter version, recording time.
- `attachments/` — images from the session, by sha256.

Adapter tests (`pnpm test`) replay every `raw.jsonl` and compare both the events and the assembled timeline; damaged copies of the sessions check that parsing never breaks. Home dir, workspace path, user name and e-mails are replaced with placeholders at recording time, and the projection is rebuilt from the sanitized raw log.

After an intended adapter change, rebuild the expected files and review the diff:

```sh
SKARO_UPDATE_GOLDEN=1 pnpm exec vitest run --project @skaro/adapter-claude --project @skaro/adapter-codex
```

Recording goes through the production adapters (`apps/agent-probe`, run from that folder; uses your agent subscription):

```sh
node src/cli.ts list                     # scenarios
node src/cli.ts adapters                 # status, models, commands, sandbox check — no model calls
node src/cli.ts claude read --effort low # record one scenario
node src/cli.ts codex all --effort low   # record all
```

Scenarios and findings: [docs/agent-output.md](../../docs/agent-output.md), sections P8 and 9.
