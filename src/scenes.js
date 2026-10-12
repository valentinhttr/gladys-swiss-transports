import { remaining } from './transport.js';

export const TRIGGERS = ['departure_soon', 'departure_delayed'];
export const SCENE_ACTION_KEYS = ['next_departure', 'next_connection', 'refresh'];

export function result(row, now) {
  return {
    found: Boolean(row),
    station: row?.station ?? '',
    destination: row?.destination ?? '',
    line: row?.line ?? '',
    departure: row ? new Date(row.expected).toISOString() : '',
    minutes: row ? remaining(row, now) : -1,
    delay_known: row?.delay !== null && row?.delay !== undefined,
    delay: row?.delay ?? 0,
    platform: row?.platform ?? '',
  };
}

// Deduplication is retained across SDK reconnects; bounded and memory-only.
export class SceneMonitor {
  constructor(now = Date.now) {
    this.now = now;
    this.sent = new Map();
  }

  async update(gladys, config, device, rows, isCurrent = () => true) {
    for (const [key, expires] of this.sent) if (expires < this.now()) this.sent.delete(key);
    for (const row of rows) {
      if (row.expected < this.now()) continue;
      for (const trigger of TRIGGERS) {
        const matches =
          trigger === 'departure_soon'
            ? remaining(row, this.now()) <= config.departure_window
            : row.delay !== null && row.delay >= config.delay_threshold;
        const key = `${device}:${trigger}:${row.id}`;
        if (!matches || this.sent.has(key) || !isCurrent()) continue;
        await gladys.publishSceneEvent(trigger, { device, ...result(row, this.now()) });
        this.sent.set(key, Math.max(row.expected, this.now()) + 86_400_000);
        if (this.sent.size > 5000) this.sent.delete(this.sent.keys().next().value);
      }
    }
  }
}
