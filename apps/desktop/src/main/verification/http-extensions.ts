import assert from 'node:assert/strict';
import { bindSkaroOperations, connectMcpExtension } from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type { RuntimeProcessIdentity, SkaroScope } from '@skaro/timeline';
import type { Services } from '../app-services';
import { extensionSession, approvedTool } from './extension-session';

export async function verifyHttpExtensions(
  services: Services,
  directory: string,
  owner: RuntimeProcessIdentity,
) {
  const projects = services.db.shell
    .list()
    .filter((project) => project.name.toLowerCase() === 'cat-pilot');
  assert.equal(projects.length, 1, 'Exactly one real Cat-pilot project must be registered');
  const project = projects[0]!;
  const scope: SkaroScope = { kind: 'project_chat', projectId: project.id };
  const controller = new AbortController();
  const signal = controller.signal;
  const admission = {
    id: `extensions-${owner.pid}`,
    sessionId: 'extensions-direct',
    generation: 1,
  };
  const admissions = {
    async requireActive(value: typeof admission, signal: AbortSignal) {
      signal.throwIfAborted();
      assert.deepEqual(value, admission);
      assert.equal(await processBirth(owner.pid), owner.birth);
    },
  };
  const port = services.mcp.operations(scope, admissions);
  const unavailable = await port.catalog(admission, signal);
  assert(!unavailable.some((tool) => tool.name === 'submit_result'));
  await assert.rejects(
    port.execute({ admission, callId: 'outside', name: 'submit_result', args: {}, signal }),
    /outside/,
  );
  const allowed = [{ name: 'get_project_context', readOnly: false }];
  const direct = await bindSkaroOperations(port, admission, allowed, signal);
  const internal = await extensionSession(directory, 'internal', owner, direct);
  const grant = services.mcp.grant(scope);
  let remote: Awaited<ReturnType<typeof connectMcpExtension>> | undefined;
  let http: Awaited<ReturnType<typeof extensionSession>> | undefined;
  try {
    const first = await approvedTool(internal, 'context', direct.tools[0]!.name, {});
    assert(first.text.includes(project.name));
    remote = await connectMcpExtension({
      id: 'http',
      config: { type: 'http', url: grant.url, headers: grant.headers },
      cwd: process.cwd(),
      signal,
      allowed,
    });
    http = await extensionSession(directory, 'http', owner, remote);
    const result = await approvedTool(http, 'context', remote.tools[0]!.name, {});
    assert.equal(result.text, first.text);
    const count = http.journal.records.length;
    const repeated = await http.execute({
      id: 'context',
      action: { type: 'tool', name: remote.tools[0]!.name, args: {} },
    });
    assert.deepEqual(repeated.result.value, result);
    assert.equal(http.journal.records.length, count);
    const invalid = await http.execute({
      id: 'invalid',
      action: { type: 'tool', name: remote.tools[0]!.name, args: { projectId: 'other' } },
    });
    assert.match(invalid.result.error!, /Invalid/);
    assert.equal(http.journal.state.effects.invalid, undefined);
    const raw = JSON.stringify(http.journal.records);
    assert(!raw.includes(grant.headers.Authorization!));
    assert(!raw.includes(grant.headers.Authorization!.replace(/^Bearer /, '')));
    grant.revoke();
    const failure = await approvedTool(http, 'revoked', remote.tools[0]!.name, {});
    assert(failure === undefined, 'Revoked grant unexpectedly succeeded');
  } catch (error) {
    if (!http || http.journal.state.effects.revoked?.state !== 'unknown') throw error;
    const count = http.journal.records.length;
    const failed = await http.execute({
      id: 'revoked',
      action: { type: 'tool', name: remote!.tools[0]!.name, args: {} },
    });
    assert(failed.result.error);
    assert.equal(http.journal.records.length, count);
    return {
      realHandlers: true,
      exactHttpInternalResult: true,
      approvalBeforeIntent: true,
      scopeAndSchemaEnforced: true,
      revokedGrantUnknownNoReplay: true,
      journalCredentials: 0,
    };
  } finally {
    grant.revoke();
    controller.abort();
    await http?.dispose();
    await remote?.close();
    await internal.dispose();
  }
  throw new Error('Revoked grant failure was not observed');
}
