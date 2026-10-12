const BASE_URL = 'https://transport.opendata.ch/v1/';
const MAX_BYTES = 2 * 1024 * 1024;

// A single client is shared by polling, scenes and widgets. Even manual refresh
// respects the cache. Failures are cached briefly; 429 backs off all endpoints.
export class TransportClient {
  constructor({ fetchImpl = fetch, now = Date.now, timeout = 3500 } = {}) {
    this.fetch = fetchImpl;
    this.now = now;
    this.timeout = timeout;
    this.cache = new Map();
    this.pending = new Map();
    this.blockedUntil = 0;
  }

  async get(endpoint, params, ttl = 30_000) {
    if (!['locations', 'stationboard', 'connections'].includes(endpoint)) {
      throw new Error('Unsupported Transport API endpoint.');
    }
    const url = new URL(endpoint, BASE_URL);
    for (const [key, value] of Object.entries(params).sort()) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    const key = url.href;
    const cached = this.cache.get(key);
    if (cached?.expires > this.now()) {
      if (cached.error) throw cached.error;
      return cached.value;
    }
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.now() < this.blockedUntil) throw new Error('Transport API rate limited; retry later.');
    if (this.pending.size >= 8) throw new Error('Transport API busy; retry shortly.');
    const request = this.request(url)
      .then(
        (value) => {
          this.remember(key, { value, expires: this.now() + ttl });
          return value;
        },
        (error) => {
          this.remember(key, { error, expires: this.now() + 30_000 });
          throw error;
        },
      )
      .finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  remember(key, entry) {
    this.cache.delete(key);
    this.cache.set(key, entry);
    if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
  }

  async request(url) {
    try {
      const response = await this.fetch(url, {
        signal: AbortSignal.timeout(this.timeout),
        redirect: 'error',
      });
      if (response.status === 429) {
        const retry = response.headers.get('retry-after');
        const seconds = /^\d+$/.test(retry ?? '')
          ? Number(retry)
          : (Date.parse(retry) - this.now()) / 1000;
        this.blockedUntil = Math.max(
          this.blockedUntil,
          this.now() + Math.max(30, Number.isFinite(seconds) ? seconds : 60) * 1000,
        );
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Transport API HTTP ${response.status}.`);
      }
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) throw new Error('Transport API response too large.');
          chunks.push(Buffer.from(value));
        }
      } finally {
        await reader.cancel();
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data) || data.errors || data.error) {
        throw new Error('Invalid Transport API response.');
      }
      return data;
    } catch (error) {
      if (['TimeoutError', 'AbortError'].includes(error.name)) {
        throw new Error('Transport API request timed out.', { cause: error });
      }
      // Never expose remote response bodies, request locations or SDK tokens.
      if (
        error.message.startsWith('Transport API') ||
        error.message === 'Invalid Transport API response.'
      )
        throw error;
      throw new Error('Transport API unavailable or returned invalid JSON.', { cause: error });
    }
  }
}
