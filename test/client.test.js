import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TransportClient } from '../src/client.js';
import { jsonResponse } from './helpers/fixtures.js';

test('uses HTTPS without authentication, encodes queries and shares concurrent cache', async () => {
  let calls = 0;
  let time = 0;
  const client = new TransportClient({
    now: () => time,
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url.origin, 'https://transport.opendata.ch');
      assert.equal(url.searchParams.get('station'), 'Zürich & Bern');
      assert.equal(options.headers, undefined);
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      return jsonResponse({ stationboard: [] });
    },
  });
  await Promise.all(
    Array.from({ length: 5 }, () => client.get('stationboard', { station: 'Zürich & Bern' })),
  );
  await client.get('stationboard', { station: 'Zürich & Bern' });
  assert.equal(calls, 1);
  time = 30_001;
  await client.get('stationboard', { station: 'Zürich & Bern' });
  assert.equal(calls, 2);
});

for (const retry of ['120', new Date(120_000).toUTCString()]) {
  test(`429 respects Retry-After ${retry} across endpoints`, async () => {
    let time = 0;
    let calls = 0;
    const client = new TransportClient({
      now: () => time,
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? jsonResponse({}, { status: 429, headers: { 'retry-after': retry } })
          : jsonResponse({ stations: [] });
      },
    });
    await assert.rejects(client.get('stationboard', {}), /429/);
    time = 60_000;
    await assert.rejects(client.get('locations', {}), /rate limited/);
    assert.equal(calls, 1);
    time = 120_001;
    await client.get('locations', {});
    assert.equal(calls, 2);
  });
}

test('does not hammer failed requests, retries after failure cache expires', async () => {
  let time = 0;
  let calls = 0;
  const client = new TransportClient({
    now: () => time,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({}, { status: 503 }) : jsonResponse({ stationboard: [] });
    },
  });
  await assert.rejects(client.get('stationboard', {}), /503/);
  await assert.rejects(client.get('stationboard', {}), /503/);
  assert.equal(calls, 1);
  time = 30_001;
  await client.get('stationboard', {});
  assert.equal(calls, 2);
});

test('bounds cache, response body and concurrent requests', async () => {
  const client = new TransportClient({ fetchImpl: async () => jsonResponse({ stations: [] }) });
  for (let i = 0; i < 110; i += 1) await client.get('locations', { query: i });
  assert.equal(client.cache.size, 100);
  const large = new TransportClient({
    fetchImpl: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)),
  });
  await assert.rejects(large.get('locations', {}), /too large/);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const busy = new TransportClient({
    fetchImpl: async () => {
      await gate;
      return jsonResponse({});
    },
  });
  const requests = Array.from({ length: 8 }, (_, query) => busy.get('locations', { query }));
  await assert.rejects(busy.get('locations', { query: 9 }), /busy/);
  release();
  await Promise.all(requests);
});

test('handles timeouts, invalid JSON and API errors without leaking body', async () => {
  for (const fetchImpl of [
    async () => {
      throw new DOMException('secret', 'TimeoutError');
    },
    async () => new Response('secret'),
    async () => jsonResponse({ errors: [{ message: 'secret' }] }),
    async () => jsonResponse([]),
  ]) {
    const client = new TransportClient({ fetchImpl });
    await assert.rejects(client.get('locations', {}), (error) => !error.message.includes('secret'));
  }
  await assert.rejects(new TransportClient().get('https://example.com', {}), /Unsupported/);
});

test('concurrent 429 responses cannot shorten an existing cooldown', async () => {
  let time = 0;
  const releases = [];
  const client = new TransportClient({
    now: () => time,
    fetchImpl: () => new Promise((resolve) => releases.push(resolve)),
  });
  const first = assert.rejects(client.get('locations', { query: 'Lausanne' }), /429/);
  const second = assert.rejects(client.get('locations', { query: 'Bern' }), /429/);
  releases[0](jsonResponse({}, { status: 429, headers: { 'retry-after': '120' } }));
  await first;
  releases[1](jsonResponse({}, { status: 429, headers: { 'retry-after': '30' } }));
  await second;
  time = 60_000;
  await assert.rejects(client.get('connections', { from: 'Lausanne', to: 'Bern' }), /rate limited/);
  assert.equal(releases.length, 2);
});
