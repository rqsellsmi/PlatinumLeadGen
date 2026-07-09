import Image from 'next/image';
import { REALCOMP_LOGO_SRC } from '@/lib/idxDisclosures';

/**
 * The Realcomp-approved logo/icon — required adjacent to every IDX listing
 * (summary §18.3.5, detail §18.3.4). The official file must be supplied by the
 * owner at public/assets/realcomp-logo.png (requested from Realcomp when
 * notifying them of the IDX display).
 */
export default function RealcompLogo({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src={REALCOMP_LOGO_SRC}
      alt="Realcomp MLS"
      width={size}
      height={size}
      className={className}
      // Not decorative — it identifies the listing as a Realcomp IDX listing.
      unoptimized
    />
  );
}
