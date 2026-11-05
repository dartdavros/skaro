import { app } from 'electron';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { AppDb, runShell } from '@skaro/core';
import { setupEnvironmentTool } from '@skaro/mcp-server';
import { Projects } from '../projects';
import { TaskEnvironments } from '../task-environments';
import { setupProjectEnvironment } from '../project-environment-setup';

// Explicit owner authorization, 2026-11-05: Stolovka is the live target for initial setup.
// No app bootstrap, runtime reset, recovery or foreign project watchers are started.
app.setName('Skaro');
void app.whenReady().then(async () => {
  const dataDir = app.getPath('userData');
  const projectId = 'b1a0a1fc-5435-4b37-a30a-c2b3d6c06f1b';
  const key = { projectId, taskId: 'T-001' };
  const db = AppDb.open(join(dataDir, 'skaro.db'));
  let projects: Projects | undefined;
  let environments: TaskEnvironments | undefined;
  let started = false;
  let code = 1;
  try {
    db.shell.scopeTo(projectId);
    assert.equal(db.shell.get(projectId)?.name, 'Stolovka.pro');
    assert(
      ['idle', 'failed'].includes(db.getTaskRuntime(projectId).get(key.taskId)?.state ?? 'idle'),
      'Verification must not overlap an active task',
    );
    projects = new Projects(db, () => undefined);
    const context = projects.get(projectId);
    const artifacts = await context.load();
    assert(artifacts.tasks.some((task) => task.id === key.taskId && task.status !== 'done'));
    const run = db.listRuns(projectId, key.taskId)[0];
    assert(run?.worktree);
    assert.equal(run.worktree, join(dataDir, 'worktrees', projectId, key.taskId));
    const scope = { kind: 'task' as const, ...key, runId: run.id };
    const tool = setupEnvironmentTool((args, caller) =>
      setupProjectEnvironment(projects!, args, caller),
    );
    const read = await tool.call({}, scope);
    assert(!read.isError, read.text);
    const snapshot = JSON.parse(read.text.split('\n\n')[0]!);
    const before = await readFile(join(context.root, '.skaro', 'config.yaml'), 'utf8');
    const command = [
      'docker compose up -d --build --wait',
      'docker compose exec -T django python manage.py migrate --noinput',
      'docker compose exec -T django python manage.py check',
      'docker compose exec -T redis redis-cli ping',
      'docker compose exec -T django python manage.py shell -c "from django.db import connection; connection.ensure_connection(); print(connection.vendor)"',
      'docker compose exec -T django python -c "import urllib.request; assert urllib.request.urlopen(\'http://127.0.0.1:8000/health/\').status == 200"',
    ].join(' && ');
    const environment = {
      start: command,
      ports: [],
      env: { COMPOSE_FILE: 'backend/compose.yaml' },
      urls: {},
    };
    if (!snapshot.environment) {
      const saved = await tool.call({ environment, expected_revision: snapshot.revision }, scope);
      assert(!saved.isError, saved.text);
    } else
      assert.deepEqual(snapshot.environment, environment, 'Never replace an existing declaration');
    const reloaded = await context.store.setupEnvironment();
    assert.deepEqual(reloaded.environment, environment);
    const refused = await tool.call({ environment, expected_revision: reloaded.revision }, scope);
    assert(refused.isError, 'Existing config must not be overwritten');
    environments = new TaskEnvironments({
      db,
      projects,
      dataDir,
      projectScope: projectId,
      busy: () => [key],
      finished: async (candidate) => {
        const task = (await context.store.load()).tasks.find(
          (item) => item.id === candidate.taskId,
        );
        return !!task && ['done', 'cancelled'].includes(task.status);
      },
    });
    process.send?.({ stage: 'start', projectId, taskId: key.taskId });
    started = true;
    const first = await environments.start(key);
    const description = await environments.describe(key);
    assert.equal(first.name, 'skaro-stolovka-pro-t-001');
    assert(description.compose, 'Real Compose admission must run');
    const checks: string[] = [];
    await runShell(
      [
        'docker compose ps',
        'docker compose exec -T django python manage.py makemigrations --check --dry-run',
        'docker compose exec -T worker python -m pip check',
        'docker compose exec -T worker python -c "import celery, kombu, redis; print(celery.__version__, kombu.__version__, redis.__version__)"',
        'docker compose exec -T worker celery -A config inspect ping --timeout 15',
      ].join(' && '),
      {
        cwd: run.worktree,
        env: description.variables,
        output: (line) => checks.push(line),
      },
    );
    const firstCheckOutput = checks.at(-1);
    const second = await environments.start(key);
    assert.equal(second.name, first.name);
    await runShell('docker compose exec -T worker celery -A config inspect ping --timeout 15', {
      cwd: run.worktree,
      env: (await environments.describe(key)).variables,
      output: (line) => checks.push(line),
    });
    const directory = join(dataDir, 'verification', `environment-setup-${randomUUID()}`);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'proof.json'),
      JSON.stringify(
        {
          projectId,
          taskId: key.taskId,
          before,
          setupCreated: !snapshot.environment,
          overwriteRejected: true,
          first,
          second,
          checks: firstCheckOutput,
          restartCheck: checks.at(-1),
          acceptance: 'Environment launch only; no tenant acceptance, seed or user data created.',
        },
        null,
        2,
      ),
    );
    process.send?.({ stage: 'verified', directory, first, second });
    code = 0;
  } catch (error) {
    const directory = join(dataDir, 'verification', `environment-setup-failed-${randomUUID()}`);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'proof.json'),
      JSON.stringify(
        {
          projectId,
          taskId: key.taskId,
          outcome: 'failed',
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.send?.({
      stage: 'failed',
      directory,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (started) await environments?.stop(key);
    await environments?.idle();
    projects?.close();
    db.close();
    app.exit(code);
  }
});
