import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createIntegration } from '../src/integration.js';
import { TransportService } from '../src/transport.js';
import { NOW, board, connection } from './helpers/fixtures.js';

test('official SDK accepts discovery, states, scenes and widget handlers across reconnects', async (t) => {
  let clock = NOW;
  t.mock.method(Date, 'now', () => clock);
  const gladys = createFakeGladys({ config: { destination: 'Genève', poll_frequency: 45 } });
  const service = new TransportService(
    {
      get: async () => ({
        ...board(),
        connections: [connection()],
        stations: [{ id: '008500010', name: 'Basel SBB' }],
      }),
    },
    () => NOW,
  );
  const timers = new Set();
  const integration = createIntegration(
    gladys,
    service,
    { warn() {}, error() {} },
    {
      setInterval: (fn) => {
        timers.add(fn);
        return fn;
      },
      clearInterval: (fn) => timers.delete(fn),
    },
  );
  t.after(() => gladys.fake.shutdown());
  await gladys.connect();
  assert.equal(gladys.fake.connectionStatus?.connected, true);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  assert.equal(timers.size, 1);
  const station = gladys.fake.discoveredDevices[0];
  const feature = (key) =>
    station.features.find((item) => item.external_id.endsWith(`:${key}`)).external_id;
  assert.equal(gladys.fake.lastState(feature('minutes')), 7);
  assert.equal(gladys.fake.lastState(feature('delay_known')), 1);
  let stateCount = gladys.fake.states.length;
  assert.deepEqual(await gladys.fake.poll(station), { success: true });
  assert.equal(gladys.fake.states.length, stateCount, 'unchanged states are not re-published');
  clock += 30 * 60_000;
  await integration.refresh();
  assert.equal(gladys.fake.states.length, stateCount * 2, 'heartbeat re-publishes stable values');
  stateCount = gladys.fake.states.length;
  await gladys.fake.deviceCreated(station);
  await integration.refresh();
  assert.equal(
    gladys.fake.states.length,
    stateCount + station.features.length,
    'newly added device receives its states',
  );
  const scene = await gladys.fake.sceneAction('next_departure');
  assert.equal(scene.success, true);
  assert.equal(scene.data.outputs.found, true);
  for (const key of ['departures', 'connections']) {
    for (const language of ['en', 'fr']) {
      const widget = await gladys.fake.widgetGet(key, { language });
      assert.equal(widget.success, true);
      assert.deepEqual(validateWidgetContent(widget.data.content), []);
      const form = widget.data.content.components.find((component) => component.action?.fields);
      assert.equal(form.action.key, 'search_stations');
    }
    assert.equal((await gladys.fake.widgetAction(key, 'refresh')).success, true);
    const found = await gladys.fake.widgetAction(
      key,
      'search_stations',
      {},
      { values: { query: 'Basel' } },
    );
    assert.equal(found.success, true);
    assert.match(found.data.message.fr, /008500010/);
    assert.equal(gladys.fake.config.station, undefined, 'search never changes configuration');
    const invalid = await gladys.fake.widgetAction(key, 'search_stations', { query: 'Basel' });
    assert.equal(invalid.success, false, 'params must not replace typed values');
  }
  const events = gladys.fake.sceneEvents.length;
  assert.ok(events > 0);
  await gladys.disconnect();
  assert.equal(timers.size, 0);
  stateCount = gladys.fake.states.length;
  await gladys.connect();
  assert.ok(gladys.fake.states.length > stateCount, 'reconnection forces a fresh publication');
  assert.equal(timers.size, 1);
  assert.equal(gladys.fake.sceneEvents.length, events);

  const departures = service.departures.bind(service);
  service.departures = async (...args) =>
    (await departures(...args)).map((row) => ({ ...row, delay: null }));
  const mock = t.mock.method(gladys, 'publishStates', async () => {
    throw new Error('offline');
  });
  await assert.rejects(integration.refresh(), /offline/);
  mock.mock.restore();
  await integration.refresh();
  assert.equal(gladys.fake.lastState(feature('delay_known')), 0, 'failed publication is retried');
  assert.equal(gladys.fake.lastState(feature('delay')), 2, 'unknown delay does not fabricate zero');
});
