// Tracks latency and error rate for external API calls.
// Module-level singleton; safe across concurrent requests in Node.js.

const WINDOW = 20; // rolling sample window

export interface EndpointStatus {
  healthy: boolean;
  avgMs: number;
  errorRate: number; // 0–1
  lastError?: { message: string; at: number };
}

interface Stats {
  latencies: number[];
  errors: number; // floating (decays on success)
  calls: number;
  lastError?: { message: string; at: number };
}

class ApiHealthTracker {
  private stats = new Map<string, Stats>();

  private get(key: string): Stats {
    let s = this.stats.get(key);
    if (!s) {
      s = { latencies: [], errors: 0, calls: 0 };
      this.stats.set(key, s);
    }
    return s;
  }

  record(key: string, latencyMs: number, errorMsg?: string): void {
    const s = this.get(key);
    s.calls++;
    s.latencies.push(latencyMs);
    if (s.latencies.length > WINDOW) s.latencies.shift();
    if (errorMsg) {
      s.errors = Math.min(s.errors + 1, WINDOW);
      s.lastError = { message: errorMsg.slice(0, 200), at: Date.now() };
    } else {
      // Decay error count gradually so recovery isn't instant but isn't stuck
      s.errors = Math.max(0, s.errors - 0.25);
    }
  }

  status(key: string): EndpointStatus {
    const s = this.get(key);
    const avgMs =
      s.latencies.length > 0
        ? Math.round(s.latencies.reduce((a, b) => a + b, 0) / s.latencies.length)
        : 0;
    const sampleSize = Math.min(s.calls, WINDOW);
    const errorRate = sampleSize > 0 ? s.errors / sampleSize : 0;
    const healthy = errorRate < 0.4 && (s.calls === 0 || avgMs < 8_000);
    return { healthy, avgMs, errorRate, lastError: s.lastError };
  }

  all(): Record<string, EndpointStatus> {
    const out: Record<string, EndpointStatus> = {};
    for (const key of this.stats.keys()) out[key] = this.status(key);
    return out;
  }

  isHealthy(key = 'orthogonal'): boolean {
    return this.status(key).healthy;
  }
}

export const apiHealth = new ApiHealthTracker();
