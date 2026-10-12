import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { getWidget, stationSearchMessage, WIDGET_KEYS } from '../src/widgets.js';
import { SceneMonitor, TRIGGERS, SCENE_ACTION_KEYS, result } from '../src/scenes.js';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/config.js';
import { buildDevices, deviceIds } from '../src/devices.js';
import { TransportService } from '../src/transport.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { NOW, board, connection } from './helpers/fixtures.js';
import { ACTION_KEYS } from '../src/integration.js';
const config = normalizeConfig({ destination: 'Genève', delay_threshold: 2 });
const service = new TransportService(
  { get: async () => ({ ...board(), connections: [connection()] }) },
  () => NOW,
);
const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url)),
);

for (const language of ['en', 'fr']) {
  for (const key of WIDGET_KEYS) {
    test(`${key} widget satisfies SDK contract in ${language}`, async () => {
      const content = await getWidget(service, key, config, { language });
      assert.deepEqual(validateWidgetContent(content), []);
      assert.match(content.components[0].items[0].title, /12:07/);
      assert.ok(content.components[0].items[0].description.includes('4'));
    });
  }
}

test('widget empty, unconfigured and offline states are valid and explicit', async () => {
  for (const [svc, key, cfg] of [
    [{ departures: async () => [] }, 'departures', config],
    [
      {
        departures: async () => {
          throw new Error('offline');
        },
      },
      'departures',
      config,
    ],
    [service, 'connections', normalizeConfig()],
  ]) {
    const content = await getWidget(svc, key, cfg);
    assert.deepEqual(validateWidgetContent(content), []);
    assert.equal(content.components[0].type, 'text');
  }
});

test('widgets bound long API strings and unknown realtime remains visible', async () => {
  const row = {
    ...(await service.departures(config))[0],
    station: 'S'.repeat(200),
    destination: 'D'.repeat(200),
    line: 'L'.repeat(200),
    delay: null,
  };
  const content = await getWidget(
    { departures: async () => [row], now: () => NOW },
    'departures',
    config,
  );
  assert.deepEqual(validateWidgetContent(content), []);
  assert.match(content.components[0].items[0].description, /unavailable/);
});

test('triggers fire once per journey and threshold, and new journeys still trigger', async () => {
  const gladys = createFakeGladys();
  const monitor = new SceneMonitor(() => NOW);
  const rows = await service.departures(config);
  await monitor.update(gladys, config, 'station:1', rows);
  await monitor.update(gladys, config, 'station:1', rows);
  assert.deepEqual(
    gladys.sceneEvents.map((e) => e.key),
    TRIGGERS,
  );
  await monitor.update(gladys, config, 'station:1', [{ ...rows[0], id: 'another', delay: null }]);
  assert.equal(gladys.sceneEvents.length, 3);
  assert.equal(gladys.sceneEvents[2].data.delay_known, false);
});

test('out-of-window events and superseded refreshes do not trigger', async () => {
  const gladys = createFakeGladys();
  const monitor = new SceneMonitor(() => NOW);
  const rows = await service.departures(config);
  await monitor.update(
    gladys,
    { ...config, departure_window: 1, delay_threshold: 10 },
    'station:1',
    rows,
  );
  await monitor.update(gladys, config, 'station:1', rows, () => false);
  assert.equal(gladys.sceneEvents.length, 0);
});

test('failed scene publication is retried, expired deduplication is removed', async () => {
  const gladys = createFakeGladys();
  const monitor = new SceneMonitor(() => NOW);
  monitor.sent.set('expired', NOW - 1);
  const rows = await service.departures(config);
  const publish = gladys.publishSceneEvent;
  gladys.publishSceneEvent = async () => {
    throw new Error('socket down');
  };
  await assert.rejects(monitor.update(gladys, config, 'station:1', rows));
  assert.equal(monitor.sent.size, 0);
  gladys.publishSceneEvent = publish;
  await monitor.update(gladys, config, 'station:1', rows);
  assert.equal(gladys.sceneEvents.length, 2);
});

test('scene empty result is explicit and every output is scalar', () => {
  const empty = result(undefined, NOW);
  assert.equal(empty.found, false);
  assert.equal(empty.minutes, -1);
  assert.equal(empty.delay_known, false);
  for (const value of Object.values(empty))
    assert.ok(['number', 'string', 'boolean'].includes(typeof value));
});

test('discovery IDs are stable, include station/route/filter identity, features are read-only', () => {
  const gladys = createFakeGladys();
  const devices = buildDevices(gladys, config);
  assert.equal(devices.length, 2);
  assert.deepEqual(devices, buildDevices(gladys, { ...config }));
  assert.notEqual(
    deviceIds(gladys, config).device,
    deviceIds(gladys, { ...config, station: 'Bern' }).device,
  );
  assert.notEqual(deviceIds(gladys, config).device, deviceIds(gladys, config, 'route').device);
  for (const device of devices)
    for (const feature of device.features) {
      assert.ok(feature.category && feature.type);
      assert.equal(feature.read_only, true);
    }
});

test('manifest matches capabilities, defaults, versions and cloud classification', () => {
  const keys = (items) => items.map((x) => x.key).sort();
  assert.deepEqual(keys(manifest.actions), [...ACTION_KEYS].sort());
  assert.deepEqual(keys(manifest.scene_actions), [...SCENE_ACTION_KEYS].sort());
  assert.deepEqual(keys(manifest.scene_triggers), [...TRIGGERS].sort());
  assert.deepEqual(keys(manifest.widgets), [...WIDGET_KEYS].sort());
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.equal(manifest.gladys_version, '>=5.2.0');
  for (const field of manifest.config_schema)
    if ('default' in field) assert.equal(field.default, DEFAULT_CONFIG[field.key]);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
  assert.equal(pkg.version, manifest.version);
  assert.equal(lock.version, manifest.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('every scene event value is declared in the manifest with its actual scalar type', async () => {
  const gladys = createFakeGladys();
  await new SceneMonitor(() => NOW).update(
    gladys,
    config,
    'station:1',
    await service.departures(config),
  );
  for (const event of gladys.sceneEvents) {
    const trigger = manifest.scene_triggers.find((item) => item.key === event.key);
    for (const [key, value] of Object.entries(event.data)) {
      if (key === 'device') continue;
      assert.equal(
        trigger.variables.find((variable) => variable.key === key)?.type,
        typeof value,
        key,
      );
    }
  }
});

test('widget forms and long platform strings remain valid in both languages', async () => {
  for (const language of ['en', 'fr']) {
    const [row] = await service.departures(config);
    const widget = await getWidget(
      {
        now: () => NOW,
        departures: async () => [{ ...row, platform: 'P'.repeat(5000), delay: -2 }],
      },
      'departures',
      config,
      { language },
    );
    assert.deepEqual(validateWidgetContent(widget), []);
    assert.match(
      widget.components[0].items[0].description,
      language === 'fr' ? /Avance : 2/ : /Early: 2/,
    );
    const empty = await getWidget({ connections: async () => [] }, 'connections', config, {
      language,
    });
    assert.match(
      empty.components[0].text[language],
      language === 'fr' ? /itinéraire/ : /connections/,
    );
  }
  const matches = Array.from({ length: 10 }, (_, i) => ({
    name: 'N'.repeat(120),
    id: `00850001${i}`,
  }));
  const message = stationSearchMessage(matches);
  assert.ok(message.en.length <= 200);
  assert.match(message.fr, /\(008500010\)/);
  assert.ok(message.fr.endsWith(')'), 'station identifiers are never cut in half');
});

test('a departure that passed while publishing states does not trigger a late alert', async () => {
  const gladys = createFakeGladys();
  const rows = await service.departures(config);
  await new SceneMonitor(() => NOW + 60 * 60_000).update(gladys, config, 'station:1', rows);
  assert.equal(gladys.sceneEvents.length, 0);
});
