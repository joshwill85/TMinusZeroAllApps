type Listener = (nowMs: number) => void;

export class SharedTicker {
  private readonly intervalMs: number;
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(intervalMs = 1_000) {
    this.intervalMs = intervalMs;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    if (this.timer === null) {
      this.timer = setInterval(() => {
        const nowMs = Date.now();
        for (const entry of this.listeners) {
          entry(nowMs);
        }
      }, this.intervalMs);
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }
}
