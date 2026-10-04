// src/pages/Responder.jsx (First-Responder Field Console & Fleet Management)
import { useEffect, useState, useMemo, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  Radio,
  Navigation,
  CheckCircle,
  MapPin,
  RefreshCw,
  Flame,
  Activity,
  Car,
  Shield,
  LifeBuoy,
  ChevronRight,
  Users,
  Check
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { haversineKm, formatDistance, estimateDrivingEtaMinutes, generateRoutePoints } from '../lib/geo'

/* ===================== MAP CUSTOM ICONS ===================== */
const createMarkerIcon = (color, symbol) =>
  L.divIcon({
    className: '',
    html: `
      <div style="position:relative;display:flex;align-items:center;justify-content:center;">
        <div style="position:absolute;width:28px;height:28px;border-radius:9999px;background:${color}33;animation:pulse 2s infinite;"></div>
        <div style="position:relative;width:22px;height:22px;border-radius:9999px;background:${color};border:2px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:bold;">
          ${symbol}
        </div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })

const meMarker = createMarkerIcon('#16a34a', '🚑')
const incidentMarker = createMarkerIcon('#dc2626', '🚨')

function FitBounds({ points }) {
  const map = useMap()
  useEffect(() => {
    if (points && points.length > 1) {
      map.fitBounds(points, { padding: [50, 50], maxZoom: 16 })
    }
  }, [map, points])
  return null
}

const TYPE_ICONS = {
  medical: Activity,
  fire: Flame,
  accident: Car,
  crime: Shield,
  other: LifeBuoy,
}

export default function Responder() {
  const [responders, setResponders] = useState([])
  const [selectedResponder, setSelectedResponder] = useState('')
  const [incidents, setIncidents] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [selectedIncidentId, setSelectedIncidentId] = useState(null)
  const [activeTab, setActiveTab] = useState('fleet') // 'fleet' | 'assigned' | 'pending' | 'resolved'
  const [fleetFilter, setFleetFilter] = useState('all') // 'all' | 'medical' | 'fire' | 'police' | 'volunteer'
  const [actionLoading, setActionLoading] = useState(false)

  const loadData = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true)
    else setRefreshing(true)
    setError('')

    try {
      const [respondersResult, incidentsResult] = await Promise.all([
        supabase.from('responders').select('id, name, type, status, lat, lng').order('name'),
        supabase
          .from('incidents')
          .select(
            'id, type, description, severity, lat, lng, status, notified_responder, assigned_to, escalated, notified_at, created_at'
          )
          .order('created_at', { ascending: false }),
      ])

      if (respondersResult.error) throw respondersResult.error
      if (incidentsResult.error) throw incidentsResult.error

      setResponders(respondersResult.data || [])
      setIncidents(incidentsResult.data || [])

      setSelectedResponder((prev) => {
        if (prev) return prev
        return respondersResult.data?.[0]?.id || ''
      })
    } catch (err) {
      setError(err?.message || 'Failed to sync with dispatch backend.')
    } finally {
      if (showSpinner) setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    let ignore = false
    async function init() {
      await Promise.resolve()
      if (!ignore) {
        loadData(true)
      }
    }
    init()
    return () => {
      ignore = true
    }
  }, [loadData])

  // Real-time synchronization with Supabase
  useEffect(() => {
    const channel = supabase
      .channel('responder-live-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents' }, () => {
        loadData(false)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'responders' }, () => {
        loadData(false)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadData])

  const activeResponderObj = useMemo(() => {
    return responders.find((r) => String(r.id) === String(selectedResponder)) || null
  }, [responders, selectedResponder])

  /* ---- Derived incident queues ---- */
  const assignedToMe = useMemo(() => {
    if (!selectedResponder) return []
    return incidents.filter(
      (i) => String(i.assigned_to) === String(selectedResponder) && i.status !== 'resolved'
    )
  }, [incidents, selectedResponder])

  const pendingUnassigned = useMemo(() => {
    return incidents.filter(
      (i) => (!i.assigned_to || i.status === 'reported') && i.status !== 'resolved'
    )
  }, [incidents])

  const resolvedHistory = useMemo(() => {
    if (!selectedResponder) return []
    return incidents.filter(
      (i) => String(i.assigned_to) === String(selectedResponder) && i.status === 'resolved'
    )
  }, [incidents, selectedResponder])

  // Filtered responders for Fleet tab
  const filteredResponders = useMemo(() => {
    if (fleetFilter === 'all') return responders
    return responders.filter((r) => r.type === fleetFilter)
  }, [responders, fleetFilter])

  // Current active incident for the map / routing
  const activeFocusIncident = useMemo(() => {
    if (selectedIncidentId) {
      const found = incidents.find((i) => i.id === selectedIncidentId)
      if (found) return found
    }
    if (assignedToMe.length > 0) return assignedToMe[0]
    if (pendingUnassigned.length > 0) return pendingUnassigned[0]
    return null
  }, [selectedIncidentId, assignedToMe, pendingUnassigned, incidents])

  async function acceptIncident(incidentId) {
    if (!selectedResponder) {
      setError('Please select an active responder unit.')
      return
    }

    setActionLoading(true)
    setError('')
    setMessage('')

    try {
      const { error: rpcError } = await supabase.rpc('accept_incident', {
        p_incident: incidentId,
        p_responder: selectedResponder,
      })

      if (rpcError) {
        const { error: directErr } = await supabase
          .from('incidents')
          .update({ assigned_to: selectedResponder, status: 'assigned' })
          .eq('id', incidentId)

        if (directErr) throw directErr
      }

      await supabase.from('responders').update({ status: 'busy' }).eq('id', selectedResponder)

      setMessage('Emergency dispatch accepted! Route navigation is now active.')
      setSelectedIncidentId(incidentId)
      setActiveTab('assigned')
      await loadData(false)
    } catch (err) {
      setError(err?.message || 'Failed to accept dispatch.')
    } finally {
      setActionLoading(false)
    }
  }

  async function updateIncidentStatus(incidentId, status) {
    setActionLoading(true)
    setError('')
    setMessage('')

    try {
      const { error: rpcError } = await supabase.rpc('update_status', {
        p_incident: incidentId,
        p_status: status,
      })

      if (rpcError) {
        const { error: directErr } = await supabase
          .from('incidents')
          .update({ status: status })
          .eq('id', incidentId)

        if (directErr) throw directErr
      }

      if (status === 'resolved' && selectedResponder) {
        await supabase.from('responders').update({ status: 'available' }).eq('id', selectedResponder)
      }

      setMessage(`Incident status updated to "${status.replace('_', ' ').toUpperCase()}".`)
      await loadData(false)
    } catch (err) {
      setError(err?.message || 'Failed to update incident status.')
    } finally {
      setActionLoading(false)
    }
  }

  // Coordinates & route calculation
  const responderCoords = useMemo(() => {
    if (activeResponderObj?.lat != null && activeResponderObj?.lng != null) {
      return { lat: Number(activeResponderObj.lat), lng: Number(activeResponderObj.lng) }
    }
    return null
  }, [activeResponderObj])

  const incidentCoords = useMemo(() => {
    if (activeFocusIncident?.lat != null && activeFocusIncident?.lng != null) {
      return { lat: Number(activeFocusIncident.lat), lng: Number(activeFocusIncident.lng) }
    }
    return null
  }, [activeFocusIncident])

  const distanceKm = useMemo(() => {
    if (!responderCoords || !incidentCoords) return null
    return haversineKm(responderCoords, incidentCoords)
  }, [responderCoords, incidentCoords])

  const drivingEta = useMemo(() => {
    if (distanceKm == null) return null
    return estimateDrivingEtaMinutes(distanceKm)
  }, [distanceKm])

  const routePoints = useMemo(() => {
    if (!responderCoords || !incidentCoords) return []
    return generateRoutePoints(responderCoords, incidentCoords)
  }, [responderCoords, incidentCoords])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600">Connecting to tactical dispatch network...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {/* Terminal Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-500/30">
              <Radio className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-slate-900">Responder Mobile Terminal</h1>
                <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Active Link
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Logged in as: <strong className="text-slate-800">{activeResponderObj?.name || 'Select a Responder'}</strong>
                {activeResponderObj && (
                  <span className={`ml-2 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${activeResponderObj.status === 'available' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                    {activeResponderObj.status}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Unit Dropdown Switcher */}
          <div className="flex items-center gap-2">
            <select
              value={selectedResponder}
              onChange={(e) => {
                setSelectedResponder(e.target.value)
                setSelectedIncidentId(null)
              }}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              {responders.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.type.toUpperCase()}) — {r.status}
                </option>
              ))}
            </select>
            <button
              onClick={() => loadData(false)}
              className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900 transition"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin text-blue-600' : ''}`} />
            </button>
          </div>
        </div>

        {/* Status Messages */}
        {message && (
          <div className="mb-4 flex items-center justify-between rounded-xl bg-emerald-50 border border-emerald-200 p-3.5 text-xs font-semibold text-emerald-800">
            <span>{message}</span>
            <button onClick={() => setMessage('')} className="font-bold hover:underline">
              Dismiss
            </button>
          </div>
        )}
        {error && (
          <div className="mb-4 flex items-center justify-between rounded-xl bg-red-50 border border-red-200 p-3.5 text-xs font-semibold text-red-800">
            <span>{error}</span>
            <button onClick={() => setError('')} className="font-bold hover:underline">
              Dismiss
            </button>
          </div>
        )}

        {/* Active Emergency Navigation & Tactical Route Card (if selected) */}
        {activeFocusIncident && incidentCoords && (
          <div className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="grid grid-cols-1 lg:grid-cols-12">
              {/* Map Column */}
              <div className="relative h-60 lg:h-auto lg:col-span-7 border-b lg:border-b-0 lg:border-r border-slate-200">
                <MapContainer center={[incidentCoords.lat, incidentCoords.lng]} zoom={15} className="z-0 h-full w-full">
                  <TileLayer
                    attribution='&copy; <a href="https://openstreetmap.org">OSM</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <Marker position={[incidentCoords.lat, incidentCoords.lng]} icon={incidentMarker} />
                  {responderCoords && <Marker position={[responderCoords.lat, responderCoords.lng]} icon={meMarker} />}
                  {routePoints.length > 0 && <Polyline positions={routePoints} color="#2563eb" weight={4} />}
                  <FitBounds
                    points={
                      responderCoords
                        ? [[incidentCoords.lat, incidentCoords.lng], [responderCoords.lat, responderCoords.lng]]
                        : []
                    }
                  />
                </MapContainer>

                <a
                  href={
                    responderCoords
                      ? `https://www.google.com/maps/dir/?api=1&origin=${responderCoords.lat},${responderCoords.lng}&destination=${incidentCoords.lat},${incidentCoords.lng}`
                      : `https://www.google.com/maps/search/?api=1&query=${incidentCoords.lat},${incidentCoords.lng}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-bold text-blue-600 shadow-md border border-slate-200 hover:bg-white transition"
                >
                  <Navigation className="h-3.5 w-3.5" />
                  Open Navigation (Google Maps)
                </a>
              </div>

              {/* Mission Details & Action Column */}
              <div className="p-5 lg:col-span-5 flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-red-700">
                      {activeFocusIncident.type}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase ${activeFocusIncident.escalated
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-700'
                        }`}
                    >
                      {activeFocusIncident.escalated ? 'Escalated' : activeFocusIncident.status}
                    </span>
                  </div>

                  <h3 className="mt-2 text-base font-bold text-slate-900 leading-snug">
                    {activeFocusIncident.description || 'Emergency incident reported'}
                  </h3>

                  <p className="mt-1 text-xs text-slate-500">
                    Target: {activeFocusIncident.lat?.toFixed(4)}, {activeFocusIncident.lng?.toFixed(4)}
                  </p>

                  {/* Route Telemetry Box */}
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5">
                      <span className="text-[10px] uppercase font-bold text-slate-400">Route Distance</span>
                      <p className="text-base font-extrabold text-slate-900">
                        {distanceKm != null ? formatDistance(distanceKm) : '--'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5">
                      <span className="text-[10px] uppercase font-bold text-slate-400">Est. Driving Time</span>
                      <p className="text-base font-extrabold text-emerald-600">
                        {drivingEta != null ? `${drivingEta} mins` : '--'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Status Update Buttons */}
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  {!activeFocusIncident.assigned_to && activeFocusIncident.status !== 'resolved' && (
                    <button
                      onClick={() => acceptIncident(activeFocusIncident.id)}
                      disabled={actionLoading}
                      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 font-bold text-white text-xs hover:bg-blue-700 shadow-sm transition disabled:opacity-50"
                    >
                      <CheckCircle className="h-4 w-4" />
                      Accept Dispatch as {activeResponderObj?.name}
                    </button>
                  )}

                  {String(activeFocusIncident.assigned_to) === String(selectedResponder) && (
                    <>
                      {activeFocusIncident.status === 'assigned' && (
                        <button
                          onClick={() => updateIncidentStatus(activeFocusIncident.id, 'en_route')}
                          disabled={actionLoading}
                          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 font-bold text-white text-xs hover:bg-indigo-700 shadow-sm transition disabled:opacity-50"
                        >
                          <Navigation className="h-4 w-4" />
                          Mark as En Route
                        </button>
                      )}

                      {activeFocusIncident.status === 'en_route' && (
                        <button
                          onClick={() => updateIncidentStatus(activeFocusIncident.id, 'arrived')}
                          disabled={actionLoading}
                          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-600 font-bold text-white text-xs hover:bg-amber-700 shadow-sm transition disabled:opacity-50"
                        >
                          <MapPin className="h-4 w-4" />
                          Mark as Arrived on Scene
                        </button>
                      )}

                      {activeFocusIncident.status === 'arrived' && (
                        <button
                          onClick={() => updateIncidentStatus(activeFocusIncident.id, 'resolved')}
                          disabled={actionLoading}
                          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 font-bold text-white text-xs hover:bg-emerald-700 shadow-sm transition disabled:opacity-50"
                        >
                          <CheckCircle className="h-4 w-4" />
                          Mark Incident Resolved
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Navigation Tabs (Fleet Directory vs Incidents) */}
        <div className="mb-4 flex flex-wrap rounded-xl bg-slate-200/70 p-1 text-xs font-bold gap-1 sm:gap-0">
          <button
            onClick={() => setActiveTab('fleet')}
            className={`flex-1 min-w-[130px] rounded-lg py-2 transition flex items-center justify-center gap-1.5 ${activeTab === 'fleet' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
          >
            <Users className="h-3.5 w-3.5 text-blue-600" />
            <span>All Responders Fleet ({responders.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('assigned')}
            className={`flex-1 min-w-[120px] rounded-lg py-2 transition ${activeTab === 'assigned' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
          >
            Assigned to Me ({assignedToMe.length})
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={`flex-1 min-w-[120px] rounded-lg py-2 transition ${activeTab === 'pending' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
          >
            Pending Calls ({pendingUnassigned.length})
          </button>
          <button
            onClick={() => setActiveTab('resolved')}
            className={`flex-1 min-w-[120px] rounded-lg py-2 transition ${activeTab === 'resolved' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
          >
            Resolved ({resolvedHistory.length})
          </button>
        </div>

        {/* ========================================================
            TAB 1: COMPLETE FIRST-RESPONDER FLEET DIRECTORY
        ======================================================== */}
        {activeTab === 'fleet' && (
          <div className="space-y-4">
            {/* Filter Pills for Responder Categories */}
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <button
                onClick={() => setFleetFilter('all')}
                className={`rounded-lg px-3 py-1.5 transition ${fleetFilter === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
              >
                All Fleet ({responders.length})
              </button>
              <button
                onClick={() => setFleetFilter('medical')}
                className={`rounded-lg px-3 py-1.5 transition ${fleetFilter === 'medical'
                  ? 'bg-rose-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
              >
                🚑 Ambulances ({responders.filter((r) => r.type === 'medical').length})
              </button>
              <button
                onClick={() => setFleetFilter('fire')}
                className={`rounded-lg px-3 py-1.5 transition ${fleetFilter === 'fire'
                  ? 'bg-orange-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
              >
                🚒 Fire Engines ({responders.filter((r) => r.type === 'fire').length})
              </button>
              <button
                onClick={() => setFleetFilter('police')}
                className={`rounded-lg px-3 py-1.5 transition ${fleetFilter === 'police'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
              >
                🚓 Police Units ({responders.filter((r) => r.type === 'police').length})
              </button>
              <button
                onClick={() => setFleetFilter('volunteer')}
                className={`rounded-lg px-3 py-1.5 transition ${fleetFilter === 'volunteer'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
              >
                🤝 Volunteers ({responders.filter((r) => r.type === 'volunteer').length})
              </button>
            </div>

            {/* Grid of all Responders */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {filteredResponders.map((resp) => {
                const isSelected = String(resp.id) === String(selectedResponder)
                const currentJob = incidents.find(
                  (i) => String(i.assigned_to) === String(resp.id) && i.status !== 'resolved'
                )

                return (
                  <div
                    key={resp.id}
                    className={`rounded-2xl border bg-white p-4 shadow-sm transition ${isSelected
                      ? 'border-blue-500 ring-2 ring-blue-100'
                      : 'border-slate-200 hover:border-slate-300'
                      }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg font-bold ${resp.type === 'medical'
                            ? 'bg-rose-100 text-rose-700'
                            : resp.type === 'fire'
                              ? 'bg-orange-100 text-orange-700'
                              : resp.type === 'police'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-emerald-100 text-emerald-700'
                            }`}
                        >
                          {resp.type === 'medical'
                            ? '🚑'
                            : resp.type === 'fire'
                              ? '🚒'
                              : resp.type === 'police'
                                ? '🚓'
                                : '🤝'}
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-slate-900">{resp.name}</h4>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] font-semibold uppercase text-slate-500">
                              {resp.type}
                            </span>
                            <span className="text-slate-300">•</span>
                            <span
                              className={`rounded px-1.5 py-0.2 text-[10px] font-bold uppercase ${resp.status === 'available'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                                }`}
                            >
                              {resp.status}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Select / Switch Button */}
                      {isSelected ? (
                        <span className="flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 border border-blue-200">
                          <Check className="h-3.5 w-3.5" />
                          <span>Active</span>
                        </span>
                      ) : (
                        <button
                          onClick={() => {
                            setSelectedResponder(resp.id)
                            setMessage(`Switched active profile to ${resp.name}.`)
                          }}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-blue-600 hover:text-white hover:border-blue-600 transition"
                        >
                          Select Unit
                        </button>
                      )}
                    </div>

                    {/* Active mission badge if assigned */}
                    {currentJob ? (
                      <div className="mt-3 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-900 border border-amber-200 flex items-center justify-between">
                        <span>
                          <strong>On Mission:</strong> {currentJob.type.toUpperCase()} ({currentJob.status})
                        </span>
                        <button
                          onClick={() => {
                            setSelectedResponder(resp.id)
                            setSelectedIncidentId(currentJob.id)
                            setActiveTab('assigned')
                          }}
                          className="font-bold underline text-amber-800 hover:text-amber-950 text-[11px]"
                        >
                          View Route
                        </button>
                      </div>
                    ) : (
                      <p className="mt-3 text-[11px] text-slate-400">
                        GPS Standby: {resp.lat?.toFixed(3)}°, {resp.lng?.toFixed(3)}°
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ========================================================
            TAB 2: ASSIGNED TO ACTIVE RESPONDER
        ======================================================== */}
        {activeTab === 'assigned' && (
          <div className="space-y-3">
            {assignedToMe.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500 shadow-sm">
                No active emergencies currently assigned to <strong className="text-slate-700">{activeResponderObj?.name}</strong>.
                Switch responders above or accept a pending emergency from the queue.
              </div>
            ) : (
              assignedToMe.map((inc) => (
                <IncidentCard
                  key={inc.id}
                  inc={inc}
                  isSelected={activeFocusIncident?.id === inc.id}
                  onSelect={() => setSelectedIncidentId(inc.id)}
                  responderCoords={responderCoords}
                />
              ))
            )}
          </div>
        )}

        {/* ========================================================
            TAB 3: PENDING EMERGENCY CALLS
        ======================================================== */}
        {activeTab === 'pending' && (
          <div className="space-y-3">
            {pendingUnassigned.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500 shadow-sm">
                Zero pending emergency dispatches in queue. All incidents have been addressed.
              </div>
            ) : (
              pendingUnassigned.map((inc) => (
                <IncidentCard
                  key={inc.id}
                  inc={inc}
                  isSelected={activeFocusIncident?.id === inc.id}
                  onSelect={() => setSelectedIncidentId(inc.id)}
                  onAccept={() => acceptIncident(inc.id)}
                  responderCoords={responderCoords}
                  activeResponderName={activeResponderObj?.name}
                  showAccept
                />
              ))
            )}
          </div>
        )}

        {/* ========================================================
            TAB 4: MISSION HISTORY
        ======================================================== */}
        {activeTab === 'resolved' && (
          <div className="space-y-3">
            {resolvedHistory.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500 shadow-sm">
                No resolved records logged for <strong className="text-slate-700">{activeResponderObj?.name}</strong>.
              </div>
            ) : (
              resolvedHistory.map((inc) => (
                <IncidentCard
                  key={inc.id}
                  inc={inc}
                  isSelected={activeFocusIncident?.id === inc.id}
                  onSelect={() => setSelectedIncidentId(inc.id)}
                  responderCoords={responderCoords}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function IncidentCard({ inc, isSelected, onSelect, onAccept, responderCoords, showAccept = false }) {
  const Icon = TYPE_ICONS[inc.type] || LifeBuoy
  const dist = inc.lat && inc.lng && responderCoords ? haversineKm(responderCoords, { lat: inc.lat, lng: inc.lng }) : null

  return (
    <div
      onClick={onSelect}
      className={`cursor-pointer rounded-2xl border p-4 transition-all bg-white shadow-sm ${isSelected
        ? 'border-blue-500 ring-2 ring-blue-100'
        : 'border-slate-200 hover:border-slate-300'
        }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase text-slate-900">{inc.type}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 border border-slate-200">
                Priority {inc.severity}
              </span>
              {inc.escalated && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                  Escalated
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-600 line-clamp-1">{inc.description || 'Emergency assistance needed'}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {dist != null && (
            <div className="text-right">
              <p className="text-xs font-bold text-slate-800">{formatDistance(dist)}</p>
              <p className="text-[10px] text-slate-500">{estimateDrivingEtaMinutes(dist)}m ETA</p>
            </div>
          )}

          {showAccept && onAccept && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onAccept()
              }}
              className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 transition shadow-sm"
            >
              Accept
            </button>
          )}

          <ChevronRight className="h-4 w-4 text-slate-400" />
        </div>
      </div>
    </div>
  )
}