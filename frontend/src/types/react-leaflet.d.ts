declare module 'react-leaflet' {
  import type { ReactNode } from 'react'
  import type * as L from 'leaflet'

  export interface MapContainerProps {
    center?: [number, number]
    zoom?: number
    children?: ReactNode
    style?: React.CSSProperties
    onClick?: (e: any) => void
  }

  export interface TileLayerProps {
    url: string
    attribution?: string
  }

  export interface MarkerProps {
    position: [number, number]
    children?: ReactNode
  }

  export interface PopupProps {
    children?: ReactNode
  }

  export const MapContainer: React.ComponentType<MapContainerProps>
  export const TileLayer: React.ComponentType<TileLayerProps>
  export const Marker: React.ComponentType<MarkerProps>
  export const Popup: React.ComponentType<PopupProps>
}
