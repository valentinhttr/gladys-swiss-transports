import { createHash } from 'node:crypto';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';

export function deviceIds(gladys, config, kind = 'station') {
  const key = JSON.stringify([
    config.station,
    kind === 'route' ? config.destination : '',
    config.transportation,
  ]);
  return gladys.externalIds(kind, createHash('sha256').update(key).digest('hex').slice(0, 20));
}

export function buildDevices(gladys, config) {
  return ['station', ...(config.destination ? ['route'] : [])].map((kind) => {
    const ids = deviceIds(gladys, config, kind);
    return {
      name:
        kind === 'station'
          ? `Swiss Transports · ${config.station}`
          : `Swiss Transports · ${config.station} → ${config.destination}`,
      external_id: ids.device,
      // The integration owns the configurable timer; no core polling is requested.
      features: [
        ['minutes', 'Next departure', C.DURATION, T.DURATION.INTEGER, U.MINUTES],
        ['delay', 'Departure delay', C.DURATION, T.DURATION.DECIMAL, U.MINUTES],
        ['available', 'Departures available', C.PRESENCE_SENSOR, T.SENSOR.BINARY],
        ['data_valid', 'Timetable available', C.PRESENCE_SENSOR, T.SENSOR.BINARY],
        ['delay_known', 'Real-time delay available', C.PRESENCE_SENSOR, T.SENSOR.BINARY],
        ...(kind === 'route'
          ? [['duration', 'Journey duration', C.DURATION, T.DURATION.INTEGER, U.MINUTES]]
          : []),
      ].map(([key, name, category, type, unit]) => ({
        name,
        external_id: ids.feature(key),
        category,
        type,
        ...(unit ? { unit } : {}),
        read_only: true,
        has_feedback: false,
        keep_history: false,
      })),
    };
  });
}
