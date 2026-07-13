import Image from 'next/image';
import { REALCOMP_LOGO_SRC } from '@/lib/idxDisclosures';

/**
 * The Realcomp-approved logo/icon — required adjacent to every IDX listing
 * (summary §18.3.5, detail §18.3.4). The official file lives at
 * public/assets/realcomp-logo.png (supplied by the owner from Realcomp).
 *
 * The artwork is a wordmark (~115×55, ≈2.09:1), not a square icon, so `size`
 * sets the rendered HEIGHT and the width scales to preserve the aspect ratio —
 * otherwise the logo is squashed into a square. Pass `size` = the height you
 * want (defaults to 20px).
 */

// Intrinsic dimensions of public/assets/realcomp-logo.png.
const LOGO_W = 115;
const LOGO_H = 55;
const ASPECT = LOGO_W / LOGO_H;

export default function RealcompLogo({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const height = size;
  const width = Math.round(size * ASPECT);
  return (
    <Image
      src={REALCOMP_LOGO_SRC}
      alt="Realcomp MLS"
      width={width}
      height={height}
      className={className}
      // Not decorative — it identifies the listing as a Realcomp IDX listing.
      unoptimized
    />
  );
}
