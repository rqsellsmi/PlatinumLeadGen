import type { AreaReport } from '@/lib/nearbyPlaces';
import { RADIUS_MILES } from '@/lib/nearbyPlaces';

/**
 * "Explore the neighborhood" — an embedded map of the listing plus nearby
 * restaurants, parks, coffee, groceries, golf, etc. (the ListReports-style area
 * report, minus schools). Server component: the POI data is fetched + cached
 * upstream (lib/nearbyPlaces) and passed in; the map is a free Google Maps
 * Embed iframe (no per-load billing) using the public browser key.
 */

function fmtMiles(d: number): string {
  if (d < 0.1) return '<0.1 mi';
  return `${d.toFixed(1)} mi`;
}

/** Minimal inline icon per category (single-color, inherits currentColor). */
function CategoryIcon({ k }: { k: string }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'h-5 w-5',
    'aria-hidden': true,
  };
  switch (k) {
    case 'restaurant':
      return (
        <svg {...common}>
          <path d="M4 3v7a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3M6 3v18M18 3c-1.5 0-3 1.5-3 4s1.5 4 3 4v10" />
        </svg>
      );
    case 'cafe':
      return (
        <svg {...common}>
          <path d="M4 9h13v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9ZM17 10h2a2 2 0 0 1 0 4h-2M6 4v1M10 4v1M14 4v1" />
        </svg>
      );
    case 'grocery':
      return (
        <svg {...common}>
          <path d="M4 5h2l2 11h9l2-7H7M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
        </svg>
      );
    case 'gas':
      return (
        <svg {...common}>
          <path d="M5 21V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v16M4 21h11M14 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-2-2M8 8h3" />
        </svg>
      );
    case 'gym':
      return (
        <svg {...common}>
          <path d="M6 7v10M4 9v6M18 7v10M20 9v6M6 12h12" />
        </svg>
      );
    case 'pharmacy':
      return (
        <svg {...common}>
          <path d="M12 6v12M6 12h12M8 5h8a1 1 0 0 1 1 1v0a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v0a1 1 0 0 1 1-1ZM7 7h10v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V7Z" />
        </svg>
      );
    case 'medical':
      return (
        <svg {...common}>
          <path d="M10 3h4v5h5v4h-5v9h-4v-9H5V8h5V3Z" />
        </svg>
      );
    case 'park':
      return (
        <svg {...common}>
          <path d="M12 3 6 12h4l-3 5h10l-3-5h4L12 3ZM12 17v4" />
        </svg>
      );
    case 'golf':
      return (
        <svg {...common}>
          <path d="M12 3v13M12 3l6 3-6 3M6 20h12M12 16c-3 0-6 1-6 2M12 16c3 0 6 1 6 2" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11ZM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
        </svg>
      );
  }
}

export default function AreaHighlights({
  report,
  latitude,
  longitude,
  locationLabel,
}: {
  report: AreaReport;
  latitude: number;
  longitude: number;
  locationLabel?: string | null;
}) {
  const embedKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const mapSrc = embedKey
    ? `https://www.google.com/maps/embed/v1/place?key=${embedKey}&q=${latitude},${longitude}&zoom=14`
    : null;

  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold text-charcoal">Explore the neighborhood</h2>
      <p className="mt-1 text-sm text-mute">
        What&apos;s nearby{locationLabel ? ` in ${locationLabel}` : ''} — everyday errands, dining, and the outdoors.
      </p>

      <div className="mt-4 grid gap-5 lg:grid-cols-5">
        {mapSrc ? (
          <div className="overflow-hidden rounded-card border border-line lg:col-span-2">
            <iframe
              title="Map of the area around this home"
              src={mapSrc}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="h-64 w-full lg:h-full lg:min-h-[320px]"
              style={{ border: 0 }}
              allowFullScreen
            />
          </div>
        ) : null}

        <div
          className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${mapSrc ? 'lg:col-span-3' : 'lg:col-span-5'}`}
        >
          {report.categories.map((c) => (
            <div key={c.key} className="rounded-card border border-line bg-white p-4">
              <div className="flex items-center gap-2 text-platinum-red">
                <CategoryIcon k={c.key} />
                <span className="text-xs font-bold uppercase tracking-[0.06em] text-mute-light">
                  {c.label}
                </span>
              </div>
              {c.nearest ? (
                <>
                  <p className="mt-2 line-clamp-2 text-sm font-semibold text-charcoal" title={c.nearest.name}>
                    {c.nearest.name}
                  </p>
                  <p className="mt-0.5 text-xs text-mute">
                    <span className="font-numeric font-semibold text-charcoal">
                      {fmtMiles(c.nearest.distanceMiles)}
                    </span>
                    {c.countWithinRadius > 1
                      ? ` · ${c.countWithinRadius} within ${RADIUS_MILES} mi`
                      : ''}
                  </p>
                </>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <p className="mt-3 text-xs italic text-mute-light">
        Nearby places and distances are approximate, provided by Google. Distances are straight-line
        from the property.
      </p>
    </section>
  );
}
