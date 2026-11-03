import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ModelToolAdmission } from '@skaro/timeline';
import type { JournalRecord } from '@skaro/agent-runtime';
import type { TaskWorkflowPacket } from './task-workflow-packet';

const edits = ['index.html', 'css/cat-motion.css', 'css/plane-motion.css'];

/** Narrow the reviewed catalogue to real verification prerequisites, never model claims. */
export function workflowToolNames(
  records: readonly Pick<JournalRecord, 'id' | 'facts' | 'result'>[],
  strict = false,
): readonly string[] | undefined {
  const inspected = records.some((record) =>
    record.facts.some(
      (fact) =>
        fact.type === 'tool-request' &&
        fact.name === 'inspect_acceptance' &&
        records.some(
          (result) =>
            result.id === `cmd:${fact.id}` &&
            !result.result.error &&
            (result.result.value as { binding?: unknown })?.binding,
        ),
    ),
  );
  if (!inspected) return ['inspect_acceptance'];
  if (
    !records.some(
      (record) => (record.result.value as { kind?: string })?.kind === 'verification-plan',
    )
  )
    return strict
      ? ['plan_checks']
      : ['read_file', 'plan_checks', 'mcp__skaro__get_c4_context', 'mcp__skaro__review_c4'];
  if (
    !records.some((record) => (record.result.value as { kind?: string })?.kind === 'command-check')
  )
    return ['run_check'];
  return undefined;
}

/** T-006 grant only; T-008 commands and mutable paths require their own later admission. */
export function workflowToolPolicy(
  packet: TaskWorkflowPacket,
  artifactDir: string,
  strict = false,
) {
  const root = packet.project.root;
  const reads = new Set([...packet.wireComposition.sources.map((item) => item.path), ...edits]);
  const task = packet.wireComposition.tasks.find((item) => item.id === 'T-006')!;
  const criteria = new Set(task.criteria.map((item) => item.id));
  const commands = packet.actionProposal.commands.slice(0, 2);
  const requireCheck = (value: Record<string, unknown>) => {
    assert(commands.includes(String(value.command)), 'Only flight/background commands are allowed');
    assert(value.cwd === root && (value.shell === undefined || value.shell === 'powershell'));
    assert(value.timeoutMs === 120000);
    assert(Array.isArray(value.criteria) && value.criteria.length > 0);
    assert(value.criteria.every((item) => criteria.has(item)));
  };
  const runtimeNames = packet.wireComposition.tools.runtime.map((item) => item.name);
  const skaroNames = ['get_c4_context', 'review_c4', 'submit_result', 'report_task_blocker'];
  const browserNames = ['browser_navigate', 'browser_take_screenshot', 'browser_console_messages'];
  const examplePlan = {
    criteriaRevision: task.criteriaRevision,
    checks: [
      {
        id: 'flight',
        name: 'T-006 flight geometry',
        criteria: [...criteria],
        command: commands[0],
        cwd: root,
        shell: 'powershell',
        timeoutMs: 120000,
      },
    ],
    uncovered: [],
  };
  const modelTools = [
    ...packet.wireComposition.tools.runtime,
    ...packet.wireComposition.tools.skaro
      .filter((item) => skaroNames.includes(item.name))
      .map((item) => ({ ...item, name: `mcp__skaro__${item.name}` })),
    ...packet.wireComposition.tools.browser.filter((item) =>
      browserNames.some((name) => item.name === `mcp__browser__${name}`),
    ),
  ].map((item) => ({
    name: item.name,
    parameters: item.inputSchema,
    description: `${item.description ?? item.name}\nScope: T-006 only. Reads: ${[...reads].join(', ')}. Edits: ${edits.join(', ')}. Checks require cwd=${root}, shell=powershell, timeoutMs=120000; commands: ${commands.join(' OR ')}.${strict && item.name === 'plan_checks' ? '\nActual task plan arguments (copy IDs exactly; not evidence): ' + JSON.stringify(examplePlan) : ''}`,
  }));
  const allowed = new Set(modelTools.map((item) => item.name));
  const policy: ModelToolAdmission = {
    revision: strict ? 'cat-pilot-workflow-t006-v3' : 'cat-pilot-workflow-t006-v1',
    chatToolsRequired: strict,
    rejectionMessage: strict
      ? 'Invalid T-006 arguments. Use project-relative paths, e.g. .skaro/docs/storyboard.md; startLine starts at 1. Copy the actual plan_checks example from its description exactly: criterion IDs are IDs, not criterion text. The command contains real quotes, not backslash-escaped quote characters. Use inspect_acceptance for the real criterion revision; do not invent hashes.'
      : 'Outside reviewed T-006 scope: use only listed source paths and exact flight/background commands.',
    selectChatTools(catalog) {
      assert.deepEqual(catalog, modelTools);
      return catalog;
    },
    async requireAllowed(name, raw) {
      assert(allowed.has(name));
      const args = raw as Record<string, unknown>;
      assert(args && typeof args === 'object' && !Array.isArray(args));
      if (name === 'read_file') assert(reads.has(String(args.path)));
      if (name === 'apply_patch') {
        assert(edits.includes(String(args.path)) && args.operation !== 'delete');
        let original = '';
        if (args.operation === 'update')
          original = await readFile(join(root, String(args.path)), 'utf8');
        let next = original;
        if (args.operation === 'create') {
          assert(typeof args.content === 'string');
          next = args.content;
        } else {
          assert(Array.isArray(args.changes));
          for (const change of args.changes as { before: string; after: string }[]) {
            assert(change.before && next.split(change.before).length === 2);
            next = next.replace(change.before, change.after);
          }
        }
        if (args.path === 'index.html') {
          assert(args.operation === 'update');
          requireAnimationIndex(original, next);
        } else requireMotionStylesheet(next);
      }
      if (name === 'run_check') requireCheck(args);
      if (name === 'plan_checks') {
        assert(args.criteriaRevision === task.criteriaRevision && Array.isArray(args.checks));
        args.checks.forEach((item) => requireCheck(item as Record<string, unknown>));
      }
      if (name === 'mcp__browser__browser_navigate')
        assert.deepEqual(args, { url: pathToFileURL(join(root, 'index.html')).href });
      if (name === 'mcp__browser__browser_console_messages')
        assert.deepEqual(args, { level: 'error' });
      if (name === 'mcp__browser__browser_take_screenshot')
        assert.deepEqual(args, { type: 'png', scale: 'css', fullPage: true });
    },
    async projectResult(result) {
      const value = result.value as { output?: { path: string } } | undefined;
      if (!value?.output) return result;
      const path = resolve(value.output.path);
      assert.equal(dirname(path), resolve(artifactDir));
      const bytes = await readFile(path);
      assert(bytes.length < 200000);
      // Fixed checker output is real data. Keep large geometry samples in its primary artifact.
      const report = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
      const { samples: _samples, ...summary } = report;
      return { ...result, checkOutput: summary };
    },
  };
  return { policy, modelTools, runtimeNames, skaroNames, browserNames };
}

/** Motion files cannot introduce palette, layout, external resources or executable CSS. */
export function requireMotionStylesheet(content: string) {
  const css = content.replace(/\/\*[\s\S]*?\*\//g, '');
  assert(!/\\|@import|url\s*\(|expression\s*\(|[<>]/i.test(css));
  const properties = new Set([
    'transform',
    'opacity',
    'transform-origin',
    'transform-box',
    'animation',
    'animation-name',
    'animation-duration',
    'animation-timing-function',
    'animation-delay',
    'animation-iteration-count',
    'animation-direction',
    'animation-fill-mode',
    'animation-play-state',
  ]);
  for (const declaration of css.matchAll(/(?:^|[;{}])\s*([-\w]+)\s*:/g))
    assert(properties.has(declaration[1]!), 'Motion styles cannot change layout or palette');
}

/** Preserve every top-level SVG subtree byte-for-byte; only their drawing order may change. */
export function requireAnimationIndex(before: string, after: string) {
  const structure = (source: string) => {
    const match = /(<svg\b[^>]*>)([\s\S]*?)(<\/svg>)/.exec(source);
    assert(match);
    const groups: string[] = [];
    const comments: string[] = [];
    const blank = (text: string) => !text.replace(/<!--[\s\S]*?-->/g, '').trim();
    let depth = 0,
      start = 0,
      end = 0;
    for (const tag of match[2]!.matchAll(/<!--[\s\S]*?-->|<[^>]+>/g)) {
      if (tag[0].startsWith('<!--')) {
        if (!depth) comments.push(tag[0]);
        continue;
      }
      if (!depth) {
        assert(blank(match[2]!.slice(end, tag.index)));
        start = tag.index;
      }
      if (tag[0].startsWith('</')) depth--;
      else if (!tag[0].endsWith('/>')) depth++;
      assert(depth >= 0);
      if (!depth) {
        end = tag.index + tag[0].length;
        groups.push(match[2]!.slice(start, end));
      }
    }
    assert(depth === 0 && blank(match[2]!.slice(end)));
    return {
      groups: groups.sort(),
      comments: comments.sort(),
      outer: source
        .replace(match[0], `${match[1]}${match[3]}`)
        .replace(/\s*<link rel="stylesheet" href="css\/(?:cat|plane)-motion\.css">/g, ''),
    };
  };
  assert.deepEqual(
    structure(after),
    structure(before),
    'SVG geometry/layout must remain unchanged',
  );
}
