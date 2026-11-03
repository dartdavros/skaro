interface Lease {
  connection: string;
  controller: AbortController;
  done: Promise<void>;
}

/** Trusted connector callbacks must settle on abort before privileged mutation can return. */
export class CredentialLeases {
  private readonly active = new Set<Lease>();

  open(connection: string, signal: AbortSignal) {
    const controller = new AbortController();
    let finish!: () => void;
    const lease: Lease = {
      connection,
      controller,
      done: new Promise<void>((resolve) => (finish = resolve)),
    };
    this.active.add(lease);
    return {
      signal: AbortSignal.any([signal, controller.signal]),
      close: () => {
        this.active.delete(lease);
        finish();
      },
    };
  }

  async revoke(connection?: string): Promise<void> {
    const selected = [...this.active].filter(
      (lease) => !connection || lease.connection === connection,
    );
    for (const lease of selected) lease.controller.abort();
    await Promise.all(selected.map((lease) => lease.done));
  }
}
