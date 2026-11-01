import type { RuntimeJournal } from '../journal.ts';
import type { PathScope } from '../tools/path-scope.ts';
import type { ToolArgs } from '../tools/schemas.ts';
import { RuntimeContext } from '../context/service.ts';
import { latestContext } from '../context/checkpoint.ts';
import { captureCheckInputs, fingerprint } from './inputs.ts';
import { inspectVerificationHost, type RuntimeVerificationHost } from './host.ts';
import { checkPlan } from './schemas.ts';

async function currentContext(
  journal: RuntimeJournal,
  revision: string | undefined,
  signal: AbortSignal,
) {
  const context = await RuntimeContext.create(journal);
  if (!context) {
    if (revision) throw new Error('Verification plan context is unavailable');
    return undefined;
  }
  const latest = latestContext(journal);
  if (!latest || (revision && revision !== latest.snapshot.revision))
    throw new Error('Verification plan context is stale; refresh and plan again');
  return (await context.requireCurrent(latest.snapshot.revision, latest.epoch, signal)).snapshot;
}

/** A model proposal with exact host/context provenance, never proof of sufficient coverage. */
export async function recordCheckPlan(
  id: string,
  raw: unknown,
  scope: PathScope,
  journal: RuntimeJournal,
  host: RuntimeVerificationHost | undefined,
  signal: AbortSignal,
) {
  const input = checkPlan.parse(raw);
  const before = await inspectVerificationHost(journal, scope, host, signal);
  if (input.criteriaRevision !== before.criteriaRevision)
    throw new Error('Criterion revision changed; inspect acceptance and plan again');
  const known = new Set(before.criteria.map((item) => item.id));
  const covered = input.checks.flatMap((item) => item.criteria);
  const uncovered = input.uncovered.map((item) => item.id);
  if (
    new Set(input.checks.map((item) => item.id)).size !== input.checks.length ||
    input.checks.some((item) => new Set(item.criteria).size !== item.criteria.length) ||
    new Set(uncovered).size !== uncovered.length
  )
    throw new Error('Duplicate check or criterion identity in verification plan');
  if (
    [...covered, ...uncovered].some((item) => !known.has(item)) ||
    [...known].some((item) => !covered.includes(item) && !uncovered.includes(item)) ||
    uncovered.some((item) => covered.includes(item))
  )
    throw new Error('Plan must map every authoritative criterion to checks or an uncovered reason');
  const context = await currentContext(journal, undefined, signal);
  const inputs = await captureCheckInputs(scope, signal);
  const checks = await Promise.all(
    input.checks.map(async (item) => ({
      ...item,
      cwd: await scope.path(item.cwd ?? '.', true),
      shell: item.shell ?? 'powershell',
    })),
  );
  const after = await inspectVerificationHost(journal, scope, host, signal);
  if (
    fingerprint(before) !== fingerprint(after) ||
    fingerprint(inputs) !== fingerprint(await captureCheckInputs(scope, signal))
  )
    throw new Error('Verification plan inputs changed during inspection');
  await currentContext(journal, context?.revision, signal);
  const value = {
    kind: 'verification-plan',
    schema: 1,
    origin: 'model',
    binding: after.binding!,
    criteriaRevision: after.criteriaRevision,
    inputs,
    checks,
    uncovered: input.uncovered,
    context: context && {
      revision: context.revision,
      sources: context.sources.map(({ id, path, kind, revision }) => ({
        id,
        path,
        kind,
        revision,
      })),
    },
    limitations: [
      'Coverage is a model proposal, not acceptance evidence',
      ...(!context ? ['Project context is not configured'] : []),
    ],
  };
  const record = await journal.append(`verification-plan:${id}:result`, [], { value });
  return { ...value, plan: { sequence: record.sequence, hash: record.hash } };
}

export async function requirePlannedCheck(
  input: ToolArgs<'run_check'>,
  cwd: string,
  scope: PathScope,
  journal: RuntimeJournal,
  host: RuntimeVerificationHost | undefined,
  signal: AbortSignal,
) {
  if (!input.plan) return;
  const record = journal.records[input.plan.sequence - 1];
  const plan = record?.result.value as
    Omit<Awaited<ReturnType<typeof recordCheckPlan>>, 'plan'> | undefined;
  if (
    !record ||
    record.hash !== input.plan.hash ||
    !record.id.startsWith('verification-plan:') ||
    !record.id.endsWith(':result') ||
    plan?.kind !== 'verification-plan' ||
    plan.schema !== 1
  )
    throw new Error('Unknown verification plan reference');
  const step = plan.checks.find((item) => item.id === input.plan!.stepId);
  if (
    !step ||
    step.command !== input.command ||
    step.name !== input.name ||
    step.cwd !== cwd ||
    step.shell !== (input.shell ?? 'powershell') ||
    step.timeoutMs !== input.timeoutMs ||
    fingerprint([...step.criteria].sort()) !== fingerprint([...input.criteria].sort())
  )
    throw new Error('Check differs from its planned command or criterion coverage');
  const current = await inspectVerificationHost(journal, scope, host, signal);
  if (
    plan.criteriaRevision !== current.criteriaRevision ||
    fingerprint(plan.binding.scope) !== fingerprint(current.binding!.scope)
  )
    throw new Error('Verification plan criteria or task binding changed');
  if (current.binding!.execution !== 'allowed')
    throw new Error('The bound task does not admit check execution');
  if (!plan.context) throw new Error('Planned task execution requires current project context');
  await currentContext(journal, plan.context.revision, signal);
}
