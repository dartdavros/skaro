import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';

export const C4_REFERENCE_COMMAND = `node --input-type=module -e "import {readFileSync,writeFileSync} from 'node:fs'; const p='index.html'; const s=readFileSync(p,'utf8'); if(s.split('css/base.css').length!==2) throw new Error('Expected one reference'); writeFileSync(p,s.replace('css/base.css','css/layout.css'));"`;
export const C4_SCRIPT_COMMAND = `node --input-type=module -e "import {readFileSync,writeFileSync} from 'node:fs'; const p='index.html'; const s=readFileSync(p,'utf8'); if(s.split('js/controls.js').length!==2) throw new Error('Expected one reference'); writeFileSync(p,s.replace('js/controls.js','js/pause-controls.js'));"`;
export const AG1_MOTION_COMMAND = `node --input-type=module -e "import {readFileSync,writeFileSync} from 'node:fs'; const p='index.html'; const s=readFileSync(p,'utf8'); if(s.split('js/pause-controls.js').length!==2) throw new Error('Expected one reference'); writeFileSync(p,s.replace('js/pause-controls.js','js/motion-controls.js'));"`;
const commands = new Set([
  'git status --short',
  'git diff --check',
  'git diff --stat',
  'git diff --name-status',
  'git diff --find-renames',
  'git diff --find-renames HEAD',
  'node --check js/controls.js',
]);

/** Approve only original real native requests for the owner's exact bounded T-012 operation. */
export async function approveC4TaskCommands(
  s: Services,
  project: string,
  task: string,
  operation: 'css' | 'js' | 'motion' = 'css',
) {
  const writes =
    operation === 'css'
      ? [C4_REFERENCE_COMMAND, 'git mv -- css/base.css css/layout.css']
      : operation === 'motion'
        ? [
            AG1_MOTION_COMMAND,
            'git mv -- js/pause-controls.js js/motion-controls.js',
            'node --check js/motion-controls.js',
          ]
        : [
            C4_SCRIPT_COMMAND,
            'git mv -- js/controls.js js/pause-controls.js',
            'node --check js/pause-controls.js',
          ];
  const view = await s.runs.open(project, task),
    run = s.db.latestRun(project, task);
  if (!run?.worktree) return;
  const approvals = view.timeline?.interactions.filter((i) => i.kind === 'approval') ?? [];
  if (!approvals.length) return;
  const lines = (await readFile(join(s.dataDir, run.logPath), 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  for (const approval of approvals) {
    assert.equal(approval.kind, 'approval');
    assert(approval.action.type === 'command' && approval.choices.includes('allow_once'));
    const request = lines.findLast(
      (entry) =>
        entry.line?.method === 'item/commandExecution/requestApproval' &&
        `req-${entry.line.id}` === approval.id,
    )?.line.params;
    assert(request && resolve(request.cwd) === resolve(run.worktree));
    assert.equal(request.commandActions?.length, 1);
    const command = String(request.commandActions[0].command).trim();
    const read =
      /^Get-Content\s+(?:-Raw\s+)?-LiteralPath\s+['"]?(index\.html|css[\\/](?:base|layout|scene|cat|plane)\.css|js[\\/](?:controls|pause-controls|motion-controls)\.js)['"]?(?:\s+-Raw)?$/i;
    assert(
      commands.has(command) || writes.includes(command) || read.test(command),
      `Outside authorized ${task} commands: ${command}`,
    );
    await sessionHandlers(s)['task.respond'](project, task, approval.id, {
      kind: 'approval',
      choice: 'allow_once',
    });
    process.send?.({ stage: 'authorized-task-command-once', task, command });
  }
}
