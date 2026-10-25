import { useStore, NO_FILTERS } from '../store'
import { FORMAT_OPTIONS, type DayOfWeek } from '../types'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function FilterBar({ count }: { count: number }) {
  const { filters, setFilters, clearFilters } = useStore()
  const active =
    filters.day !== NO_FILTERS.day || filters.tonight || filters.format !== null || filters.query !== ''

  return (
    <div className="space-y-2 p-3 border-b-2 border-line bg-surface">
      <input
        className="field"
        type="search"
        placeholder="Search venue, city, host, genre…"
        aria-label="Search open mics"
        value={filters.query}
        onChange={e => setFilters({ query: e.target.value })}
      />
      <div className="flex flex-wrap gap-1.5">
        <button className="chip" aria-pressed={filters.tonight} onClick={() => setFilters({ tonight: !filters.tonight })}>
          Tonight
        </button>
        {DAYS.map((d, i) => (
          <button
            key={d}
            className="chip"
            aria-pressed={filters.day === i}
            onClick={() => setFilters({ day: filters.day === i ? null : (i as DayOfWeek) })}
          >
            {d}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {FORMAT_OPTIONS.filter(f => f.value !== 'other').map(f => (
          <button
            key={f.value}
            className="chip"
            aria-pressed={filters.format === f.value}
            onClick={() => setFilters({ format: filters.format === f.value ? null : f.value })}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-mute">
          {count} open mic{count === 1 ? '' : 's'}
          {active && <> · <button className="underline" onClick={clearFilters}>clear</button></>}
        </span>
      </div>
    </div>
  )
}
