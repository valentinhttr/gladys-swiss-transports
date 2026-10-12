import { plainText, remaining } from './transport.js';

export const WIDGET_KEYS = ['departures', 'connections'];
const clip = (value, length) => {
  const full = plainText(value, 1000);
  return full.length > length ? `${full.slice(0, length - 1)}…` : full;
};
const text = (en, fr) => ({ en, fr });

export function stationSearchMessage(stations) {
  const entries = [];
  for (const station of stations) {
    const entry = `${clip(station.name, 42)} (${station.id})`;
    if ([...entries, entry].join(' · ').length > 170) break;
    entries.push(entry);
  }
  const summary = entries.join(' · ');
  return summary
    ? text(summary, summary)
    : text('No station found. Try a more precise name.', 'Aucune gare trouvée. Précisez le nom.');
}

function clock(time, language) {
  if (!Number.isFinite(time)) return '—';
  return new Intl.DateTimeFormat(language === 'fr' ? 'fr-CH' : 'en-GB', {
    timeZone: 'Europe/Zurich',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(time));
}

export async function getWidget(service, kind, config, { settings = {}, language = 'en' } = {}) {
  let rows = [];
  let problem;
  if (kind === 'connections' && !(settings.to || config.destination)) {
    problem = text(
      'Choose a destination in the widget settings.',
      'Choisissez une destination dans les réglages du widget.',
    );
  } else {
    try {
      rows = await service[kind](config, settings);
    } catch {
      problem = text(
        'Timetables unavailable. Check the stations and try again shortly.',
        'Horaires indisponibles. Vérifiez les gares et réessayez dans un instant.',
      );
    }
  }
  const components = [];
  if (problem || rows.length === 0) {
    components.push({
      type: 'text',
      variant: 'body',
      text:
        problem ??
        (kind === 'connections'
          ? text('No upcoming connections found.', 'Aucun itinéraire à venir trouvé.')
          : text('No upcoming departures found.', 'Aucun départ à venir trouvé.')),
    });
  } else {
    components.push({
      type: 'card-list',
      display: 'list',
      items: rows.slice(0, 8).map((row) => ({
        title: clip(`${clock(row.expected, language)} · ${row.destination}`, 60),
        subtitle: clip(`${row.station} · ${row.line || '—'}`, 60),
        badge: {
          text: clip(`${remaining(row, service.now())} min`, 16),
          color: row.delay > 0 ? 'warning' : 'info',
        },
        description: clip(
          [
            language === 'fr'
              ? `Quai : ${clip(row.platform || '—', 24)}`
              : `Platform: ${clip(row.platform || '—', 24)}`,
            row.delay == null
              ? language === 'fr'
                ? 'Temps réel indisponible'
                : 'Real-time data unavailable'
              : language === 'fr'
                ? row.delay < 0
                  ? `Avance : ${Math.abs(row.delay)} min`
                  : `Retard : ${row.delay} min`
                : row.delay < 0
                  ? `Early: ${Math.abs(row.delay)} min`
                  : `Delay: ${row.delay} min`,
            ...(kind === 'connections'
              ? [
                  language === 'fr'
                    ? `Arrivée : ${clock(row.arrival, language)} · ${row.duration ?? '—'} min · Correspondances : ${row.transfers ?? '—'}`
                    : `Arrival: ${clock(row.arrival, language)} · ${row.duration ?? '—'} min · Transfers: ${row.transfers ?? '—'}`,
                ]
              : []),
          ].join(' · '),
          240,
        ),
      })),
    });
  }
  components.push(
    {
      type: 'text',
      variant: 'caption',
      text: text(
        'Transport API · opentransportdata.swiss · Swiss time',
        'Transport API · opentransportdata.swiss · Heure suisse',
      ),
    },
    {
      type: 'button',
      label: text('Refresh', 'Actualiser'),
      icon: 'refresh-cw',
      style: 'secondary',
      action: { key: 'refresh' },
    },
    {
      type: 'button',
      label: text('Find a station ID', 'Chercher une gare'),
      icon: 'search',
      style: 'secondary',
      action: {
        key: 'search_stations',
        fields: [
          {
            key: 'query',
            type: 'string',
            required: true,
            label: text('Station name', 'Nom de gare'),
            description: text(
              'Find an ID to copy into the widget settings. This does not change the monitored station.',
              'Trouvez un identifiant à copier dans les réglages du widget. La gare surveillée reste inchangée.',
            ),
            default: plainText(settings.station || settings.from || config.station),
          },
        ],
      },
    },
  );
  return { ttl_seconds: 30, components };
}
