import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { contextChatRequest, latestContext, readRuntimeJournal } from '@skaro/agent-runtime';
import {
  BUILTIN_CONTRACT_VERSIONS,
  type RuntimeModelRequest,
  type ModelTool,
} from '@skaro/timeline';
import type { Services } from '../app-services';
import type { BuiltinTaskAuthorization } from '../builtin-task-models';
import { TaskExecution } from '../task-execution';
import { registerTaskBudgetJournal } from '../credentials/task-budget-journals';
import { liveBudgetLedger } from '../credentials/live-budget-ledger';
import { quoteLiveRequest } from '../credentials/live-budget';
import { configuredPlanHistory } from './configured-plan-history';
import { actualWorkflowSource } from './task-workflow-review';
import { requireTaskWorkflowBudget, requireTaskWorkflowStep } from './task-workflow-budget';
import { TASK_WORKFLOW_HASH, type TaskWorkflowPacket } from './task-workflow-packet';
import {
  workflowToolPolicy,
  requireAnimationIndex,
  workflowToolNames,
} from './task-workflow-tools';
import { prepareBuiltinTaskBrowser } from '../builtin-task-browser';
import { taskAgentInput } from '../task-agent-input';
import { taskBudgetSourceId } from '../credentials/task-budget-source';

export const workflowOwnerInput = (
  packet: TaskWorkflowPacket,
  review: number | boolean = false,
  runId?: string,
) => ({
  commandId: `workflow-${TASK_WORKFLOW_HASH.slice(0, 32)}-t006${review ? '-review' + (Number(review) > 1 ? '-' + review : '') : ''}${runId ? '-' + runId : ''}`,
  text: packet.wireComposition.ownerMessages[review ? 1 : 0]!,
});

/** TaskRunSessions remains the only runtime owner; no credentials leave its normal host. */
export function workflowModels(
  getServices: () => Services,
  data: string,
  packet: TaskWorkflowPacket,
  strict = false,
) {
  const generations: Parameters<BuiltinTaskAuthorization>[0][] = [];
  let runId: string | undefined;
  const ledger = join(data, 'verification/openrouter-ba4');
  let prior: Awaited<ReturnType<typeof configuredPlanHistory>>;
  const authorize: BuiltinTaskAuthorization = async (input) => {
    const services = getServices();
    assert(runId && prior);
    assert.deepEqual(input.scope, {
      kind: 'task',
      projectId: packet.project.id,
      taskId: 'T-006',
      runId,
    });
    assert.equal(generations.length, 0, 'No automatic recovery or second model generation');
    assert.equal(input.options.cwd, packet.project.root);
    assert.equal(input.options.permissionMode, 'ask');
    assert.equal(input.options.planFirst, false);
    const instructions = input.options.instructions!;
    assert(instructions);
    const pins = [
      {
        id: 'workflow-task',
        kind: 'constraint' as const,
        origin: 'host' as const,
        revision: TASK_WORKFLOW_HASH,
        text: instructions,
      },
      {
        id: 'workflow-scope',
        kind: 'constraint' as const,
        origin: 'host' as const,
        revision: TASK_WORKFLOW_HASH,
        text: JSON.stringify({
          sourceEdits: packet.actionProposal.sourceEdits,
          commands: packet.actionProposal.commands.slice(0, 2),
          prohibitions: packet.actionProposal.prohibitions,
        }),
      },
    ];
    const tools = workflowToolPolicy(packet, input.artifactDir, strict);
    const selectTools = async (catalog: readonly ModelTool[]) => {
      const journal = await readRuntimeJournal(input.journalPath, input.sessionId);
      const names = workflowToolNames(journal.records, strict);
      return names ? catalog.filter((tool) => names.includes(tool.name)) : catalog;
    };
    const browser = await prepareBuiltinTaskBrowser(
      input,
      tools.browserNames.map((name) => ({ name, readOnly: false })),
      true,
    );
    try {
      for (const actual of browser.extensions.tools) {
        const expected = packet.wireComposition.tools.browser.find(
          (item) => item.name === actual.name,
        );
        assert(expected);
        assert.deepEqual(actual.inputSchema, expected.inputSchema);
      }
      let gateStage = 'current-run';
      const current = async (signal: AbortSignal) => {
        gateStage = 'current-run';
        signal.throwIfAborted();
        assert.equal(services.db.listRuns(packet.project.id, 'T-006')[0]?.id, runId);
        gateStage = 'immutable-sources';
        for (const source of packet.wireComposition.sources) {
          const actual = await actualWorkflowSource(packet.project.root, source.path);
          if (source.path === 'index.html') requireAnimationIndex(source.text, actual.text);
          else if (source.path === '.skaro/tasks/T-006-animirovat-prohod-i-pryzhok-kota.md')
            assert.equal(
              actual.text.replace(/^status: in_progress$/m, 'status: todo'),
              source.text,
            );
          else assert.deepEqual(actual, source);
        }
        gateStage = 'checkers';
        for (const checker of packet.localGuards.checkerRevisions)
          assert.equal(
            createHash('sha256')
              .update(await readFile(checker.path))
              .digest('hex'),
            checker.sha256,
          );
        gateStage = 'route';
        const catalog = await services.modelCatalog.read(
          packet.wireComposition.route.connectionId,
          packet.wireComposition.route.connectionRevision,
        );
        assert.deepEqual(
          services.modelConfiguration.snapshot(
            packet.wireComposition.route.routeId,
            catalog.models,
          ),
          packet.wireComposition.route,
        );
        await input.admissions.requireActive(input.admissions.admission, signal);
      };
      const requireRequest = async (request: RuntimeModelRequest, signal: AbortSignal) => {
        await current(signal);
        gateStage = 'budget-primary-checkpoint';
        const sourceId = await registerTaskBudgetJournal({
          db: services.db,
          ledger,
          scope: input.scope,
          journal: input.journalPath,
          admission: input.admissions.admission,
          admissions: input.admissions,
          signal,
        });
        gateStage = 'prior-journals';
        assert.deepEqual(await configuredPlanHistory(ledger, `task:${sourceId}`), prior);
        assert(request.kind === 'chat');
        const journal = await readRuntimeJournal(input.journalPath, input.sessionId);
        gateStage = 'context';
        assert.deepEqual(latestContext(journal)?.snapshot.pins, pins);
        assert.equal(
          latestContext(journal)?.snapshot.sources.length,
          0,
          'Unreviewed context sources',
        );
        const inputs = journal.records
          .flatMap((record) => record.facts)
          .filter((fact) => fact.type === 'input');
        assert(inputs.length >= 1 && inputs.length <= 40);
        inputs.forEach((item, index) => {
          const owner = workflowOwnerInput(packet, index, strict ? runId : undefined);
          assert.equal(item.id, `input-${owner.commandId}`);
          assert.deepEqual(item.input, taskAgentInput(owner));
        });
        const fresh = contextChatRequest(
          { journal },
          {
            route: packet.wireComposition.route,
            price: { prompt: 0.5, completion: 2, request: 0 },
            tools: tools.modelTools,
            messages: [{ role: 'user', content: inputs.at(-1)!.input.text }],
          },
        );
        const continuation = journal.state.continuation?.value as
          { messages?: unknown; context?: unknown } | undefined;
        const stored = continuation?.messages as typeof fresh.messages | undefined;
        const currentContinuation =
          stored &&
          stored[0]?.role === 'system' &&
          typeof stored[0].content === 'string' &&
          stored[0].content.includes(inputs.at(-1)!.id) &&
          JSON.stringify(continuation?.context) === JSON.stringify(fresh.context);
        const messages = currentContinuation ? stored : fresh.messages;
        gateStage = 'wire-envelope';
        const { toolChoice, ...body } = request.value;
        assert.equal(toolChoice, strict ? 'required' : undefined);
        assert.deepEqual(body, { ...fresh, messages, tools: await selectTools(tools.modelTools) });
        return liveBudgetLedger(ledger);
      };
      new TaskExecution(services.db, runId).stop();
      generations.push(input);
      return {
        config: {
          sessionId: input.sessionId,
          journalPath: input.journalPath,
          route: packet.wireComposition.route,
          permissionMode: 'ask',
          versions: BUILTIN_CONTRACT_VERSIONS,
          tools: {
            cwd: input.options.cwd,
            readDirs: [],
            readOnly: false,
            artifactDir: input.artifactDir,
          },
          context: { scopePath: '.', documents: [], pins },
        },
        price: { prompt: 0.5, completion: 2, request: 0 },
        maxSteps: 40,
        modelTools: tools.modelTools,
        tools: {
          ...tools.policy,
          async selectChatTools(catalog, signal) {
            signal?.throwIfAborted();
            const budget = await liveBudgetLedger(ledger);
            requireTaskWorkflowStep(packet.budgetProposal, budget);
            await tools.policy.selectChatTools!(catalog, signal);
            return selectTools(catalog);
          },
        },
        operations: tools.skaroNames.map((name) => ({ name, readOnly: name === 'get_c4_context' })),
        extensions: browser,
        requests: {
          async reserve(id, request, signal) {
            try {
              const budget = await requireRequest(request, signal);
              gateStage = 'quotation-budget';
              assert(request.kind === 'chat');
              const quote = quoteLiveRequest(request.value, id);
              requireTaskWorkflowBudget(packet.budgetProposal, budget, quote.nanoUsd);
              return { ...quote };
            } catch (error) {
              process.send?.({ type: 'workflow-gate-rejected', phase: 'reserve', gateStage });
              throw error;
            }
          },
          async requireDispatch(_id, request, signal) {
            requireTaskWorkflowBudget(packet.budgetProposal, await requireRequest(request, signal));
          },
        },
      };
    } catch (error) {
      await browser.extensions.close();
      throw error;
    }
  };
  return {
    authorize,
    generations,
    async bind(id: string) {
      assert.equal(runId, undefined);
      runId = id;
      const sessionId = getServices().db.getRun(id)?.nativeSessionId;
      prior = await configuredPlanHistory(
        ledger,
        sessionId ? `task:${taskBudgetSourceId(id, sessionId)}` : '',
      );
    },
  };
}
