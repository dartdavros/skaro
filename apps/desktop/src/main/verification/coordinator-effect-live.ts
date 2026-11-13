import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';
import type { Services } from '../app-services';
import { coordinationHash, type ProjectOperationRequest } from '../project-coordinator-request';
import { CoordinationPending } from '../project-coordinator-errors';

interface Plan {
  project: string;
  owner: string;
  source: string;
  output: string;
  starts: string;
  hash: string;
  request: ProjectOperationRequest;
}
const hashFile = async (path: string) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
const program = `const fs=require('node:fs'),crypto=require('node:crypto');
const [source,output,starts,project,operation]=process.argv.slice(1);
process.once('message',()=>{fs.appendFileSync(starts,JSON.stringify({pid:process.pid,operation})+'\\n');
const hash=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
const fd=fs.openSync(output,'wx');fs.writeFileSync(fd,JSON.stringify({project,operation,source,hash,pid:process.pid}));fs.fsyncSync(fd);fs.closeSync(fd);process.exit(0);});`;

async function observe(s: Services, plan: Plan) {
  return s.resources.scope(
    plan.project,
    plan.owner,
    () =>
      s.resources.phase('process', async () => {
        const child = spawn(
          process.execPath,
          ['-e', program, plan.source, plan.output, plan.starts, plan.project, plan.request.id],
          {
            env: { ...cleanCommandEnvironment(), ELECTRON_RUN_AS_NODE: '1' },
            windowsHide: true,
            stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
          },
        );
        let errors = '';
        child.stderr?.on('data', (chunk) => {
          errors += String(chunk);
        });
        const finished = new Promise<void>((resolve, reject) => {
          child.on('error', reject);
          child.on('exit', (code) =>
            code === 0
              ? resolve()
              : reject(new Error(`Inspection child failed (${code}): ${errors}`)),
          );
        });
        assert(child.pid);
        try {
          await s.runs['engine'].processes.startedAsync(plan.owner, child.pid);
          child.send('inspect');
          await finished;
        } finally {
          await s.runs['engine'].processes.stop(plan.owner);
        }
        const result = JSON.parse(await readFile(plan.output, 'utf8'));
        assert.equal(result.hash, plan.hash);
        return result;
      }),
    { intentId: plan.request.id },
  );
}

/** Actual project bytes, an admitted OS child and fsynced evidence, cut before the result journal. */
export async function crashCoordinatorEffect(s: Services, project: string, directory: string) {
  const root = s.projects.get(project).root,
    source = join(root, 'index.html');
  const id = `ac5-observe-${randomUUID()}`,
    hash = await hashFile(source);
  const plan: Plan = {
    project,
    source,
    hash,
    owner: id,
    output: join(directory, 'physical-observation.json'),
    starts: join(directory, 'physical-starts.jsonl'),
    request: {
      id,
      projectId: project,
      action: 'verification.coordination.observe',
      source: { kind: 'controller', id: 'ac5-verification' },
      subject: { kind: 'document', id: source, version: hash },
      mode: 'control',
      scopeKey: `verification:${id}`,
      inputHash: coordinationHash([project, source, hash]),
    },
  };
  await writeFile(join(directory, 'effect-plan.json'), JSON.stringify(plan, null, 2));
  await s.coordinators.execute(plan.request, () => observe(s, plan), {
    evidence: () => {
      process.send?.({ stage: 'ac5-physical-effect-before-result', directory, operation: id });
      // The parent terminates this exact process tree at the real unrecorded-result boundary.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
      throw new Error('The parent did not terminate the verification process at the checkpoint');
    },
  });
}
export async function recoverCoordinatorEffect(s: Services, project: string, directory: string) {
  const plan = JSON.parse(await readFile(join(directory, 'effect-plan.json'), 'utf8')) as Plan;
  assert.equal(plan.project, project);
  assert(resolve(plan.source).startsWith(resolve(s.projects.get(project).root) + sep));
  assert.equal(plan.output, join(directory, 'physical-observation.json'));
  assert.equal(plan.starts, join(directory, 'physical-starts.jsonl'));
  const operation = s.db.coordination.getOperation(project, plan.request.id);
  assert.equal(operation?.state, 'uncertain');
  assert.equal(operation.inputHash, plan.request.inputHash);
  await assert.rejects(
    s.coordinators.execute(plan.request, () => observe(s, plan)),
    CoordinationPending,
  );
  const result = JSON.parse(await readFile(plan.output, 'utf8'));
  assert.equal(result.project, project);
  assert.equal(result.operation, plan.request.id);
  assert.equal(result.source, plan.source);
  assert.equal(result.hash, plan.hash);
  assert.equal(await hashFile(plan.source), plan.hash);
  await s.runs['engine'].processes.stop(plan.owner);
  s.coordinators.reconcile(
    project,
    plan.request.id,
    { code: 'physical_observation_verified', refs: [operation.subject], fingerprint: plan.hash },
    'succeeded',
  );
  const replay = await s.coordinators.execute(plan.request, () => observe(s, plan), {
    replay: async () => JSON.parse(await readFile(plan.output, 'utf8')),
  });
  assert.deepEqual(replay, result);
  const starts = (await readFile(plan.starts, 'utf8')).trim().split(/\r?\n/);
  assert.equal(starts.length, 1);
  assert.equal(s.resources.holdings(project, plan.owner).length, 0);
  return {
    operation: plan.request.id,
    interruptedState: 'uncertain',
    verifiedHash: plan.hash,
    physicalExecutions: starts.length,
    replayPreserved: true,
    childExited: true,
  };
}
