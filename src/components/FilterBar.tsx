import { useStore, NO_FILTERS } from '../store'
import { FORMAT_OPTIONS, type DayOfWeek } from '../types'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** Shorter names for the filter chips so they fit on one or two lines on a phone. */
const CHIP_LABEL: Record<string, string> = { poetry: 'Poetry' }

function PinIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" />
    </svg>
  )
}

export default function FilterBar({ count }: { count: number }) {
  const { filters, setFilters, clearFilters, userPos, locating, locateError, locate, sort, setSort } = useStore()
  const active =
    filters.day !== NO_FILTERS.day || filters.tonight || filters.format !== null || filters.query !== ''

  const toggleNearMe = () => {
    if (userPos) useStore.setState({ userPos: null, sort: 'soonest', locateError: '' })
    else locate()
  }

  return (
    <div className="space-y-2 p-3 border-b-2 border-line bg-surface">
      <div className="flex gap-2">
        <input
          className="field min-w-0 flex-1"
          type="search"
          placeholder="Search venue, town, host or genre"
          aria-label="Search open mics"
          value={filters.query}
          onChange={e => setFilters({ query: e.target.value })}
        />
        <button
          className="btn shrink-0 gap-1.5 px-3"
          aria-pressed={!!userPos}
          disabled={locating}
          onClick={toggleNearMe}
          title={userPos ? 'Stop using your location' : 'Sort by distance from you'}
        >
          <PinIcon />{locating ? 'Locating…' : userPos ? 'Near you ✓' : 'Near me'}
        </button>
      </div>
      {locateError && <p role="alert" className="text-xs text-accent-dark font-bold">{locateError}</p>}

      <div role="group" aria-label="Day of the week" className="grid grid-cols-7 gap-1">
        {DAYS.map((d, i) => (
          <button
            key={d}
            className="chip !px-0"
            aria-pressed={filters.day === i}
            onClick={() => setFilters({ day: filters.day === i ? null : (i as DayOfWeek) })}
          >
            {d}
          </button>
        ))}
      </div>

      <div role="group" aria-label="Tonight and type" className="flex flex-wrap gap-1.5">
        <button className="chip chip-tonight" aria-pressed={filters.tonight} onClick={() => setFilters({ tonight: !filters.tonight })}>
          Tonight
        </button>
        {FORMAT_OPTIONS.filter(f => f.value !== 'other').map(f => (
          <button
            key={f.value}
            className="chip"
            aria-pressed={filters.format === f.value}
            onClick={() => setFilters({ format: filters.format === f.value ? null : f.value })}
          >
            {CHIP_LABEL[f.value] ?? f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mute">
        <span className="font-bold text-ink">{count} open mic{count === 1 ? '' : 's'}</span>
        {userPos && (
          <span role="group" aria-label="Sort order" className="inline-flex items-center gap-1">
            Sort:
            <button className="underline-offset-2 data-[on=true]:font-extrabold data-[on=true]:text-ink data-[on=true]:underline" data-on={sort === 'nearest'} aria-pressed={sort === 'nearest'} onClick={() => setSort('nearest')}>Nearest</button>
            <span aria-hidden="true">·</span>
            <button className="underline-offset-2 data-[on=true]:font-extrabold data-[on=true]:text-ink data-[on=true]:underline" data-on={sort === 'soonest'} aria-pressed={sort === 'soonest'} onClick={() => setSort('soonest')}>Soonest</button>
          </span>
        )}
        {active && <button className="ml-auto underline" onClick={clearFilters}>Clear filters</button>}
      </div>
    </div>
  )
}
