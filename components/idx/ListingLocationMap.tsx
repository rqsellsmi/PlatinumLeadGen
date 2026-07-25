/**
 * A single-pin location map for the listing detail page, using the FREE Google
 * Maps Embed API (no per-load billing, unlike the interactive search map).
 *
 * Compliance: when the listing's address is hidden
 * (internetAddressDisplayYN=false), we must NOT reveal the exact location, so the
 * map centers on the city at a coarse zoom instead of the precise coordinates.
 */
export default function ListingLocationMap({
  latitude,
  longitude,
  city,
  stateOrProvince,
  addressHidden,
  label,
}: {
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  stateOrProvince: string | null;
  addressHidden: boolean;
  label?: string | null;
}) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return null;

  const cityQuery = [city, stateOrProvince].filter(Boolean).join(', ');
  let q: string;
  let zoom: number;
  if (addressHidden || latitude == null || longitude == null) {
    if (!cityQuery) return null;
    q = encodeURIComponent(cityQuery);
    zoom = 12; // approximate — general area only
  } else {
    q = `${latitude},${longitude}`;
    zoom = 15;
  }

  const src = `https://www.google.com/maps/embed/v1/place?key=${key}&q=${q}&zoom=${zoom}`;

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-bold text-charcoal">{label ?? 'Location'}</h2>
      <div className="overflow-hidden rounded-xl border border-line">
        <iframe
          title="Property location map"
          src={src}
          className="h-[320px] w-full"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      </div>
      {addressHidden ? (
        <p className="mt-1.5 text-xs text-mute-light">
          Approximate area shown — exact address available upon request.
        </p>
      ) : null}
    </section>
  );
}
