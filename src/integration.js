import { normalizeConfig } from './config.js';
import { buildDevices, deviceIds } from './devices.js';
import { result, SceneMonitor } from './scenes.js';
import { remaining } from './transport.js';
import { getWidget, stationSearchMessage, WIDGET_KEYS } from './widgets.js';

export const ACTION_KEYS = ['test_api', 'search_stations', 'refresh'];

// Dependency injection keeps the lifecycle testable without a Gladys server.
export function createIntegration(
  gladys,
  service,
  logger,
  timers = { setInterval, clearInterval },
) {
  let config = normalizeConfig();
  let revision = 0;
  let timer;
  let active = false;
  let pending;
  let publications = Promise.resolve();
  const monitor = new SceneMonitor(service.now);
  const nudge = () => WIDGET_KEYS.forEach((key) => gladys.requestWidgetRefresh(key));

  // A previous HTTP publication may already be in flight. New configurations
  // publish after it; queued work checks its revision before touching Gladys.
  function publish(current, operation) {
    const task = publications.then(() => (current() ? operation() : undefined));
    publications = task.catch(() => {});
    return task;
  }

  const states = (current, values) =>
    publish(current, () => gladys.publishChangedStates(values, { heartbeat: 30 * 60_000 }));

  async function readCurrent(operation) {
    if (!active) throw new Error('Swiss Transports is disconnected.');
    const version = revision;
    const value = await operation(config);
    if (!active || version !== revision) throw new Error('Configuration changed. Please retry.');
    return value;
  }

  async function initializationFailed(version) {
    if (version !== revision) return;
    logger.error('Swiss Transports initialization failed.');
    await publish(
      () => version === revision,
      () =>
        gladys.setConnectionStatus(false, {
          en: 'Initialization failed. Check configuration and retry.',
          fr: 'Initialisation échouée. Vérifiez la configuration et réessayez.',
        }),
    ).catch(() => {});
  }

  function stop() {
    active = false;
    revision += 1;
    timers.clearInterval(timer);
    timer = undefined;
    pending = undefined;
    gladys.forgetPublishedStates();
  }

  async function performRefresh(snapshot, current) {
    const kinds = ['station', ...(snapshot.destination ? ['route'] : [])];
    const responses = await Promise.allSettled(
      kinds.map((kind) =>
        kind === 'station' ? service.departures(snapshot) : service.connections(snapshot),
      ),
    );
    if (!current()) return;
    let failed = false;
    for (let i = 0; i < kinds.length; i += 1) {
      if (!current()) return;
      const ids = deviceIds(gladys, snapshot, kinds[i]);
      const response = responses[i];
      if (response.status === 'rejected') {
        failed = true;
        logger.warn('Transport refresh failed.');
        await states(current, [
          { device_feature_external_id: ids.feature('data_valid'), state: 0 },
        ]);
        continue;
      }
      const rows = response.value.filter((row) => row.expected >= service.now());
      const next = rows[0];
      const values = {
        available: next ? 1 : 0,
        data_valid: 1,
        delay_known: next?.delay !== null && next?.delay !== undefined ? 1 : 0,
      };
      // Missing values never become a fabricated zero. Historical values in
      // Gladys must be interpreted alongside availability and connection status.
      if (next) {
        values.minutes = remaining(next, service.now());
        if (next.delay != null) values.delay = next.delay;
        if (next.duration !== null && next.duration !== undefined) values.duration = next.duration;
      }
      await states(
        current,
        Object.entries(values).map(([key, state]) => ({
          device_feature_external_id: ids.feature(key),
          state,
        })),
      );
      if (kinds[i] === 'station' && current())
        await publish(current, () => monitor.update(gladys, snapshot, ids.device, rows, current));
    }
    if (!current()) return;
    await publish(current, () =>
      gladys.setConnectionStatus(
        !failed,
        failed
          ? {
              en: 'Transport API unavailable. Check the configured stations and retry later.',
              fr: 'API Transport indisponible. Vérifiez les gares configurées et réessayez plus tard.',
            }
          : undefined,
      ),
    );
    if (!current()) return;
    nudge();
    if (failed) throw new Error('Transport API refresh failed.');
  }

  function refresh() {
    if (!active) return Promise.reject(new Error('Swiss Transports is disconnected.'));
    if (pending) return pending;
    const version = revision;
    const task = performRefresh(config, () => active && revision === version)
      .then(() => {
        if (!active || revision !== version)
          throw new Error('Configuration changed. Please retry.');
      })
      .finally(() => {
        if (pending === task) pending = undefined;
      });
    pending = task;
    return task;
  }

  async function configure(raw) {
    const next = normalizeConfig(raw);
    stop();
    config = next;
    active = true;
    const version = revision;
    const current = () => active && version === revision;
    const snapshot = config;
    try {
      await publish(current, () => {
        gladys.forgetPublishedStates();
        return gladys.publishDiscoveredDevices(buildDevices(gladys, snapshot));
      });
    } catch (error) {
      if (current()) active = false;
      await initializationFailed(version);
      throw error;
    }
    if (!active || version !== revision) return;
    nudge();
    timer = timers.setInterval(
      () =>
        refresh().catch(() => {
          if (current()) logger.warn('Timetable refresh failed.');
        }),
      config.poll_frequency * 1000,
    );
    timer?.unref?.();
    try {
      await refresh();
    } catch (error) {
      await initializationFailed(version);
      throw error;
    }
  }

  gladys.onScanRequest(() =>
    readCurrent((snapshot) => {
      const version = revision;
      return publish(
        () => active && version === revision,
        () => gladys.publishDiscoveredDevices(buildDevices(gladys, snapshot)),
      );
    }),
  );
  gladys.onPoll((device) => {
    if (!buildDevices(gladys, config).some((d) => d.external_id === device.external_id)) {
      throw new Error(
        'This station or route is no longer configured. Remove the old device in Gladys.',
      );
    }
    return refresh();
  });
  gladys.onAction('test_api', async () => {
    const stations = await readCurrent((snapshot) => service.locations(snapshot.station));
    if (!stations.length) throw new Error('No matching station. Check the configured station.');
    return {
      en: `Transport API connected: ${stations[0].name}`.slice(0, 200),
      fr: `API Transport connectée : ${stations[0].name}`.slice(0, 200),
    };
  });
  gladys.onAction('search_stations', async ({ query } = {}) => {
    return stationSearchMessage(await readCurrent(() => service.locations(query)));
  });
  gladys.onAction('refresh', async () => {
    await refresh();
    return { en: 'Timetables refreshed.', fr: 'Horaires actualisés.' };
  });

  gladys.onSceneAction('next_departure', async (fields = {}) =>
    result(
      (await readCurrent((snapshot) => service.departures(snapshot, fields)))[0],
      service.now(),
    ),
  );
  gladys.onSceneAction('next_connection', async (fields = {}) => {
    const row = (await readCurrent((snapshot) => service.connections(snapshot, fields)))[0];
    return {
      ...result(row, service.now()),
      arrival: row?.arrival == null ? '' : new Date(row.arrival).toISOString(),
      duration: row?.duration ?? -1,
      transfers: row?.transfers ?? -1,
    };
  });
  gladys.onSceneAction('refresh', async () => {
    await refresh();
    return { refreshed: true };
  });

  for (const key of WIDGET_KEYS) {
    gladys.onWidgetGet(key, (request) =>
      readCurrent((snapshot) => getWidget(service, key, snapshot, request)),
    );
    gladys.onWidgetAction(key, async (actionKey, _params, { settings = {}, values = {} } = {}) => {
      if (actionKey === 'search_stations') {
        return stationSearchMessage(await readCurrent(() => service.locations(values.query)));
      }
      if (actionKey !== 'refresh') throw new Error('Unknown widget action.');
      await readCurrent((snapshot) => service[key](snapshot, settings));
      return {
        en: 'Timetables refreshed.',
        fr: 'Horaires actualisés.',
      };
    });
  }
  gladys.onConfigUpdated(configure);
  gladys.on('connected', async () => {
    // Ignore a slow config read from a connection that has already been closed.
    stop();
    const version = revision;
    try {
      const raw = await gladys.getConfig();
      if (version !== revision) return;
      await configure(raw);
    } catch {
      await initializationFailed(version);
    }
  });
  gladys.on('disconnected', stop);
  gladys.handleShutdown(stop);
  return { refresh, stop, configure };
}
