// src/lib/geo.js
// Geolocation, distance intelligence, and routing calculation

export const DEFAULT_LOCATION = {
  name: 'City Central Emergency Zone',
  shortName: 'Central Zone',
  lat: 17.5605,
  lng: 78.4550,
}

export function haversineKm(a, b, c, d) {
  let lat1, lng1, lat2, lng2
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    lat1 = Number(a.lat)
    lng1 = Number(a.lng)
    lat2 = Number(b.lat)
    lng2 = Number(b.lng)
  } else {
    lat1 = Number(a)
    lng1 = Number(b)
    lat2 = Number(c)
    lng2 = Number(d)
  }

  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lng2)
  ) {
    return 0
  }

  const R = 6371
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h =
    sinLat * sinLat +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLng * sinLng
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))))
}

export function formatDistance(km) {
  if (km == null || Number.isNaN(km)) return '--'
  if (km < 1) {
    return `${Math.round(km * 1000)} m`
  }
  return `${km.toFixed(1)} km`
}

export function estimateDrivingEtaMinutes(km) {
  if (km == null || Number.isNaN(km) || km <= 0) return 1
  const minutes = Math.round((km / 38) * 60 + 1.2)
  return Math.max(1, minutes)
}

/**
 * Generates an interpolated realistic road route polyline between two points
 */
export function generateRoutePoints(start, end) {
  if (!start || !end) return []
  const points = [[start.lat, start.lng]]
  const dLat = end.lat - start.lat
  const dLng = end.lng - start.lng

  const midLat = start.lat + dLat * 0.45
  const midLng = start.lng + dLng * 0.55

  points.push([midLat, start.lng + dLng * 0.15])
  points.push([midLat, midLng])
  points.push([start.lat + dLat * 0.85, midLng])
  points.push([end.lat, end.lng])

  return points
}