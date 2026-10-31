import { expect, it } from 'vitest';
import { dialoguePlan, planningWorkspace } from './chat-planning-test-workspace';

it('settles an in-flight continuation before teardown and discards its cancelled wake', async () => {
  const w = await planningWorkspace();
  try {
    await w.engine.planning.prepare(w.live, dialoguePlan());
    // Force a real asynchronous artifact read rather than serving the cached snapshot.
    w.engine.project(w.live.projectId).invalidate();
    const continuation = w.engine.planningContinuation;
    continuation.schedule(w.live);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(w.live.planningSending).toBe(true);
    expect(w.live.planningPending).toBeDefined();
    continuation.schedule(w.live);
    expect(w.live.planningWake).toBe(true);
    continuation.userMessage(w.live);
    await continuation.settled(w.live);
    expect(w.live.planningPending).toBeUndefined();
    expect(w.live.planningSending).toBe(false);
    expect(w.live.planningWake).toBe(false);
    expect(w.live.planningTimer).toBeUndefined();
    expect(w.engine.planning.store(w.live).get('dialogue')!.state).toBe('active');
    expect(
      w.live.timeline.state.items.some((item) => item.kind === 'notice' && item.level === 'error'),
    ).toBe(false);
  } finally {
    await w.close();
  }
});
