/**
 * "We already have a valuation for you — check your email" (decision D3).
 *
 * Shown when a submit matched an existing lead by email or phone. The server
 * deliberately tells the browser nothing about that record: not its id, not its
 * report token, not the name or address on it, and not even which field
 * matched. A contact match is not proof of identity — anyone who knows a
 * victim's email or phone, plus shared/recycled numbers and plain typos, would
 * otherwise pull up someone else's report.
 *
 * So the report link goes to the inbox already on file, and clicking it is what
 * proves possession. This component exists to make that feel like a normal,
 * finished outcome rather than a dead end.
 */
export default function ExistingRecordNotice({ emailed }: { emailed: boolean }) {
  return (
    <div
      role="status"
      className="rounded-card border border-line bg-cream px-5 py-5 text-center"
    >
      <p className="text-base font-bold text-charcoal">You&apos;re already in our system</p>
      {emailed ? (
        <p className="mt-2 text-sm leading-relaxed text-mute">
          We just emailed a secure link to your valuation report. Check your inbox — and your
          spam folder, just in case. For your privacy we only ever send that link to the email
          address already on your account.
        </p>
      ) : (
        <p className="mt-2 text-sm leading-relaxed text-mute">
          We have a valuation on file for you. A RE/MAX Platinum agent will be in touch shortly
          — or call us and we&apos;ll walk you through it.
        </p>
      )}
    </div>
  );
}
