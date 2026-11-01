import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { readRuntimeJournal } from '@skaro/agent-runtime';
import {
  operationTimeout,
  type AgentSession,
  type BuiltinSessionStart,
  type RuntimeModelInputPort,
  type SessionOptions,
  type TimelineEvent,
} from '@skaro/timeline';
import type { Services } from '../app-services';
import type { NativeAdmissions } from '../native/admissions';
import { prepareConfiguredModelHost } from '../builtin-configured-host';
import { modelNetworkTransport } from '../model-network-transport';
import { startBuiltinNativeSession } from '../native/bundled';

/** One genuine native generation: current journal baseline, host binding and confirmed teardown. */
export async function configuredNativeSession(input: {
  services: Services;
  config: BuiltinSessionStart;
  lease: NativeAdmissions;
  options: SessionOptions;
  directory: string;
  ownerInput?: RuntimeModelInputPort;
  observe?: (event: TimelineEvent) => void;
  requests: Parameters<typeof prepareConfiguredModelHost>[0]['requests'];
}) {
  const { services, config, lease } = input;
  assert(config.model);
  const baseline = await readRuntimeJournal(config.journalPath, config.sessionId, true);
  const configured = await prepareConfiguredModelHost({
    store: services.modelConfiguration,
    settings: services.modelSettings,
    binding: {
      scope: config.model.scope,
      admission: lease.admission,
      route: config.route,
      journalPath: config.journalPath,
      baseSequence: baseline.records.length,
      baseHash: baseline.records.at(-1)?.hash ?? '',
      policy: config.model,
    },
    admissions: lease,
    ownerInput: input.ownerInput,
    signal: lease.signal,
    transport: await modelNetworkTransport(process.env['SKARO_VERIFY_PROXY']),
    requests: input.requests,
  });
  const events: TimelineEvent[] = [];
  let session: AgentSession | undefined;
  let drain: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  return {
    model: configured.model,
    events,
    async start() {
      if (session || closing) throw new Error('Native probe generation already started or closed');
      const previous = input.options.processStarted!;
      const actual = (session = await startBuiltinNativeSession(
        config,
        join(input.directory, 'native-attachments'),
        {
          ...input.options,
          processStarted(pid, identity) {
            assert(identity);
            previous(pid, identity);
            lease.recordOwnership({ pid, ...identity });
          },
        },
        {
          signal: configured.signal,
          model: configured.model,
          verification: {
            scope: config.model!.scope,
            admission: lease.admission,
            acceptance: services.runs.builtinAcceptance(config.model!.scope, lease),
          },
        },
        resolve('apps/desktop/out/main'),
      ));
      drain = (async () => {
        for await (const event of actual.events) {
          events.push(event);
          input.observe?.(event);
        }
      })();
      await lease.requireActive(lease.admission, lease.signal);
      return actual;
    },
    close() {
      closing ??= (async () => {
        configured.close();
        try {
          if (session) {
            await assert.rejects(
              session.send({ text: 'Rejected after configured close' }),
              /closed/,
            );
            await operationTimeout(
              drain!,
              45_000,
              'Configured authority did not close its native event stream',
            );
            await session.close();
          }
        } finally {
          await lease.revoke(lease.admission, 'Configured generation cleanup');
          await session?.close();
          await drain;
          await lease.confirmExit(lease.admission);
        }
      })();
      return closing;
    },
  };
}
