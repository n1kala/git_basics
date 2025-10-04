import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

interface MapViewProps {
  lat: number
  lon: number
  zoom?: number
  onSelect?: (lat: number, lon: number) => void
}

export default function MapView({ lat, lon, zoom = 8, onSelect }: MapViewProps) {
  return (
    <MapContainer
      center={[lat, lon]}
      zoom={zoom}
      style={{ height: '100%', width: '100%' }}
      onClick={(e: any) => {
        if (!onSelect) return
        const { latlng } = e
        if (latlng) onSelect(latlng.lat, latlng.lng)
      }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={[lat, lon]}>
        <Popup>Selected location</Popup>
      </Marker>
    </MapContainer>
  )
}
