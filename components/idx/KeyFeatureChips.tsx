import type { KeyFeature, KeyFeatureIcon } from '@/lib/listingFeatures';

/** Inline SVG icons for the key-feature chips (same style as AreaHighlights). */
function Icon({ name }: { name: KeyFeatureIcon }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'h-4 w-4',
    'aria-hidden': true,
  };
  switch (name) {
    case 'water':
      return (
        <svg {...common}>
          <path d="M2 6c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0M2 12c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0M2 18c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0" />
        </svg>
      );
    case 'lot':
      return (
        <svg {...common}>
          <path d="M3 3h18v18H3z" />
          <path d="M3 9h18M9 3v18" />
        </svg>
      );
    case 'new':
      return (
        <svg {...common}>
          <path d="M12 2l2.4 5.4L20 8l-4 4 1 6-5-2.8L7 18l1-6-4-4 5.6-.6z" />
        </svg>
      );
    case 'pool':
      return (
        <svg {...common}>
          <path d="M2 20c2 0 2-1.5 4-1.5S8 20 10 20s2-1.5 4-1.5S16 20 18 20s2-1.5 4-1.5" />
          <path d="M7 16V6a2 2 0 0 1 4 0M13 16V6a2 2 0 0 1 4 0" />
        </svg>
      );
    case 'garage':
      return (
        <svg {...common}>
          <path d="M3 10l9-5 9 5v10H3z" />
          <path d="M6 20v-6h12v6M6 14h12" />
        </svg>
      );
    case 'fire':
      return (
        <svg {...common}>
          <path d="M12 3s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3 1-3s0 2 1.5 2S12 7 12 3z" />
        </svg>
      );
    case 'basement':
      return (
        <svg {...common}>
          <path d="M3 4h18M6 4v16M18 4v16M6 10h12M6 16h12" />
        </svg>
      );
    case 'view':
      return (
        <svg {...common}>
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      );
    case 'hoa':
      return (
        <svg {...common}>
          <path d="M20.6 13.4L11 3.8V3H3v8l9.6 9.6a2 2 0 0 0 2.8 0l5.2-5.2a2 2 0 0 0 0-2.8z" />
          <circle cx="7" cy="7" r="1" />
        </svg>
      );
    case 'year':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="17" rx="2" />
          <path d="M3 9h18M8 2v4M16 2v4" />
        </svg>
      );
    case 'beds':
    default:
      return (
        <svg {...common}>
          <path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M3 14h18M7 10V8a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2" />
        </svg>
      );
  }
}

/** Key-feature icon chips shown directly under the beds/baths/sqft row. */
export default function KeyFeatureChips({ features }: { features: KeyFeature[] }) {
  if (!features.length) return null;
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {features.map((f) => (
        <span
          key={f.label}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-cream px-3 py-1.5 text-sm font-semibold text-charcoal"
        >
          <span className="text-platinum-blue">
            <Icon name={f.icon} />
          </span>
          {f.label}
        </span>
      ))}
    </div>
  );
}
