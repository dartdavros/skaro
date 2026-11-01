import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { app } from 'electron';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import {
  RuntimeSession,
  executeChatTurn,
  openRouterCatalog,
  type ChatResponse,
  type OpenRouterConnector,
} from '@skaro/agent-runtime';
import type { RuntimeProcessIdentity } from '@skaro/timeline';
import { catPilotState } from './cat-pilot-state';
import { createServices, type Services } from '../app-services';
import { closeBackground } from '../background/client';
import { longContextConfig } from '../credentials/long-context-config';
import { admitLiveRequest } from '../credentials/live-budget';
import { c4ReviewKey } from '../c4-review';
import { catPilotVerificationTarget } from './task-verification';
import {
  modelPlanInspection,
  modelPlanPayload,
  modelPlanToolAdmission,
  planPayloadHash,
  MODEL_PLAN_REJECTION,
} from './model-plan-request';

/** Requires separately approved exact payload hash; never called by local preparation probes. */
export async function verifyPreparedModelPlan(input: {
  connector: OpenRouterConnector;
  owner: RuntimeProcessIdentity;
  directory: string;
  payloadPath: string;
  expectedHash: string;
  signal: AbortSignal;
}) {
  assert(/^[a-f0-9]{64}$/.test(input.expectedHash));
  assert(app.requestSingleInstanceLock(), 'Skaro is already running');
  const data = app.getPath('userData');
  const root = await realpath(join(data, 'verification'));
  const path = await realpath(input.payloadPath);
  const rel = relative(root, path);
  const stat = await lstat(input.payloadPath);
  assert(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 65_536);
  const approved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(planPayloadHash(approved), input.expectedHash, 'Reviewed payload bytes changed');
  assert.equal(
    await realpath(input.directory),
    await realpath(join(data, 'verification/openrouter-ba4')),
  );
  const state = catPilotState(data);
  let services: Services | undefined;
  let session: RuntimeSession | undefined;
  try {
    services = await createServices(state, data, () => undefined);
    const target = await catPilotVerificationTarget(
      services,
      input.owner,
      'model-plan-cat-pilot',
      'verification-model-plan-no-active-run',
    );
    const config = longContextConfig(input.directory);
    config.sessionId = target.verification.admission.sessionId;
    // The existing $1 ledger scans session-*.jsonl here, including retained unknown reservations.
    config.journalPath = join(input.directory, 'session-plans.jsonl');
    config.context = undefined;
    config.tools = {
      cwd: target.context.root,
      readDirs: [],
      readOnly: true,
      artifactDir: join(input.directory, 'plan-artifacts'),
      verificationScope: target.verification.scope,
    };
    const current = await target.verification.acceptance.inspect(
      target.verification.admission,
      input.signal,
    );
    const payload = modelPlanPayload(current, config.route);
    assert.equal(
      planPayloadHash(payload),
      input.expectedHash,
      'Approved task view or policy changed',
    );
    const catalogue = (await openRouterCatalog(config.route.endpoint, input.signal)) as {
      id: string;
      supported_parameters: string[];
      pricing: { prompt: string; completion: string };
    }[];
    assert(
      catalogue.some(
        (model) =>
          model.id === config.route.modelId &&
          model.supported_parameters.includes('tools') &&
          model.supported_parameters.includes('tool_choice') &&
          Number(model.pricing.prompt) >= 0 &&
          Number(model.pricing.prompt) <= 0.0000005 &&
          Number(model.pricing.completion) >= 0 &&
          Number(model.pricing.completion) <= 0.000002,
      ),
      'The explicitly selected affordable tool route is unavailable',
    );
    const before = JSON.stringify(await target.context.store.readTask(target.task.id));
    const reviewKey = c4ReviewKey(target.context.id, target.task.id);
    const c4 = structuredClone(services.db.getSetting(reviewKey, null));
    session = await RuntimeSession.open(config, input.owner, undefined, target.verification);
    const id = `catpilot-plan-${input.expectedHash.slice(0, 16)}-sequential-v3`;
    const response = await executeChatTurn({
      id,
      session,
      connector: input.connector,
      request: payload.request,
      signal: input.signal,
      maxSteps: 6,
      toolAdmission: modelPlanToolAdmission(payload.inspection),
      admitRequest: async (requestId, request) => {
        // Rejected calls bypass projectResult. Only these static policy hints may
        // be transmitted; arbitrary provider/OS/tool diagnostics still stop the POST.
        for (const message of request.messages) {
          if (message.role === 'tool') {
            assert(typeof message.content === 'string', 'Tool result must be text');
            const value = JSON.parse(message.content);
            if (value.error) {
              assert.deepEqual(Object.keys(value), ['error']);
              assert(
                [MODEL_PLAN_REJECTION, 'Tool is not in the admitted model catalogue'].includes(
                  value.error,
                ),
                'Rejected tool diagnostics are outside the approved payload',
              );
            }
          }
        }
        const latest = await target.verification.acceptance.inspect(
          target.verification.admission,
          input.signal,
        );
        assert.equal(
          planPayloadHash(modelPlanInspection(latest)),
          planPayloadHash(payload.inspection),
          'Approved task view changed before POST',
        );
        assert.equal(dirname(session!.journal.state.config!.journalPath), input.directory);
        await admitLiveRequest(session!, request, requestId);
      },
    });
    assert.equal(response.finishReason, 'stop');
    const records = session.journal.records.filter(
      (record) => record.id.startsWith(`model-${id}-`) && record.id.endsWith(':result'),
    );
    const responses = records.map((record) => record.result.value as ChatResponse);
    const calls = responses.flatMap((result) => result.message.tool_calls ?? []);
    const successful = records.flatMap((record) => {
      const response = record.result.value as ChatResponse;
      return (response.message.tool_calls ?? []).flatMap((call) => {
        const toolId = createHash('sha256')
          .update(`${record.id.slice(0, -7)}:${call.id}`)
          .digest('hex');
        const result = session!.journal.find(`cmd:${toolId}`)?.result;
        return result && !result.error ? [{ name: call.function.name, id: toolId }] : [];
      });
    });
    for (const name of ['inspect_acceptance', 'plan_checks', 'assess_checks'])
      assert(
        successful.some((call) => call.name === name),
        `Missing successful genuine model tool: ${name}`,
      );
    const assessment = successful.findLast((call) => call.name === 'assess_checks')!;
    assert.equal(
      (
        session.journal.find(`verification-assessment:${assessment.id}`)!.result.value as {
          readyToSubmit: boolean;
        }
      ).readyToSubmit,
      false,
    );
    assert(
      responses.every((result) => result.provenance.actualModel && result.provenance.usage.cost),
    );
    assert.equal(Object.keys(session.journal.state.processes).length, 0);
    assert.equal(JSON.stringify(await target.context.store.readTask(target.task.id)), before);
    assert.deepEqual(services.db.getSetting(reviewKey, null), c4);
    const proof = {
      payloadHash: input.expectedHash,
      project: 'Cat-pilot',
      taskId: target.task.id,
      requests: responses.length,
      tools: calls.length,
      processes: 0,
      taskAndC4Unchanged: true,
      notice: 'Live model planning only; not an accepted task or successful check execution',
    };
    await session.journal.append(`proof:${id}`, [], { value: proof });
    return proof;
  } finally {
    const closed = await Promise.allSettled([
      session?.dispose(),
      ...(services
        ? [
            services.modelSettings.close(),
            services.runs.close(),
            services.chats.close(),
            services.mcp.close(),
            services.graph.close(),
            services.ci.close(),
          ]
        : []),
    ]);
    services?.projects.close();
    await closeBackground();
    state.db.close();
    assert(
      closed.every((result) => result.status === 'fulfilled'),
      'Verification shutdown was not confirmed',
    );
  }
}
