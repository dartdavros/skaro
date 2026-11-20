/** Graph changes serialize. An admitted checkout cleanup excludes just its owners and graph-wide writes. */
export class TaskMutationQueue {
  private tail = Promise.resolve();
  private cleanup?: { owners: Set<string>; settled: Promise<void> };

  async run<T>(action: () => Promise<T>, owner?: string): Promise<T> {
    for (;;) {
      const step = this.tail.then(async () => {
        const cleanup = this.cleanup;
        if (cleanup && (!owner || cleanup.owners.has(owner)))
          return { blocked: true, wait: cleanup.settled } as const;
        return { blocked: false, result: await action() } as const;
      });
      this.tail = step.then(
        () => undefined,
        () => undefined,
      );
      const next = await step;
      if (!next.blocked) return next.result;
      await next.wait;
    }
  }

  async clean(owners: () => Set<string>, action: () => Promise<void>): Promise<void> {
    const { completion } = await this.run(async () => {
      const affected = owners();
      const completion = Promise.resolve()
        .then(action)
        .finally(() => {
          this.cleanup = undefined;
        });
      this.cleanup = { owners: affected, settled: completion.catch(() => undefined) };
      return { completion };
    });
    await completion;
  }
}
