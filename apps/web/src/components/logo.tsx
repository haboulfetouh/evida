/** Wordmark: three bars of decreasing length — evidence accumulating into a decision. */
export function Logo({ compact, inverse }: { compact?: boolean; inverse?: boolean }) {
  return (
    <span className={inverse ? 'inline-flex items-center gap-2 font-semibold text-white' : 'inline-flex items-center gap-2 font-semibold text-ink'}>
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="6" className={inverse ? 'fill-white' : 'fill-brand'} />
        <rect x="7" y="9" width="18" height="3" className={inverse ? 'fill-brand' : 'fill-white'} />
        <rect x="7" y="15" width="12" height="3" className={inverse ? 'fill-brand' : 'fill-white'} />
        <rect x="7" y="21" width="6" height="3" className={inverse ? 'fill-brand' : 'fill-white'} opacity=".5" />
      </svg>
      {!compact && <span className="tracking-[0.08em]">EVIDA</span>}
    </span>
  );
}
