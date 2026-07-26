export class HeavyJobQueue {
  private tail: Promise<void> = Promise.resolve();
  private active: string | null = null;

  status(): { active: string | null } { return { active: this.active }; }

  enqueue<T>(name: string, work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      this.active = name;
      try { return await work(); } finally { this.active = null; }
    });
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}
