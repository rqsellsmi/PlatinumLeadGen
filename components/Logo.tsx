import Image from 'next/image';
import Link from 'next/link';

/**
 * RE/MAX Platinum logo. Uses the extracted brand assets (Section 15.5):
 *   variant="blue"  → black REMAX + blue Platinum, for light backgrounds
 *   variant="cream" → cream/white, for the dark charcoal sidebars
 */
export default function Logo({
  variant = 'blue',
  href = '/',
  width = 150,
  className,
  priority,
}: {
  variant?: 'blue' | 'cream' | 'black';
  href?: string | null;
  width?: number;
  className?: string;
  priority?: boolean;
}) {
  const src = `/assets/logo-${variant}.png`;
  const height = Math.round((width * 300) / 800);
  const img = (
    <Image
      src={src}
      alt="RE/MAX Platinum"
      width={width}
      height={height}
      priority={priority}
      className={className}
    />
  );
  if (href === null) return img;
  return (
    <Link href={href} aria-label="RE/MAX Platinum home">
      {img}
    </Link>
  );
}
