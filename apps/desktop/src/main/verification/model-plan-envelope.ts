import assert from 'node:assert/strict';
import type { ChatRequest } from '@skaro/timeline';
import { MODEL_PLAN_REJECTION, planPayloadHash, type modelPlanPayload } from './model-plan-request';

/** The reviewed initial payload plus only approved schemas/projections on continuation. */
export function requireModelPlanEnvelope(
  request: ChatRequest,
  payload: ReturnType<typeof modelPlanPayload>,
) {
  assert.equal(planPayloadHash(request.route), planPayloadHash(payload.request.route));
  assert.deepEqual(request.price, payload.request.price);
  assert.deepEqual(
    request.messages.slice(0, payload.request.messages.length),
    payload.request.messages,
  );
  for (const tool of request.tools ?? [])
    assert(
      payload.request.tools!.some((entry) => planPayloadHash(entry) === planPayloadHash(tool)),
    );
  for (const message of request.messages) {
    if (message.role !== 'tool') continue;
    assert.equal(typeof message.content, 'string');
    const value = JSON.parse(message.content!);
    if (value.error) {
      assert.deepEqual(Object.keys(value), ['error']);
      assert(
        [MODEL_PLAN_REJECTION, 'Tool is not in the admitted model catalogue'].includes(value.error),
      );
    }
  }
}
