type BrandIdentityProps = { compact?: boolean; className?: string; showCopy?: boolean }

export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span className={`meika-brand-mark ${className}`.trim()} aria-hidden="true">
      <svg viewBox="0 0 48 48">
        <rect x="2.5" y="2.5" width="43" height="43" rx="13" />
        <path className="meika-gate" d="M14 35V22.5C14 15.6 18.5 11 24 11s10 4.6 10 11.5V35" />
        <path className="meika-mountain" d="M12.5 31 19.5 24.9 24.6 29.1 34.5 19.7" />
        <circle cx="31.8" cy="16.2" r="2.4" />
      </svg>
    </span>
  )
}

export default function BrandIdentity({ compact = false, className = '', showCopy = true }: BrandIdentityProps) {
  return (
    <span className={`meika-brand ${compact ? 'compact' : ''} ${className}`.trim()}>
      <BrandMark />
      {showCopy && <span className="meika-brand-copy"><strong>美咖自媒体</strong>{!compact && <small>MEIKAAI · 内容工作台</small>}</span>}
    </span>
  )
}
