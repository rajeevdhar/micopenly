import { useEffect } from 'react'
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.markercluster'
import type { OpenMicWithVenue } from '../types'
import { isTonight } from '../lib/schedule'
import { groupByVenue } from '../store'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function pinIcon(name: string, selected: boolean, tonight: boolean, approx: boolean) {
  const cls = ['mo-pin', selected && 'is-selected', tonight && 'is-tonight', approx && 'is-approx'].filter(Boolean).join(' ')
  return new L.DivIcon({
    className: '',
    html: `<div class="${cls}">${esc(name.length > 22 ? name.slice(0, 21) + '…' : name)}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })
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
    for (const [venueId, list] of groupByVenue(mics)) {
      const venue = list[0].venue
      const tonight = list.some(m => isTonight(m, m.venue.timezone))
      const marker = L.marker([venue.lat, venue.lng], {
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
      const b = L.latLngBounds(mics.map(m => [m.venue.lat, m.venue.lng] as [number, number]))
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
    if (v) map.flyTo([v.lat, v.lng], Math.max(map.getZoom(), 13), { duration: 0.8 })
  }, [selectedVenueId]) // eslint-disable-line react-hooks/exhaustive-deps
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
      <Deselect onSelect={onSelect} />
    </MapContainer>
  )
}
