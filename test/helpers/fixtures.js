export const NOW = Date.parse('2026-10-12T12:00:00+02:00');
export const iso = (minutes) => new Date(NOW + minutes * 60_000).toISOString();
export function journey(overrides = {}) {
  return {
    name: 'IC1',
    category: 'IC',
    number: '1',
    to: 'Genève',
    stop: {
      station: { name: 'Lausanne' },
      departure: iso(5),
      platform: '3',
      delay: 2,
      prognosis: { departure: iso(7), platform: '4' },
    },
    ...overrides,
  };
}
export const board = (rows = [journey()]) => ({
  station: { name: 'Lausanne' },
  stationboard: rows,
});
export const connection = () => ({
  from: journey().stop,
  to: { station: { name: 'Genève' }, arrival: iso(50), prognosis: { arrival: iso(52) } },
  products: ['IC1'],
  sections: [{ journey: { name: 'IC1' } }],
});
export const jsonResponse = (data, init) => new Response(JSON.stringify(data), init);
