import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIntegration, ACTION_KEYS } from '../src/integration.js';
import { WIDGET_KEYS } from '../src/widgets.js';
import { SCENE_ACTION_KEYS } from '../src/scenes.js';
import { normalizeConfig } from '../src/config.js';
import { buildDevices } from '../src/devices.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { NOW } from './helpers/fixtures.js';

function setup() {
  const gladys = createFakeGladys();
  const handlers = { actions: {}, scenes: {}, widgets: {}, widgetActions: {}, events: {} };
  const timers = new Set();
  const discoveries = [];
  const logs = [];
  Object.assign(gladys, {
    onScanRequest: (fn) => {
      handlers.scan = fn;
    },
    onPoll: (fn) => {
      handlers.poll = fn;
    },
    onAction: (key, fn) => {
      handlers.actions[key] = fn;
    },
    onSceneAction: (key, fn) => {
      handlers.scenes[key] = fn;
    },
    onWidgetGet: (key, fn) => {
      handlers.widgets[key] = fn;
    },
    onWidgetAction: (key, fn) => {
      handlers.widgetActions[key] = fn;
    },
    onConfigUpdated: (fn) => {
      handlers.config = fn;
    },
    on: (key, fn) => {
      handlers.events[key] = fn;
    },
    handleShutdown: (fn) => {
      handlers.shutdown = fn;
    },
    getConfig: async () => ({}),
    publishDiscoveredDevices: async (devices) => {
      discoveries.push(devices);
    },
  });
  const row = {
    id: '1',
    expected: NOW + 60_000,
    delay: null,
    station: 'Lausanne',
    destination: 'Genève',
    platform: '2',
    line: 'IC1',
  };
  const service = {
    now: () => NOW,
    departures: async () => [row],
    connections: async () => [{ ...row, arrival: NOW + 50 * 60_000, duration: 49, transfers: 0 }],
    locations: async () => [{ id: '8501120', name: 'Lausanne' }],
  };
  const integration = createIntegration(
    gladys,
    service,
    { warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    {
      setInterval: (fn) => {
        timers.add(fn);
        return fn;
      },
      clearInterval: (fn) => {
        timers.delete(fn);
      },
    },
  );
  return { gladys, handlers, service, integration, timers, discoveries, logs };
}

test('registers all handlers and publishes initial data on connection', async () => {
  const { handlers, gladys, discoveries, timers } = setup();
  assert.deepEqual(Object.keys(handlers.actions).sort(), [...ACTION_KEYS].sort());
  assert.deepEqual(Object.keys(handlers.scenes).sort(), [...SCENE_ACTION_KEYS].sort());
  assert.deepEqual(Object.keys(handlers.widgets).sort(), [...WIDGET_KEYS].sort());
  await handlers.events.connected();
  assert.equal(discoveries.length, 1);
  assert.equal(timers.size, 1);
  assert.equal(gladys.connectionStatuses.at(-1).connected, true);
  assert.equal(
    gladys.published.some((p) => p.featureExternalId.endsWith(':delay')),
    false,
  );
  assert.equal(gladys.published.find((p) => p.featureExternalId.endsWith(':delay_known')).state, 0);
  await handlers.events.connected();
  assert.equal(timers.size, 1);
  assert.equal(gladys.sceneEvents.length, 1);
  handlers.events.disconnected();
  assert.equal(timers.size, 0);
});

test('polling and scene refresh share one request and shutdown stops updates', async () => {
  const { handlers, integration, service, gladys, timers } = setup();
  await handlers.events.connected();
  let resolve;
  let calls = 0;
  service.departures = () => {
    calls += 1;
    return new Promise((r) => {
      resolve = r;
    });
  };
  const poll = handlers.poll(buildDevices(gladys, normalizeConfig())[0]);
  const action = handlers.scenes.refresh();
  assert.equal(calls, 1);
  resolve([]);
  await Promise.all([poll, action]);
  assert.equal(gladys.published.at(-1).state, 0);
  handlers.shutdown();
  assert.equal(timers.size, 0);
  await assert.rejects(integration.refresh(), /disconnected/);
});

test('config changes discover a route and old device polls fail clearly', async () => {
  const { handlers, discoveries, gladys } = setup();
  const old = buildDevices(gladys, normalizeConfig())[0];
  await handlers.config({ station: 'Bern', destination: 'Zürich HB' });
  assert.equal(discoveries[0].length, 2);
  assert.throws(() => handlers.poll(old), /no longer configured/);
  await assert.rejects(handlers.config({ poll_frequency: 1 }));
  assert.equal(discoveries.length, 1);
});

test('in-flight old data is not published after disconnect or config replacement', async () => {
  const { handlers, service, gladys } = setup();
  let resolve;
  service.departures = () =>
    new Promise((r) => {
      resolve = r;
    });
  const first = handlers.events.connected();
  await new Promise(setImmediate);
  handlers.events.disconnected();
  service.departures = async () => [];
  await handlers.config({ station: 'Bern' });
  const count = gladys.published.length;
  resolve([{ expected: NOW + 60_000, delay: 0 }]);
  await first;
  assert.equal(gladys.published.length, count);
});

test('slow getConfig does not restart a disconnected integration', async () => {
  const { handlers, gladys, timers, discoveries } = setup();
  let resolve;
  gladys.getConfig = () =>
    new Promise((r) => {
      resolve = r;
    });
  const connection = handlers.events.connected();
  handlers.events.disconnected();
  resolve({});
  await connection;
  assert.equal(timers.size, 0);
  assert.equal(discoveries.length, 0);
});

test('API failure marks data invalid, recovers and does not manufacture a delay', async () => {
  const { handlers, gladys, service, integration } = setup();
  await handlers.events.connected();
  service.departures = async () => {
    throw new Error('offline');
  };
  await assert.rejects(integration.refresh(), /failed/);
  assert.equal(gladys.connectionStatuses.at(-1).connected, false);
  assert.ok(gladys.published.at(-1).featureExternalId.endsWith(':data_valid'));
  assert.equal(gladys.published.at(-1).state, 0);
  service.departures = async () => [];
  await integration.refresh();
  assert.equal(gladys.connectionStatuses.at(-1).connected, true);
});

test('scene outputs match declared types; widget refresh rejects unknown actions', async () => {
  const { handlers } = setup();
  await handlers.events.connected();
  const departure = await handlers.scenes.next_departure({});
  assert.equal(departure.found, true);
  assert.equal(departure.delay_known, false);
  const route = await handlers.scenes.next_connection({});
  assert.equal(route.duration, 49);
  assert.equal(typeof route.arrival, 'string');
  await assert.rejects(handlers.widgetActions.departures('unknown'), /Unknown/);
  assert.ok((await handlers.actions.search_stations({ query: 'Lausanne' })).fr.includes('8501120'));
});

test('an obsolete initialization failure cannot mark a replacement configuration offline', async () => {
  const { handlers, service, gladys, timers } = setup();
  let reject;
  service.departures = () =>
    new Promise((_resolve, fail) => {
      reject = fail;
    });
  const first = handlers.events.connected();
  await new Promise(setImmediate);
  service.departures = async () => [];
  await handlers.config({ station: 'Bern' });
  const statuses = gladys.connectionStatuses.length;
  reject(new Error('old request failed'));
  await first;
  assert.equal(gladys.connectionStatuses.length, statuses);
  assert.equal(gladys.connectionStatuses.at(-1).connected, true);
  assert.equal(timers.size, 1);
});

test('scene and widget responses are discarded after configuration replacement', async () => {
  const { handlers, service } = setup();
  await handlers.events.connected();
  let resolve;
  const gate = new Promise((done) => {
    resolve = done;
  });
  service.departures = () => gate;
  const scene = assert.rejects(handlers.scenes.next_departure(), /Configuration changed/);
  const widget = assert.rejects(handlers.widgets.departures(), /Configuration changed/);
  service.departures = async () => [];
  await handlers.config({ station: 'Bern' });
  resolve([]);
  await Promise.all([scene, widget]);
  handlers.events.disconnected();
  await assert.rejects(handlers.widgets.departures(), /disconnected/);
});

test('a slow publication finishes before replacement discovery and never publishes old route data', async () => {
  const { handlers, gladys, service, integration, discoveries } = setup();
  await handlers.config({ destination: 'Genève' });
  const publishStates = gladys.publishStates;
  let release;
  gladys.publishStates = async (values) => {
    await new Promise((done) => {
      release = done;
    });
    return publishStates(values);
  };
  const previous = assert.rejects(integration.refresh(), /Configuration changed/);
  await new Promise(setImmediate);
  const count = discoveries.length;
  const replacement = handlers.config({ station: 'Bern' });
  await new Promise(setImmediate);
  assert.equal(discoveries.length, count);
  gladys.publishStates = publishStates;
  service.departures = async () => [];
  release();
  await Promise.all([previous, replacement]);
  assert.equal(discoveries.length, count + 1);
  assert.equal(gladys.connectionStatuses.at(-1).connected, true);
  assert.equal(gladys.published.at(-1).state, 0);
});

test('failed discovery stops monitoring and logs never include remote errors', async () => {
  const { handlers, gladys, timers, integration, logs } = setup();
  gladys.publishDiscoveredDevices = async () => {
    throw new Error('secret');
  };
  await handlers.events.connected();
  assert.equal(timers.size, 0);
  assert.equal(gladys.connectionStatuses.at(-1).connected, false);
  await assert.rejects(integration.refresh(), /disconnected/);
  assert.ok(logs.length > 0);
  assert.ok(!JSON.stringify(logs).includes('secret'));
  await assert.rejects(handlers.config({ station: 'Bern' }), /secret/);
  assert.equal(gladys.connectionStatuses.at(-1).connected, false);
  assert.equal(timers.size, 0);
});
