/**
 * Shared UI kit, restyled to the RE/MAX Platinum design system (Section 15.4):
 * pill CTAs, color-coded status pills, flat clean cards, slide-over panel.
 * Tailwind classes only; tokens from tailwind.config.ts.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

// --- Button -----------------------------------------------------------------
type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost' | 'dark';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonVariants: Record<ButtonVariant, string> = {
  // Primary CTA: pill, Platinum Red, white text, hover darkens to Red Hover.
  primary: 'bg-platinum-red text-white hover:bg-platinum-redHover',
  // Secondary: white/transparent, 1.5px border, hover darkens border.
  secondary: 'bg-white text-charcoal border-[1.5px] border-line hover:border-charcoal',
  outline: 'bg-transparent text-charcoal border-[1.5px] border-line hover:bg-offwhite',
  danger: 'bg-platinum-red text-white hover:bg-platinum-redHover',
  ghost: 'bg-transparent text-mute hover:bg-offwhite',
  dark: 'bg-charcoal text-white hover:bg-charcoal-light',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'px-4 py-1.5 text-[13px]',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-8 py-3.5 text-base',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center rounded-pill font-bold transition-colors disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus:ring-2 focus:ring-platinum-blue/40',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';

// --- Input ------------------------------------------------------------------
const fieldBase =
  'w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm text-ink shadow-sm placeholder:text-mute-lighter focus:border-platinum-blue focus:outline-none focus:ring-1 focus:ring-platinum-blue';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(fieldBase, className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, className)} {...props} />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(fieldBase, className)} {...props}>
    {children}
  </select>
));
Select.displayName = 'Select';

// --- Label ------------------------------------------------------------------
export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn('mb-1.5 block text-sm font-semibold text-charcoal', className)} {...props} />
  );
}

// --- Card -------------------------------------------------------------------
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border border-line bg-white', className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-b border-line px-5 py-4', className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-5', className)} {...props} />;
}

// --- Badge / status pill ----------------------------------------------------
export type PillTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'purple';

const pillTones: Record<PillTone, string> = {
  neutral: 'bg-line-hair text-mute',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-platinum-red',
  info: 'bg-[#E6ECFF] text-platinum-blue',
  purple: 'bg-brandpurple-bg text-brandpurple',
};

export function Badge({
  className,
  tone = 'neutral',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: PillTone }) {
  // Let callers that pass their own bg-* color in className win over the tone.
  const hasBgOverride = !!className && /(^|\s)bg-/.test(className);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-pill px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide',
        !hasBgOverride && pillTones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Map a lead/offer status string to a pill tone (Section 15.3 / 17.3). */
export function statusTone(status: string): PillTone {
  switch (status) {
    case 'accepted':
    case 'qualified':
    case 'closed':
    case 'listing_signed':
      return 'success';
    case 'contacted':
    case 'offered':
    case 'pending':
    case 'working':
      return 'warning';
    case 'attempted_contact':
      return 'info';
    case 'expired':
    case 'declined':
    case 'lost':
    case 'unassigned':
      return 'danger';
    case 'appointment_set':
      return 'purple';
    case 'new':
      return 'info';
    default:
      return 'neutral';
  }
}

// --- Slide-over panel (Section 15.4) ----------------------------------------
export function SlideOver({
  open,
  onClose,
  title,
  children,
  width = 'min(460px,94vw)',
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 animate-fadeIn bg-[rgba(20,20,24,0.4)]"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        style={{ width }}
        className="absolute right-0 top-0 bottom-0 flex animate-slideOver flex-col bg-white shadow-[-12px_0_40px_rgba(20,20,24,0.18)]"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="font-bold text-charcoal">{title}</div>
          <button
            onClick={onClose}
            className="rounded-pill px-2 text-2xl leading-none text-mute-light hover:text-charcoal"
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </aside>
    </div>
  );
}

// --- Toggle switch (Section 16.4) -------------------------------------------
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-pill transition-colors disabled:opacity-50',
        checked ? 'bg-success' : 'bg-mute-lighter',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
