import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toolCatalog, type ChatRequest } from '@skaro/agent-runtime';
import type { RuntimeAcceptanceState, RouteSnapshot } from '@skaro/timeline';
import type { ModelToolAdmission } from '../../../../../packages/agent-runtime/src/models/model-tools';

const names = ['inspect_acceptance', 'plan_checks', 'assess_checks'];
export const planPayloadHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Only this projection may cross the model boundary; no file contents/absolute paths. */
export function modelPlanInspection(state: RuntimeAcceptanceState) {
  return {
    project: 'Cat-pilot',
    taskId: 'T-008',
    criteriaRevision: state.criteriaRevision,
    criteria: state.criteria.map(({ id, text, met }) => ({ id, text, met })),
    c4: state.c4,
    continuation: state.continuation,
    reasons: state.reasons,
  };
}

export function modelPlanPayload(state: RuntimeAcceptanceState, route: RouteSnapshot) {
  const request: ChatRequest = {
    route,
    price: { prompt: 0.5, completion: 2, request: 0 },
    tools: toolCatalog()
      .filter((tool) => names.includes(tool.name))
      .map((tool) => ({
        name: tool.name,
        parameters: tool.inputSchema,
        description:
          'Read-only authoritative verification inspection/proposal; no execution or submission.',
      })),
    messages: [
      {
        role: 'user',
        content:
          'Read-only plan protocol check for the registered Cat-pilot task T-008. Call inspect_acceptance first. ' +
          'Then call plan_checks with the exact returned criteriaRevision, checks: [], and an uncovered entry ' +
          'for every returned criterion ID with a short reason (at most 512 characters). No checks have been ' +
          'authorized for execution in this task scope, so do not invent coverage or a successful result. ' +
          'Then call assess_checks with the same revision and all criterion verdicts met:false, evidence:[]. ' +
          'Finally report that the plan is provisional and the task is not ready. Do not read files, execute ' +
          'commands, submit results, use other tools, request credentials, or claim completion.',
      },
    ],
  };
  return {
    schema: 1,
    kind: 'cat-pilot-model-plan',
    inspection: modelPlanInspection(state),
    request,
  };
}

export async function prepareModelPlan(
  directory: string,
  state: RuntimeAcceptanceState,
  route: RouteSnapshot,
) {
  const payload = modelPlanPayload(state, route);
  const path = join(directory, 'model-plan-payload.json');
  await writeFile(path, JSON.stringify(payload, null, 2), { mode: 0o600, flag: 'wx' });
  return {
    path,
    sha256: planPayloadHash(payload),
    criteria: payload.inspection.criteria.length,
    allowedTools: names,
    rawSourceFiles: 0,
    modelRequests: 0,
  };
}

/** Explicit projection of genuine tools, never substitute results or authority from model text. */
export function modelPlanToolAdmission(
  inspection: ReturnType<typeof modelPlanInspection>,
): ModelToolAdmission {
  const ids = inspection.criteria.map((item) => item.id);
  return {
    revision: planPayloadHash(inspection),
    requireAllowed(name, raw) {
      assert(names.includes(name));
      const args = raw as {
        checks?: unknown[];
        uncovered?: { id: string; reason: string }[];
        criteriaRevision?: string;
        verdicts?: { id: string; met: boolean; evidence: unknown[] }[];
      };
      if (name === 'inspect_acceptance') {
        assert.deepEqual(raw, {});
        return;
      }
      assert.equal(args.criteriaRevision, inspection.criteriaRevision);
      if (name === 'plan_checks') {
        assert.deepEqual(args.checks, []);
        assert.deepEqual(args.uncovered?.map((item) => item.id).sort(), [...ids].sort());
        assert(
          args.uncovered?.every((item) => item.reason.length > 0 && item.reason.length <= 512),
        );
      } else {
        assert.deepEqual(args.verdicts?.map((item) => item.id).sort(), [...ids].sort());
        assert(args.verdicts?.every((item) => item.met === false && item.evidence.length === 0));
      }
    },
    projectResult(result) {
      if (result.error) return { error: 'Verification tool rejected the request' };
      const value = result.value as Record<string, unknown>;
      if (value.kind === 'verification-plan')
        return { plan: value.plan, uncovered: value.uncovered, limitations: value.limitations };
      if (value.kind === 'verification-assessment')
        return {
          readyToSubmit: value.readyToSubmit,
          criteriaRevision: value.criteriaRevision,
          reasons: value.reasons,
        };
      const projected = modelPlanInspection(value as unknown as RuntimeAcceptanceState);
      assert.equal(
        planPayloadHash(projected),
        planPayloadHash(inspection),
        'Approved task view changed',
      );
      return projected;
    },
  };
}
