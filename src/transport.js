import { integer, location } from './config.js';
import { createHash } from 'node:crypto';

// Provider text remains plain, bounded text in states, events and widgets.
export function plainText(value, max = 120) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return [...String(value)]
    .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    .join('')
    .trim()
    .slice(0, max);
}

const validTime = (value) =>
  Number.isFinite(value) && Number.isFinite(new Date(value).getTime()) ? value : null;

function timestamp(value) {
  // Reject timezone-free dates: their meaning must never depend on the host.
  return typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
    ? validTime(Date.parse(value))
    : null;
}

export function stopTimes(stop = {}, kind = 'departure') {
  if (!stop || typeof stop !== 'object') stop = {};
  const planned =
    timestamp(stop[kind]) ??
    (typeof stop[`${kind}Timestamp`] === 'number'
      ? validTime(stop[`${kind}Timestamp`] * 1000)
      : null);
  const predicted = timestamp(stop.prognosis?.[kind]);
  const delay =
    ['number', 'string'].includes(typeof stop.delay) &&
    String(stop.delay).trim() !== '' &&
    Number.isFinite(Number(stop.delay))
      ? Number(stop.delay)
      : predicted !== null && planned !== null
        ? Math.round((predicted - planned) / 60_000)
        : null;
  return {
    planned,
    expected: predicted ?? (planned === null ? null : validTime(planned + (delay ?? 0) * 60_000)),
    delay,
    platform: plainText(stop.prognosis?.platform ?? stop.platform, 24),
  };
}

export function remaining(row, now = Date.now()) {
  return Math.max(0, Math.ceil((row.expected - now) / 60_000));
}

export class TransportService {
  constructor(client, now = Date.now) {
    this.client = client;
    this.now = now;
  }

  params(config, values = {}) {
    return {
      ...values,
      ...(config.transportation === 'all' ? {} : { 'transportations[]': config.transportation }),
    };
  }

  async locations(query) {
    const data = await this.client.get(
      'locations',
      { query: location(query, 'query'), type: 'station' },
      300_000,
    );
    if (!Array.isArray(data.stations)) throw new Error('Transport API locations are missing.');
    return data.stations
      .filter(
        (s) =>
          s &&
          typeof s.id === 'string' &&
          /^\d{1,32}$/.test(s.id) &&
          typeof s.name === 'string' &&
          s.type !== 'refine',
      )
      .map((s) => ({ id: s.id, name: plainText(s.name) }))
      .filter((s) => s.name)
      .slice(0, 10);
  }

  async departures(config, settings = {}) {
    const station = location(settings.station || config.station);
    const limit = integer(settings.limit ?? config.limit, 'limit', 1, 8);
    const data = await this.client.get('stationboard', this.params(config, { station, limit }));
    if (!Array.isArray(data.stationboard))
      throw new Error('Transport API stationboard is missing.');
    return data.stationboard
      .filter((j) => j?.stop)
      .map((journey) => {
        const times = stopTimes(journey.stop);
        return {
          ...times,
          id: createHash('sha256')
            .update(
              JSON.stringify([station, journey.name, journey.number, journey.to, times.planned]),
            )
            .digest('hex'),
          station: plainText(data.station?.name) || station,
          destination: plainText(journey.to),
          line:
            [plainText(journey.category, 24), plainText(journey.number, 24)]
              .filter(Boolean)
              .join(' ') ||
            plainText(journey.name, 48) ||
            '—',
        };
      })
      .filter((row) => row.expected !== null && row.expected >= this.now())
      .sort((a, b) => a.expected - b.expected)
      .slice(0, limit);
  }

  async connections(config, settings = {}) {
    const from = location(settings.from || config.station, 'from');
    const to = location(settings.to || config.destination, 'to');
    const limit = integer(settings.limit ?? config.limit, 'limit', 1, 8);
    const data = await this.client.get('connections', this.params(config, { from, to, limit }));
    if (!Array.isArray(data.connections)) throw new Error('Transport API connections are missing.');
    return data.connections
      .filter((c) => c?.from && c?.to)
      .map((connection) => {
        const departure = stopTimes(connection.from);
        const arrival = stopTimes(connection.to, 'arrival');
        const sections = Array.isArray(connection.sections) ? connection.sections : [];
        return {
          ...departure,
          station: plainText(connection.from.station?.name) || from,
          destination: plainText(connection.to.station?.name) || to,
          arrival:
            arrival.expected !== null && arrival.expected >= departure.expected
              ? arrival.expected
              : null,
          duration:
            departure.expected !== null &&
            arrival.expected !== null &&
            arrival.expected >= departure.expected
              ? Math.round((arrival.expected - departure.expected) / 60_000)
              : null,
          transfers:
            Number.isInteger(connection.transfers) && connection.transfers >= 0
              ? connection.transfers
              : sections.length > 0
                ? Math.max(0, sections.filter((s) => s?.journey).length - 1)
                : null,
          line: Array.isArray(connection.products)
            ? connection.products
                .slice(0, 8)
                .map((p) => plainText(p, 24))
                .filter(Boolean)
                .join(', ')
                .slice(0, 120)
            : '',
        };
      })
      .filter((row) => row.expected !== null && row.expected >= this.now())
      .sort((a, b) => a.expected - b.expected)
      .slice(0, limit);
  }
}
