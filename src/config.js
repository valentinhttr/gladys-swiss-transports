export const DEFAULT_CONFIG = {
  station: 'Lausanne',
  destination: '',
  transportation: 'all',
  poll_frequency: 60,
  departure_window: 10,
  delay_threshold: 5,
  limit: 8,
};

export function location(value, name = 'station', required = true) {
  if (
    typeof value !== 'string' ||
    value.trim().length > 120 ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  ) {
    throw new Error(`Invalid ${name}: expected a station name or ID (120 characters maximum).`);
  }
  const result = value.trim();
  if (required && !result) throw new Error(`Missing ${name}.`);
  return result;
}

export function integer(value, name, min, max) {
  if (
    !['string', 'number'].includes(typeof value) ||
    (typeof value === 'string' && !/^\d+$/.test(value.trim()))
  ) {
    throw new Error(`Invalid ${name}.`);
  }
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return result;
}

export function normalizeConfig(raw = {}) {
  const values = { ...DEFAULT_CONFIG, ...raw };
  if (!['all', 'train', 'tram', 'ship', 'bus', 'cableway'].includes(values.transportation)) {
    throw new Error('Invalid transportation.');
  }
  return {
    station: location(values.station),
    destination: location(values.destination, 'destination', false),
    transportation: values.transportation,
    poll_frequency: integer(values.poll_frequency, 'poll_frequency', 30, 3600),
    departure_window: integer(values.departure_window, 'departure_window', 1, 120),
    delay_threshold: integer(values.delay_threshold, 'delay_threshold', 1, 120),
    limit: integer(values.limit, 'limit', 1, 8),
  };
}
