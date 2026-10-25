// Place-name tidying for the venue form: "New York City, NY", "New York, NY", "NYC" and "NY, NY" all mean
// the same place, and "New Jersey" / "nj" / "N.J." all mean NJ. Pure, so it can be unit-tested.

const STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
  'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
}
const STATE_CODES = new Set(Object.values(STATES))

/** Lowercase, drop periods/commas/extra spaces: "N.J. " → "nj". */
const key = (s: string) => s.toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim()
const squash = (s: string) => key(s).replace(/ /g, '')

/** "New Jersey", "nj", "N.J." → "NJ". Unknown text is returned as typed (two letters are upper-cased). */
export function normalizeRegion(input: string): string {
  const t = input.trim()
  if (!t) return ''
  const code = STATES[key(t)]
  if (code) return code
  const sq = squash(t)
  if (sq.length === 2) return sq.toUpperCase()
  return t
}

interface Alias { names: string[]; city: string; region: string }
// Every name here is unambiguous once the state is known (or blank). Names are matched with key().
const ALIASES: Alias[] = [
  { names: ['new york city', 'nyc', 'new york', 'ny', 'ny ny', 'manhattan'], city: 'New York', region: 'NY' },
  { names: ['los angeles', 'la', 'l a'], city: 'Los Angeles', region: 'CA' },
  { names: ['san francisco', 'sf', 'san fran'], city: 'San Francisco', region: 'CA' },
  { names: ['philadelphia', 'philly'], city: 'Philadelphia', region: 'PA' },
  { names: ['chicago', 'chi'], city: 'Chicago', region: 'IL' },
  { names: ['new orleans', 'nola'], city: 'New Orleans', region: 'LA' },
  { names: ['las vegas', 'vegas'], city: 'Las Vegas', region: 'NV' },
  { names: ['atlanta', 'atl'], city: 'Atlanta', region: 'GA' },
  { names: ['baltimore', 'bmore'], city: 'Baltimore', region: 'MD' },
  { names: ['minneapolis', 'mpls'], city: 'Minneapolis', region: 'MN' },
  { names: ['washington dc', 'washington d c', 'dc'], city: 'Washington', region: 'DC' },
  { names: ['st louis', 'saint louis'], city: 'St. Louis', region: 'MO' },
  { names: ['st paul', 'saint paul'], city: 'Saint Paul', region: 'MN' },
  { names: ['st petersburg', 'saint petersburg'], city: 'St. Petersburg', region: 'FL' },
  { names: ['ft lauderdale', 'fort lauderdale'], city: 'Fort Lauderdale', region: 'FL' },
  { names: ['ft worth', 'fort worth'], city: 'Fort Worth', region: 'TX' },
]

/** "hoboken" / "HOBOKEN" → "Hoboken"; mixed case is left alone. */
function tidyCase(s: string): string {
  if (s.length <= 3 || (s !== s.toLowerCase() && s !== s.toUpperCase())) return s   // leave abbreviations like "NYC" alone
  return s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_m, a, b) => a + b.toUpperCase())
}

/**
 * Make the city/state a person typed consistent, so listings group properly and address lookup works.
 * Accepts "New York, NY" typed into the city box, state names, and common nicknames.
 * An alias is applied only when the state is blank or matches; "Washington" with state NJ is left alone.
 */
export function normalizePlace(cityIn: string, regionIn: string): { city: string; region: string } {
  let city = cityIn.trim().replace(/\s+/g, ' ')
  let region = normalizeRegion(regionIn)

  // "Hoboken, NJ" typed into the city box
  const comma = city.lastIndexOf(',')
  if (comma > 0) {
    const tail = normalizeRegion(city.slice(comma + 1))
    if (STATE_CODES.has(tail) && (!region || region === tail)) {
      city = city.slice(0, comma).trim()
      region = tail
    }
  }

  const k = squash(city)   // "N.Y.C." and "NYC" and "n y c" are the same
  const alias = ALIASES.find(a => a.names.some(n => squash(n) === k))
  if (alias && (!region || region === alias.region)) {
    // The bare names "ny" and "washington" are only taken as the big city when the state agrees or is blank.
    return { city: alias.city, region: alias.region }
  }
  return { city: tidyCase(city), region }
}
