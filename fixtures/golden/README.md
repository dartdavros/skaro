# Golden sessions

Recorded agent sessions, one folder per `<agent>/<scenario>/`:

- `raw.jsonl` — the native stream in both directions (`in` — what Skaro sent, `out` — what the agent emitted, `err` — stderr, `meta` — probe notes). Source of truth.
- `canonical.jsonl` — the canonical timeline the adapter builds from it.
- `meta.json` — scenario, adapter version, recording time.
- `attachments/` — images from the session, by sha256.

Adapter tests (`pnpm test`) replay every `raw.jsonl` and compare with `canonical.jsonl`. Home dir, workspace path, user name and e-mails are replaced with placeholders at recording time.

Recording and replay — `apps/agent-probe` (run from that folder):

```sh
node src/cli.ts list                              # scenarios
node src/cli.ts claude read --effort low          # record one scenario (uses your agent subscription)
node src/cli.ts codex all --effort low --codex-config 'windows.sandbox="unelevated"'
node src/cli.ts replay claude all                 # check replays
node src/cli.ts replay claude all --update        # rebuild canonical.jsonl after an adapter change
```

Scenarios and findings: [docs/agent-output.md](../../docs/agent-output.md), sections P8 and 9.
