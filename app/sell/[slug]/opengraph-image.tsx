import { ImageResponse } from 'next/og';
import { getLocationBySlug } from '@/lib/queries';

export const runtime = 'edge';
export const alt = "What's Your Home Worth? — RE/MAX Platinum";
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

function shortCityName(name: string): string {
  return name.split(',')[0].trim();
}

export default async function Image({ params }: { params: { slug: string } }) {
  const location = await getLocationBySlug(params.slug);
  const cityName = location ? shortCityName(location.name) : 'Michigan';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #1E3A5F 0%, #16304d 100%)',
          color: 'white',
          fontFamily: 'sans-serif',
          padding: '80px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.1 }}>{cityName}</div>
        <div style={{ fontSize: 56, fontWeight: 700, marginTop: 16, color: '#F5F7FA' }}>
          What&apos;s Your Home Worth?
        </div>
        <div style={{ display: 'flex', marginTop: 48, fontSize: 36, fontWeight: 700 }}>
          <span>RE/MAX </span>
          <span style={{ color: '#DC1C2E', marginLeft: 12 }}>Platinum</span>
        </div>
      </div>
    ),
    size,
  );
}
