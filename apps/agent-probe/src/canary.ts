import { PROBE_AGENTS } from '@skaro/agents';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { probeBinary } from './adapters.ts';
import { readPerformed, recordingEvents, recordingReport } from './compatibility.ts';
import { exportProtocol } from './protocol-schema.ts';
import { recordScenario } from './record.ts';
import { scenarios } from './scenarios.ts';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    baseline: { type: 'string' },
    scenarios: { type: 'string', default: 'read,edit,question' },
    model: { type: 'string' },
    effort: { type: 'string' },
  },
});
const ids = values.scenarios!.split(',');
const selected = ids.map((id) => {
  const scenario = scenarios.find((s) => s.id === id);
  if (!scenario || !['read', 'edit', 'question'].includes(id)) {
    throw new Error(`Unsupported manual compatibility scenario: ${id}`);
  }
  return scenario;
});
const parent = resolve(values.out ?? join(tmpdir(), 'skaro-compatibility'));
mkdirSync(parent, { recursive: true });
const out = mkdtempSync(join(parent, 'run-'));
const baseline = values.baseline
  ? resolve(values.baseline)
  : resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/golden');
console.log(`Local records: ${out}`);
const runs = [];
for (const agent of [...PROBE_AGENTS].reverse()) {
  for (const scenario of selected) {
    try {
      const recorded = await recordScenario(agent, scenario, {
        out,
        model: values.model,
        effort: values.effort,
        quiet: true,
      });
      const result = recordingReport(recorded.dir, join(baseline, agent, scenario.id));
      const behavior =
        scenario.id === 'edit'
          ? editWorks(recorded.workspace)
          : scenario.id === 'read'
            ? readPerformed(recordingEvents(recorded.dir))
            : hasQuestion(recorded.dir);
      runs.push({ agent, scenario: scenario.id, ...result, behavior, ok: result.ok && behavior });
    } catch {
      runs.push({ agent, scenario: scenario.id, ok: false, recordingError: true });
    }
  }
}
let protocol;
try {
  protocol = await exportProtocol(out, baseline);
} catch {
  protocol = { ok: false, exportError: true };
}
let claudeVersion: string | null = null;
try {
  claudeVersion = execFileSync((await probeBinary('claude')).binary, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
} catch {
  /* The report still records an unavailable binary as a failure. */
}
const report = {
  format: 1,
  recordedAt: new Date().toISOString(),
  platform: `${process.platform}-${process.arch}`,
  claudeVersion,
  protocol,
  runs,
  ok: Boolean(claudeVersion) && protocol.ok && runs.every((run) => run.ok),
};
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Report: ${join(out, 'report.json')}\n${report.ok ? 'PASS' : 'FAIL'}`);
process.exitCode = report.ok ? 0 : 1;

function editWorks(workspace: string): boolean {
  try {
    execFileSync(process.execPath, ['test.js'], { cwd: workspace, stdio: 'pipe', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function hasQuestion(dir: string): boolean {
  // Only fixed canonical discriminants are inspected; raw payload is kept in the local record.
  return recordingEvents(dir).some(
    (e) => e.t === 'interaction.opened' && e.interaction.kind === 'question',
  );
}
