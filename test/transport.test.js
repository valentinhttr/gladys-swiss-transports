import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { TransportService, stopTimes, remaining } from '../src/transport.js';
import { NOW, board, journey, iso, connection } from './helpers/fixtures.js';
const config = normalizeConfig({ destination: 'Genève' });

test('validates configuration, numeric forms and invalid values', () => {
  assert.equal(normalizeConfig({ poll_frequency: '30' }).poll_frequency, 30);
  for (const patch of [
    { station: '' },
    { station: true },
    { station: 'a'.repeat(121) },
    { poll_frequency: 29 },
    { limit: 9 },
    { delay_threshold: false },
    { departure_window: 1.5 },
    { transportation: 'plane' },
    { limit: [2] },
    { poll_frequency: '0x20' },
    { limit: ' ' },
    { station: 'Bern\u007f' },
  ]) {
    assert.throws(() => normalizeConfig(patch));
  }
});

test('malformed delay values are unknown, invalid dates never depend on the host timezone', () => {
  for (const delay of [false, true, [], {}, ' ', 'NaN']) {
    assert.equal(stopTimes({ departure: iso(5), delay }).delay, null);
  }
  assert.equal(stopTimes(null).expected, null);
  assert.equal(stopTimes({ departure: '2026-10-12T12:00:00' }).expected, null);
  assert.equal(stopTimes({ departureTimestamp: 1e100 }).expected, null);
  assert.equal(stopTimes({ departure: iso(5), delay: 1e300 }).expected, null);
  assert.equal(stopTimes({ departure: iso(5), platform: { html: '<script>' } }).platform, '');
});

test('provider text and journey identities stay bounded and invalid arrivals remain unknown', async () => {
  const trip = connection();
  trip.to.arrival = iso(-1);
  trip.to.prognosis = {};
  delete trip.sections;
  const service = new TransportService(
    {
      get: async () => ({
        ...board([
          journey({
            name: 'N'.repeat(10000),
            to: 'D'.repeat(10000),
            stop: {
              ...journey().stop,
              prognosis: { ...journey().stop.prognosis, platform: 'P'.repeat(5000) },
            },
          }),
        ]),
        connections: [trip],
        stations: [
          { id: {}, name: 'Bad' },
          { id: '008500010', name: 'Basel\n SBB' },
        ],
      }),
    },
    () => NOW,
  );
  const [departure] = await service.departures(config);
  assert.equal(departure.id.length, 64);
  assert.equal(departure.destination.length, 120);
  assert.equal(departure.platform.length, 24);
  const [route] = await service.connections(config);
  assert.equal(route.arrival, null);
  assert.equal(route.duration, null);
  assert.equal(route.transfers, null);
  assert.deepEqual(await service.locations('Basel'), [{ id: '008500010', name: 'Basel SBB' }]);
});

test('prognosis overrides scheduled time and platform, missing delay stays unknown', () => {
  assert.deepEqual(stopTimes(journey().stop), {
    planned: NOW + 300_000,
    expected: NOW + 420_000,
    delay: 2,
    platform: '4',
  });
  assert.equal(stopTimes({ departure: iso(5), delay: null }).delay, null);
  assert.equal(stopTimes({ departure: iso(5), delay: 3 }).expected, NOW + 480_000);
  assert.equal(stopTimes({ departure: iso(5), prognosis: { departure: iso(4) } }).delay, -1);
  assert.equal(stopTimes({ departure: null }).expected, null);
  assert.equal(stopTimes({ departureTimestamp: NOW / 1000 }).expected, NOW);
});

test('stationboard filters past and malformed rows, orders by real departure and bounds results', async () => {
  const service = new TransportService(
    {
      get: async (endpoint, params) => {
        assert.equal(endpoint, 'stationboard');
        assert.equal(params['transportations[]'], 'train');
        return board([
          journey(),
          journey({ stop: { departure: iso(-2) } }),
          journey({ stop: { departure: iso(1) } }),
          journey({ stop: {} }),
          null,
        ]);
      },
    },
    () => NOW,
  );
  const rows = await service.departures({ ...config, transportation: 'train' }, { limit: 1 });
  assert.equal(rows.length, 1);
  assert.equal(remaining(rows[0], NOW), 1);
  assert.equal(rows[0].delay, null);
});

test('connections normalize arrival, duration, walking sections and transfers', async () => {
  const route = connection();
  route.sections.push({ walk: { duration: 10 } }, { journey: { name: 'IR' } });
  const service = new TransportService(
    {
      get: async (_endpoint, params) => {
        assert.equal(params.from, 'Lausanne');
        assert.equal(params.to, 'Genève');
        return { connections: [route] };
      },
    },
    () => NOW,
  );
  const [row] = await service.connections(config);
  assert.equal(row.duration, 45);
  assert.equal(row.transfers, 1);
  assert.equal(row.arrival, NOW + 52 * 60_000);
});

test('missing destination or malformed response fails, valid empty results remain empty', async () => {
  const service = new TransportService(
    { get: async () => ({ stationboard: [], connections: [] }) },
    () => NOW,
  );
  assert.deepEqual(await service.departures(config), []);
  await assert.rejects(service.connections(normalizeConfig()), /Missing to/);
  service.client.get = async () => ({});
  await assert.rejects(service.departures(config), /missing/);
  await assert.rejects(service.connections(config), /missing/);
});

test('station search excludes refinement results and preserves leading-zero IDs', async () => {
  const service = new TransportService({
    get: async (_endpoint, params, ttl) => {
      assert.equal(params.type, 'station');
      assert.equal(ttl, 300_000);
      return {
        stations: [
          { id: '008500010', name: 'Basel SBB' },
          { type: 'refine', name: 'Basel' },
          { name: 'Address' },
        ],
      };
    },
  });
  assert.equal((await service.locations('Basel'))[0].id, '008500010');
});
