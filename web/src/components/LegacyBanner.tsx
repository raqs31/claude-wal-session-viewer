export const LegacyBanner = ({ count }: { count: number }) =>
  count > 0 && (
    <div className="banner" role="status">
      {count} legacy WAL file{count === 1 ? '' : 's'} — run <code>wal legacy</code>
    </div>
  )
