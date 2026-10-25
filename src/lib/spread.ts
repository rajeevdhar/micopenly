// Hidden venues are pinned at the centre of their town (2-decimal coordinates), so several in one town
// would sit exactly on top of each other. This spreads them on a small ring around that point so
// they separate when zoomed in. The offset is deterministic and uses only public data, so it
// reveals nothing; the marker is still only "somewhere in town".

export interface Spot { id: string; lat: number; lng: number; hidden: boolean }

const BASE_RADIUS = 0.0022   // degrees of latitude, ~240 m
const MAX_RADIUS = 0.0045    // ~500 m: never drifts far from the town point, however many share it

/** Display positions by venue id. Visible venues and lone hidden venues keep their coordinates. */
export function spreadOverlaps(spots: Spot[]): Map<string, { lat: number; lng: number }> {
  const out = new Map<string, { lat: number; lng: number }>()
  const groups = new Map<string, Spot[]>()
  for (const s of spots) {
    out.set(s.id, { lat: s.lat, lng: s.lng })
    if (!s.hidden) continue
    const k = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`
    groups.set(k, [...(groups.get(k) ?? []), s])
  }
  for (const group of groups.values()) {
    const n = group.length
    if (n < 2) continue
    const ordered = [...group].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const r = Math.min(MAX_RADIUS, BASE_RADIUS * (1 + (n - 1) / 6))
    ordered.forEach((s, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / n
      const lngScale = Math.cos((s.lat * Math.PI) / 180) || 1
      out.set(s.id, { lat: s.lat + r * Math.sin(angle), lng: s.lng + (r * Math.cos(angle)) / lngScale })
    })
  }
  return out
}
