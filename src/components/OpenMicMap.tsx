import { useEffect } from 'react'
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.markercluster'
import type { OpenMicWithVenue } from '../types'
import { isTonight } from '../lib/schedule'
import { groupByVenue } from '../store'
import { spreadOverlaps } from '../lib/spread'
import { distanceMiles } from '../lib/geo'
import { useStore } from '../store'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Pins carry a short label so a crowded map stays readable; the selected pin shows the full name. */
const pinLabel = (name: string, selected: boolean) => {
  const max = selected ? 44 : 26
  return name.length > max ? name.slice(0, max - 1) + '…' : name
}

function pinIcon(name: string, selected: boolean, tonight: boolean, approx: boolean) {
  const cls = ['mo-pin', selected && 'is-selected', tonight && 'is-tonight', approx && 'is-approx'].filter(Boolean).join(' ')
  return new L.DivIcon({
    className: '',
    html: `<div class="${cls}">${esc(pinLabel(name, selected))}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })
}

/** Where each venue is drawn: hidden venues that share a town pin are fanned out so they don't overlap. */
function displaySpots(mics: OpenMicWithVenue[]) {
  const venues = [...groupByVenue(mics).values()].map(list => list[0].venue)
  return spreadOverlaps(venues.map(v => ({ id: v.id, lat: v.lat, lng: v.lng, hidden: v.locationHidden })))
}

function Markers({ mics, selectedVenueId, onSelect }: {
  mics: OpenMicWithVenue[]
  selectedVenueId: string | null
  onSelect: (id: string | null) => void
}) {
  const map = useMap()

  useEffect(() => {
    const group = L.markerClusterGroup({
      iconCreateFunction: c => new L.DivIcon({
        className: '',
        html: `<div class="mo-cluster">${c.getChildCount()}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
      maxClusterRadius: 50,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
    })
    const spots = displaySpots(mics)
    for (const [venueId, list] of groupByVenue(mics)) {
      const venue = list[0].venue
      const at = spots.get(venueId) ?? venue
      const tonight = list.some(m => isTonight(m, m.venue.timezone))
      const marker = L.marker([at.lat, at.lng], {
        icon: pinIcon(venue.name, venueId === selectedVenueId, tonight, venue.locationHidden),
        zIndexOffset: venueId === selectedVenueId ? 1000 : 0,
        keyboard: true,
        title: venue.locationHidden ? `${venue.name} (approximate location)` : venue.name,
      })
      marker.on('click', (e: L.LeafletMouseEvent) => {
        e.originalEvent.stopPropagation()
        onSelect(venueId === selectedVenueId ? null : venueId)
      })
      group.addLayer(marker)
    }
    map.addLayer(group)

    // Fit the map to what's showing (only when nothing is selected, so selecting doesn't jump the view).
    if (!selectedVenueId && mics.length) {
      const b = L.latLngBounds(mics.map(m => { const p = spots.get(m.venueId) ?? m.venue; return [p.lat, p.lng] as [number, number] }))
      map.fitBounds(b, { padding: [50, 50], maxZoom: 13 })
    }
    return () => { map.removeLayer(group) }
  }, [mics, selectedVenueId]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

function FlyToSelected({ mics, selectedVenueId }: { mics: OpenMicWithVenue[]; selectedVenueId: string | null }) {
  const map = useMap()
  useEffect(() => {
    const v = mics.find(m => m.venueId === selectedVenueId)?.venue
    if (v) {
      const at = displaySpots(mics).get(v.id) ?? v
      // Hidden venues sit near others in the same town, so zoom in far enough for them to separate.
      map.flyTo([at.lat, at.lng], Math.max(map.getZoom(), v.locationHidden ? 15 : 13), { duration: 0.8 })
    }
  }, [selectedVenueId]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

/** When the visitor shares their location: show a dot for them and frame it with the closest few venues. */
function ShowUser({ mics }: { mics: OpenMicWithVenue[] }) {
  const map = useMap()
  const userPos = useStore(s => s.userPos)
  useEffect(() => {
    if (!userPos) return
    const dot = L.marker([userPos.lat, userPos.lng], {
      icon: new L.DivIcon({ className: '', html: '<div class="mo-me"></div>', iconSize: [0, 0], iconAnchor: [0, 0] }),
      interactive: false, keyboard: false, zIndexOffset: 2000,
    }).addTo(map)
    const nearest = [...new Map(mics.map(m => [m.venueId, m.venue])).values()]
      .sort((a, b) => distanceMiles(userPos, a) - distanceMiles(userPos, b)).slice(0, 3)
    const bounds = L.latLngBounds([[userPos.lat, userPos.lng], ...nearest.map(v => [v.lat, v.lng] as [number, number])])
    map.flyToBounds(bounds, { padding: [60, 60], maxZoom: 12, duration: 0.8 })
    return () => { dot.remove() }
  }, [userPos]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

function Deselect({ onSelect }: { onSelect: (id: string | null) => void }) {
  useMapEvents({ click: () => onSelect(null) })
  return null
}

export default function OpenMicMap({ mics, selectedVenueId, onSelect }: {
  mics: OpenMicWithVenue[]
  selectedVenueId: string | null
  onSelect: (id: string | null) => void
}) {
  return (
    <MapContainer center={[39.8283, -98.5795]} zoom={4} className="w-full h-full" zoomControl>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <Markers mics={mics} selectedVenueId={selectedVenueId} onSelect={onSelect} />
      <FlyToSelected mics={mics} selectedVenueId={selectedVenueId} />
      <ShowUser mics={mics} />
      <Deselect onSelect={onSelect} />
    </MapContainer>
  )
}
