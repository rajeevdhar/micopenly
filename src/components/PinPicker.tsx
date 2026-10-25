import { useEffect } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'

const icon = new L.DivIcon({
  className: '',
  html: '<div style="transform:translate(-50%,-100%);width:22px;height:22px;background:#d9480f;border:3px solid #fff;border-radius:50% 50% 50% 0;rotate:-45deg;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>',
  iconSize: [0, 0],
})

type Pos = { lat: number; lng: number }

function Recenter({ pos }: { pos: Pos | null }) {
  const map = useMap()
  useEffect(() => {
    if (pos) map.setView([pos.lat, pos.lng], Math.max(map.getZoom(), 16))
  }, [pos?.lat, pos?.lng]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

function ClickToPlace({ onChange }: { onChange: (p: Pos) => void }) {
  useMapEvents({ click: e => onChange({ lat: e.latlng.lat, lng: e.latlng.lng }) })
  return null
}

/** Small map with a draggable pin. Click the map or drag the pin to fine-tune the location. */
export default function PinPicker({ pos, onChange }: { pos: Pos | null; onChange: (p: Pos) => void }) {
  return (
    <div className="h-56 border-2 border-ink">
      <MapContainer center={pos ? [pos.lat, pos.lng] : [39.8283, -98.5795]} zoom={pos ? 16 : 3} className="w-full h-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        {pos && (
          <Marker
            position={[pos.lat, pos.lng]}
            icon={icon}
            draggable
            eventHandlers={{
              dragend: e => {
                const ll = (e.target as L.Marker).getLatLng()
                onChange({ lat: ll.lat, lng: ll.lng })
              },
            }}
          />
        )}
        <Recenter pos={pos} />
        <ClickToPlace onChange={onChange} />
      </MapContainer>
    </div>
  )
}
