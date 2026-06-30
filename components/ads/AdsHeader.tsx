import Logo from '@/components/Logo';

/** Minimal PPC header (Section 20.3 #1): logo + click-to-call, no nav. */
export default function AdsHeader({ phone }: { phone: string }) {
  const tel = phone.replace(/[^\d+]/g, '');
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex h-[70px] max-w-5xl items-center justify-between px-4">
        <Logo variant="blue" width={130} href="/" priority />
        <a href={`tel:${tel}`} className="text-sm font-bold text-platinum-red sm:text-base">
          📞 {phone}
        </a>
      </div>
    </header>
  );
}
