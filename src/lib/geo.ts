// Distance helpers for "Near me". Everything here runs in the browser; the visitor's position is never sent anywhere.

export interface Point { lat: number; lng: number }

const EARTH_MILES = 3958.8
const rad = (d: number) => (d * Math.PI) / 180

/** Great-circle distance in miles. */
export function distanceMiles(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** "0.4 mi", "3.2 mi", "27 mi", "120 mi". */
export function formatMiles(mi: number): string {
  if (!Number.isFinite(mi)) return ''
  if (mi < 0.1) return 'under 0.1 mi'
  if (mi < 10) return `${mi.toFixed(1)} mi`
  return `${Math.round(mi)} mi`
}

/** Sorts nearest first without changing the input. Items with a missing position go last. */
export function sortByDistance<T>(items: T[], from: Point, at: (t: T) => Point | null): T[] {
  const d = (t: T) => { const p = at(t); return p ? distanceMiles(from, p) : Infinity }
  return [...items].sort((x, y) => d(x) - d(y))
}
