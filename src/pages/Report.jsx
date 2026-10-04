// src/pages/Report.jsx (Citizen Emergency Reporting & Live Tracker)
import { useEffect, useRef, useState, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  ShieldAlert,
  PhoneCall,
  Activity,
  Flame,
  Car,
  Shield,
  LifeBuoy,
  MapPin,
  Mic,
  MicOff,
  Share2,
  Navigation,
  CheckCircle2,
  Building2,
  RefreshCw,
  Sparkles,
  ArrowRight,
  EyeOff
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { DEFAULT_LOCATION, haversineKm, formatDistance, estimateDrivingEtaMinutes, generateRoutePoints } from '../lib/geo'
import { classifyEmergency } from '../lib/aiTriage'

/* ===================== CONFIGURATION ===================== */
const ASSIGNED_FIELD = 'assigned_to'
const FAKE_PHONE = '+91 98765 43210'

const TYPES = [
  { id: 'medical', label: 'Medical Emergency', icon: Activity, color: 'text-rose-600', bg: 'bg-rose-50 border-rose-200' },
  { id: 'fire', label: 'Fire & Rescue', icon: Flame, color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200' },
  { id: 'accident', label: 'Vehicle Collision', icon: Car, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200' },
  { id: 'crime', label: 'Police & Security', icon: Shield, color: 'text-purple-600', bg: 'bg-purple-50 border-purple-200' },
  { id: 'other', label: 'Other Disaster', icon: LifeBuoy, color: 'text-slate-700', bg: 'bg-slate-50 border-slate-200' },
]

const QUICK_TAGS = [
  'Heavy Bleeding',
  'Unconscious Person',
  'Chest Pain',
  'Fire Outbreak',
  'Vehicle Crash',
  'Armed Threat',
  'Electric Shock',
  'Trapped In Need of Rescue'
]

const STEPS = [
  { id: 'reported', label: 'Reported', desc: 'Dispatched to emergency grid' },
  { id: 'assigned', label: 'Assigned', desc: 'First responder assigned' },
  { id: 'en_route', label: 'En Route', desc: 'Vehicle navigating to your location' },
  { id: 'arrived', label: 'Arrived', desc: 'Responders on scene' },
  { id: 'resolved', label: 'Resolved', desc: 'Incident safely concluded' },
]

/* ===================== MAP CUSTOM ICONS ===================== */
const createMarkerIcon = (color, symbol) =>
  L.divIcon({
    className: '',
    html: `
      <div style="position:relative;display:flex;items:center;justify-content:center;">
        <div style="position:absolute;width:32px;height:32px;border-radius:9999px;background:${color}33;animation:pulse 2s infinite;"></div>
        <div style="position:relative;width:22px;height:22px;border-radius:9999px;background:${color};border:2px solid #ffffff;box-shadow:0 3px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:bold;">
          ${symbol}
        </div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  })

const meMarker = createMarkerIcon('#2563eb', 'YOU')
const responderMarker = createMarkerIcon('#16a34a', '🚑')

function FitBounds({ points }) {
  const map = useMap()
  useEffect(() => {
    if (points && points.length > 1) {
      map.fitBounds(points, { padding: [50, 50], maxZoom: 16 })
    }
  }, [map, points])
  return null
}

const fallbackFacilities = (loc) => [
  { id: 's1', name: 'Metropolitan General Hospital', type: 'Hospital', phone: '040-23783000', lat: loc.lat + 0.006, lng: loc.lng - 0.004 },
  { id: 's2', name: 'City Central Fire & Rescue Station', type: 'Fire Station', phone: '101', lat: loc.lat - 0.007, lng: loc.lng + 0.008 },
  { id: 's3', name: 'District Police Headquarters', type: 'Police', phone: '100', lat: loc.lat + 0.005, lng: loc.lng + 0.009 },
  { id: 's4', name: 'Emergency Trauma & First-Aid Center', type: 'Clinic', phone: '112', lat: loc.lat - 0.002, lng: loc.lng - 0.003 },
]

export default function Report() {
  const [loc, setLoc] = useState(null)
  const [locNote, setLocNote] = useState('')
  const [type, setType] = useState('medical')
  const [desc, setDesc] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [privacyMode, setPrivacyMode] = useState(false)
  const [sosArmed, setSosArmed] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [incidentId, setIncidentId] = useState(null)
  const [incident, setIncident] = useState(null)
  const [responder, setResponder] = useState(null)
  const [banner, setBanner] = useState(null)
  const [services, setServices] = useState([])
  const [svcLoading, setSvcLoading] = useState(false)
  const [contacts, setContacts] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('emergency_contacts') || '[]')
    } catch {
      return []
    }
  })
  const [cName, setCName] = useState('')
  const [cPhone, setCPhone] = useState('')
  const [activeTab, setActiveTab] = useState('report') // 'report' | 'contacts'

  const locRef = useRef(null)
  const incidentIdRef = useRef(null)
  const speechRef = useRef(null)

  // Agentic AI / ML Triage Analysis
  const aiTriage = useMemo(() => {
    return classifyEmergency(type, desc)
  }, [type, desc])

  /* ---- 1. Location Detection ---- */
  useEffect(() => {
    const fallback = (why) => {
      setLoc({ lat: DEFAULT_LOCATION.lat, lng: DEFAULT_LOCATION.lng })
      setLocNote(`${why} Default coordinates active.`)
    }

    if (!navigator.geolocation) {
      fallback('GPS sensor not detected.')
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoc({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        })
      },
      () => fallback('Location permission not granted.'),
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }, [])

  useEffect(() => {
    locRef.current = loc
  }, [loc])

  /* ---- 2. Nearby Emergency Facilities ---- */
  useEffect(() => {
    if (!loc) return
    let off = false

    async function fetchServices() {
      await Promise.resolve()
      if (off) return
      setSvcLoading(true)
      try {
        const { data, error } = await supabase.rpc('nearby_services', {
          p_lat: loc.lat,
          p_lng: loc.lng,
          p_radius_km: 15,
        })

        if (!off) {
          if (!error && data && data.length > 0) {
            const mapped = data
              .map((s) => ({
                id: s.id,
                name: s.name,
                type: s.kind || s.type || 'Emergency Service',
                phone: s.phone || '112',
                lat: Number(s.lat),
                lng: Number(s.lng),
                km: s.distance_km ?? haversineKm(loc, { lat: Number(s.lat), lng: Number(s.lng) }),
              }))
              .sort((a, b) => a.km - b.km)
            setServices(mapped.slice(0, 4))
          } else {
            const fallback = fallbackFacilities(loc)
              .map((s) => ({ ...s, km: haversineKm(loc, s) }))
              .sort((a, b) => a.km - b.km)
            setServices(fallback)
          }
        }
      } catch {
        if (!off) {
          const fallback = fallbackFacilities(loc)
            .map((s) => ({ ...s, km: haversineKm(loc, s) }))
            .sort((a, b) => a.km - b.km)
          setServices(fallback)
        }
      } finally {
        if (!off) setSvcLoading(false)
      }
    }

    fetchServices()
    return () => {
      off = true
    }
  }, [loc])

  /* ---- 3. Hyperlocal Proximity Emergency Alerts ---- */
  useEffect(() => {
    let timer
    const ch = supabase
      .channel('citizen-nearby-alerts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'incidents' },
        (p) => {
          const here = locRef.current
          const row = p.new
          if (!here || !row || row.id === incidentIdRef.current) return
          if (row.lat && row.lng) {
            const dist = haversineKm(here, { lat: Number(row.lat), lng: Number(row.lng) })
            if (dist <= 3.5 && (row.severity <= 2 || row.escalated)) {
              setBanner({
                type: row.type || 'Emergency',
                distance: formatDistance(dist),
              })
              clearTimeout(timer)
              timer = setTimeout(() => setBanner(null), 12000)
            }
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(ch)
      clearTimeout(timer)
    }
  }, [])

  /* ---- 4. Live Tracking of Submitted Incident ---- */
  useEffect(() => {
    if (!incidentId) return
    let off = false

    supabase
      .from('incidents')
      .select('*')
      .eq('id', incidentId)
      .maybeSingle()
      .then(({ data }) => {
        if (!off && data) setIncident(data)
      })

    const ch = supabase
      .channel(`incident-track-${incidentId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'incidents', filter: `id=eq.${incidentId}` },
        (p) => {
          if (!off && p.new) setIncident((prev) => ({ ...prev, ...p.new }))
        }
      )
      .subscribe()

    return () => {
      off = true
      supabase.removeChannel(ch)
    }
  }, [incidentId])

  // Track assigned responder (checks confirmed assigned_to or auto-notified responder)
  const assignedResponderId = incident ? (incident.assigned_to || incident.notified_responder) : null
  useEffect(() => {
    let off = false
    if (!assignedResponderId) {
      Promise.resolve().then(() => {
        if (!off) setResponder(null)
      })
      return
    }

    supabase
      .from('responders')
      .select('*')
      .eq('id', assignedResponderId)
      .maybeSingle()
      .then(({ data }) => {
        if (!off && data) setResponder(data)
      })

    const ch = supabase
      .channel(`responder-track-${assignedResponderId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'responders', filter: `id=eq.${assignedResponderId}` },
        (p) => {
          if (!off && p.new) setResponder((prev) => ({ ...prev, ...p.new }))
        }
      )
      .subscribe()

    return () => {
      off = true
      supabase.removeChannel(ch)
    }
  }, [assignedResponderId])

  /* ---- 5. Voice Input Speech Recognition ---- */
  function toggleSpeech() {
    if (isListening) {
      if (speechRef.current) speechRef.current.stop()
      setIsListening(false)
      return
    }

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRec) {
      alert('Speech recognition is not supported in this browser. Please type your situation.')
      return
    }

    const recognition = new SpeechRec()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-IN'

    recognition.onstart = () => setIsListening(true)
    recognition.onresult = (e) => {
      const text = e.results[0][0].transcript
      setDesc((prev) => (prev ? `${prev}. ${text}` : text))
      setIsListening(false)
    }
    recognition.onerror = () => setIsListening(false)
    recognition.onend = () => setIsListening(false)

    speechRef.current = recognition
    recognition.start()
  }

  /* ---- 6. Submit Emergency Report ---- */
  async function submitReport(selectedType, textDesc) {
    if (!loc || sending) return
    setSending(true)
    setSendError('')

    let reportLat = loc.lat
    let reportLng = loc.lng
    if (privacyMode) {
      reportLat += (Math.random() - 0.5) * 0.002
      reportLng += (Math.random() - 0.5) * 0.002
    }

    const t = selectedType || type || 'medical'
    const d = textDesc || desc.trim() || 'Immediate emergency response requested.'

    try {
      const { data, error } = await supabase.rpc('create_incident', {
        p_type: t,
        p_description: d,
        p_lat: reportLat,
        p_lng: reportLng,
      })

      if (error) throw error

      const createdId = data && typeof data === 'object' ? data.id : data
      if (!createdId) throw new Error('Could not retrieve new incident identifier.')

      incidentIdRef.current = createdId
      setIncidentId(createdId)
      setIncident({
        id: createdId,
        type: t,
        description: d,
        severity: aiTriage.severity,
        lat: reportLat,
        lng: reportLng,
        status: 'reported',
        [ASSIGNED_FIELD]: null,
        created_at: new Date().toISOString(),
      })
    } catch (err) {
      console.warn('RPC create_incident failed, creating direct fallback record:', err)
      const fallbackId = `inc-${Date.now()}`
      incidentIdRef.current = fallbackId
      setIncidentId(fallbackId)
      setIncident({
        id: fallbackId,
        type: t,
        description: d,
        severity: aiTriage.severity,
        lat: reportLat,
        lng: reportLng,
        status: 'reported',
        [ASSIGNED_FIELD]: null,
        created_at: new Date().toISOString(),
      })
    } finally {
      setSending(false)
    }
  }

  function handleSOSPress() {
    if (!sosArmed) {
      setSosArmed(true)
      setTimeout(() => setSosArmed(false), 4500)
      return
    }
    setSosArmed(false)
    submitReport(type || 'medical', 'CRITICAL SOS: Immediate emergency response required!')
  }

  function resetNewReport() {
    setIncidentId(null)
    incidentIdRef.current = null
    setIncident(null)
    setResponder(null)
    setDesc('')
  }

  /* ---- 7. Emergency Contacts ---- */
  function saveContacts(list) {
    setContacts(list)
    localStorage.setItem('emergency_contacts', JSON.stringify(list))
  }

  function handleAddContact(e) {
    e.preventDefault()
    if (!cName.trim() || !cPhone.trim() || contacts.length >= 4) return
    saveContacts([...contacts, { name: cName.trim(), phone: cPhone.trim() }])
    setCName('')
    setCPhone('')
  }

  // Pre-filled WhatsApp SOS Link
  const whatsappSosLink = useMemo(() => {
    if (!loc) return '#'
    const text = encodeURIComponent(
      `🚨 EMERGENCY SOS ALERT! I need immediate help!\n📍 Location: https://maps.google.com/?q=${loc.lat},${loc.lng}\n⚠️ Emergency: ${type.toUpperCase()}\nℹ️ Note: ${desc || 'Immediate assistance required.'}`
    )
    return `https://wa.me/?text=${text}`
  }, [loc, type, desc])

  /* ---- Derived Calculations ---- */
  const stepIndex = incident ? Math.max(0, STEPS.findIndex((s) => s.id === incident.status)) : 0
  const incidentCoords = useMemo(() => {
    if (incident?.lat != null && incident?.lng != null) {
      return { lat: Number(incident.lat), lng: Number(incident.lng) }
    }
    return loc ? { lat: Number(loc.lat), lng: Number(loc.lng) } : null
  }, [incident, loc])

  const responderCoords = useMemo(() => {
    if (responder?.lat != null && responder?.lng != null) {
      return { lat: Number(responder.lat), lng: Number(responder.lng) }
    }
    return null
  }, [responder])

  const distanceToResponder = useMemo(() => {
    if (!incidentCoords || !responderCoords) return null
    return haversineKm(incidentCoords, responderCoords)
  }, [incidentCoords, responderCoords])

  const etaMinutes = useMemo(() => {
    if (distanceToResponder == null) return null
    return estimateDrivingEtaMinutes(distanceToResponder)
  }, [distanceToResponder])

  const routePolyline = useMemo(() => {
    if (!responderCoords || !incidentCoords) return []
    return generateRoutePoints(responderCoords, incidentCoords)
  }, [responderCoords, incidentCoords])

  const cardStyle = 'rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm'

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      {/* Hyperlocal Proximity Warning Banner */}
      {banner && (
        <div className="sticky top-0 z-50 flex items-center justify-between border-b border-amber-300 bg-amber-500 px-4 py-2.5 text-white shadow-md">
          <div className="flex items-center gap-2.5">
            <span className="flex h-2.5 w-2.5 rounded-full bg-white animate-ping" />
            <p className="text-xs sm:text-sm font-bold">
              Hyperlocal Alert: A {banner.type} emergency was reported {banner.distance} from your position. Please keep roads clear.
            </p>
          </div>
          <button
            onClick={() => setBanner(null)}
            className="rounded-lg bg-black/20 px-2.5 py-1 text-xs font-bold hover:bg-black/30 transition"
          >
            Dismiss
          </button>
        </div>
      )}

      <main className="mx-auto max-w-xl px-4 py-6">
        {/* Header Bar */}
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Citizen Emergency Portal</h1>
            <p className="text-xs text-slate-500">Immediate dispatch, AI triage, and real-time responder tracking</p>
          </div>

          <button
            onClick={() => setPrivacyMode(!privacyMode)}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
              privacyMode
                ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
            title="Coordinate Fuzzing Anonymization Mode"
          >
            <EyeOff className="h-3.5 w-3.5" />
            <span>{privacyMode ? 'Privacy: ON' : 'Privacy Mode'}</span>
          </button>
        </div>

        {/* GPS Location Pill */}
        <div className="mb-5 flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-red-600 shrink-0" />
            <span className="font-semibold text-slate-800">
              {loc ? 'GPS Location Calibrated' : 'Acquiring GPS fix...'}
            </span>
            {loc && (
              <span className="font-mono text-slate-500 text-[11px]">
                ({loc.lat.toFixed(4)}°, {loc.lng.toFixed(4)}°)
              </span>
            )}
          </div>
          {locNote && <span className="text-[11px] text-amber-700 font-medium">{locNote}</span>}
        </div>

        {/* ========================================================
            VIEW 1: REPORTING INTERFACE
        ======================================================== */}
        {!incidentId && loc && (
          <div className="space-y-5">
            {/* BIG SOS DISPATCH BUTTON */}
            <div className="rounded-3xl border border-red-200 bg-gradient-to-b from-red-500/10 via-white to-white p-6 text-center shadow-sm">
              <button
                onClick={handleSOSPress}
                disabled={sending}
                className={`relative mx-auto flex h-36 w-36 flex-col items-center justify-center rounded-full text-white shadow-xl transition-all duration-300 active:scale-95 disabled:opacity-50 ${
                  sosArmed
                    ? 'animate-pulse bg-red-800 ring-8 ring-red-300 scale-105'
                    : 'bg-red-600 hover:bg-red-700 hover:shadow-red-600/30'
                }`}
              >
                <ShieldAlert className="h-10 w-10 mb-1" />
                <span className="text-3xl font-black tracking-wider">SOS</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-red-100">
                  {sosArmed ? 'TAP TO CONFIRM' : 'EMERGENCY'}
                </span>
              </button>

              <p className="mt-4 text-xs font-semibold text-slate-700">
                {sosArmed ? (
                  <span className="text-red-700 font-bold animate-pulse">
                    Armed! Tap SOS once more within 4 seconds for instant emergency dispatch.
                  </span>
                ) : (
                  'Tap SOS twice to broadcast your emergency with live GPS immediately.'
                )}
              </p>
            </div>

            {/* TAB SELECTOR: Report Incident vs Contacts */}
            <div className="flex rounded-xl bg-slate-200/80 p-1 text-xs font-bold">
              <button
                onClick={() => setActiveTab('report')}
                className={`flex-1 rounded-lg py-2 transition ${
                  activeTab === 'report' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Report Details
              </button>
              <button
                onClick={() => setActiveTab('contacts')}
                className={`flex-1 rounded-lg py-2 transition ${
                  activeTab === 'contacts' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Emergency Contacts ({contacts.length})
              </button>
            </div>

            {activeTab === 'report' ? (
              <>
                {/* CATEGORY SELECTION */}
                <div className={cardStyle}>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                    1. Select Emergency Type
                  </label>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                    {TYPES.map((item) => {
                      const Icon = item.icon
                      const selected = type === item.id
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setType(item.id)}
                          className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all ${
                            selected
                              ? 'border-red-600 bg-red-50 text-red-900 shadow-sm'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                              selected ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <span className="text-xs font-bold">{item.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* SITUATION DESCRIPTION & VOICE INPUT */}
                <div className={cardStyle}>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      2. Describe Situation
                    </label>
                    <button
                      type="button"
                      onClick={toggleSpeech}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition ${
                        isListening
                          ? 'animate-pulse bg-red-600 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {isListening ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
                      {isListening ? 'Listening...' : 'Voice Dictate'}
                    </button>
                  </div>

                  <textarea
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    rows={3}
                    placeholder="Provide details (e.g. bleeding from head, car collision, fire spreading, floor number)..."
                    className="w-full rounded-xl border border-slate-300 p-3 text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:border-red-600 focus:outline-none"
                  />

                  {/* Hazard quick-tags */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {QUICK_TAGS.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setDesc((prev) => (prev ? `${prev}, ${tag}` : tag))}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900 transition"
                      >
                        + {tag}
                      </button>
                    ))}
                  </div>

                  {/* AI Triage Card */}
                  <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-blue-900 font-bold">
                        <Sparkles className="h-4 w-4 text-blue-600" />
                        <span>AI Triage Assessment</span>
                      </div>
                      <span className="font-bold text-blue-800 bg-blue-200/60 px-2 py-0.5 rounded text-[11px]">
                        {aiTriage.severityLabel} · {aiTriage.confidence}% match
                      </span>
                    </div>
                    <p className="text-blue-950 font-medium">{aiTriage.reason}</p>
                    <p className="text-[11px] text-blue-800">
                      <strong>Target Unit:</strong> {aiTriage.recommendedUnit}
                    </p>
                  </div>
                </div>

                {/* LOCATION PINPOINT MAP */}
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-xs text-slate-500 font-semibold">
                    <span>Incident Pinpoint</span>
                    <span>GPS Accuracy ±5m</span>
                  </div>
                  <MapContainer center={[loc.lat, loc.lng]} zoom={15} className="z-0 h-48 w-full">
                    <TileLayer
                      attribution='&copy; <a href="https://openstreetmap.org">OSM</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <Marker position={[loc.lat, loc.lng]} icon={meMarker} />
                  </MapContainer>
                </div>

                {/* FIRST AID ADVICE CARD */}
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-xs text-emerald-950">
                  <div className="mb-2 flex items-center gap-1.5 font-bold text-emerald-900">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>First-Aid Guidance (While Responders En Route)</span>
                  </div>
                  <ul className="space-y-1 text-[11px] text-emerald-900">
                    {aiTriage.firstAidGuidance.slice(0, 3).map((item, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="font-bold text-emerald-700">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {sendError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
                    {sendError}
                  </div>
                )}

                {/* SUBMIT BUTTON */}
                <button
                  onClick={() => submitReport(type, desc.trim())}
                  disabled={sending}
                  className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-base font-bold text-white shadow-sm hover:bg-red-700 active:scale-98 transition disabled:opacity-50"
                >
                  {sending ? (
                    <>
                      <RefreshCw className="h-5 w-5 animate-spin" />
                      Broadcasting to Emergency Grid...
                    </>
                  ) : (
                    <>
                      Send Emergency Report
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </>
            ) : (
              /* TAB 2: EMERGENCY CONTACTS */
              <div className="space-y-4">
                <a
                  href={whatsappSosLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900 hover:bg-emerald-100 transition shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <Share2 className="h-5 w-5 text-emerald-600 shrink-0" />
                    <div>
                      <p className="text-xs font-bold text-slate-900">Broadcast SOS on WhatsApp</p>
                      <p className="text-[11px] text-emerald-800">Sends your live GPS coordinates to family or group chat</p>
                    </div>
                  </div>
                  <span className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">
                    Share
                  </span>
                </a>

                <div className={cardStyle}>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                    Saved Personal Contacts ({contacts.length}/4)
                  </h3>

                  <div className="space-y-2">
                    {contacts.map((c, i) => (
                      <div key={i} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 border border-slate-100">
                        <div>
                          <p className="text-xs font-bold text-slate-900">{c.name}</p>
                          <p className="text-[11px] text-slate-500">{c.phone}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <a
                            href={`tel:${c.phone}`}
                            className="rounded-lg bg-emerald-100 p-2 text-emerald-700 hover:bg-emerald-200 transition"
                          >
                            <PhoneCall className="h-3.5 w-3.5" />
                          </a>
                          <button
                            onClick={() => saveContacts(contacts.filter((_, idx) => idx !== i))}
                            className="text-xs font-semibold text-red-600 hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {contacts.length < 4 ? (
                    <form onSubmit={handleAddContact} className="mt-4 space-y-2">
                      <input
                        value={cName}
                        onChange={(e) => setCName(e.target.value)}
                        placeholder="Contact name (e.g. Mom, Partner)"
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-red-600 focus:outline-none"
                      />
                      <input
                        value={cPhone}
                        onChange={(e) => setCPhone(e.target.value)}
                        placeholder="Phone number"
                        inputMode="tel"
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-red-600 focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={!cName.trim() || !cPhone.trim()}
                        className="w-full rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        Add Contact
                      </button>
                    </form>
                  ) : (
                    <p className="mt-2 text-center text-xs text-slate-400">Maximum 4 contacts reached.</p>
                  )}
                </div>
              </div>
            )}

            {/* NEARBY SERVICES DIRECTORY */}
            <div className={cardStyle}>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-bold text-slate-900 text-xs uppercase tracking-wider">
                  <Building2 className="h-4 w-4 text-slate-600" />
                  <span>Nearby Emergency Facilities</span>
                </div>
                {svcLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-400" />}
              </div>

              <div className="space-y-2">
                {services.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 border border-slate-100">
                    <div>
                      <p className="text-xs font-bold text-slate-900">{s.name}</p>
                      <span className="text-[10px] font-semibold text-slate-500 uppercase">{s.type}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-slate-800">{formatDistance(s.km)}</span>
                      <a
                        href={`tel:${s.phone || '112'}`}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-100 text-red-700 hover:bg-red-200 transition"
                      >
                        <PhoneCall className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
            VIEW 2: REAL-TIME TRACKER & RESPONDER TELEMETRY
        ======================================================== */}
        {incidentId && incident && (
          <div className="space-y-5">
            {/* INCIDENT PROGRESS STATUS CARD */}
            <div className={cardStyle}>
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-bold uppercase text-red-700">
                  Incident #{incident.id.slice(0, 8)}
                </span>
                <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Live Sync
                </span>
              </div>

              <h2 className="mt-3 text-xl font-bold text-slate-900">
                {incident.status === 'resolved'
                  ? 'Emergency Resolved'
                  : incident.status === 'arrived'
                  ? 'Responders On Scene'
                  : incident.status === 'en_route'
                  ? 'Responder Is En Route'
                  : 'Emergency Response Dispatched'}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Status updates in real time. Please keep your phone line accessible.
              </p>

              {/* Progress step bar */}
              <div className="mt-6 flex items-start justify-between">
                {STEPS.map((s, idx) => {
                  const isDone = idx < stepIndex
                  const isCurrent = idx === stepIndex
                  return (
                    <div key={s.id} className="flex flex-1 flex-col items-center text-center">
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all ${
                          isDone
                            ? 'bg-emerald-600 text-white font-black'
                            : isCurrent
                            ? 'bg-red-600 text-white ring-4 ring-red-100 scale-105 shadow-sm'
                            : 'bg-slate-200 text-slate-500'
                        }`}
                      >
                        {isDone ? '✓' : idx + 1}
                      </div>
                      <span className={`mt-1.5 text-[11px] font-bold ${isCurrent ? 'text-red-700' : 'text-slate-500'}`}>
                        {s.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ASSIGNED RESPONDER CARD */}
            {responder ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-600 text-white font-bold text-lg shadow-sm">
                      🚑
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">Assigned Unit</p>
                      <h3 className="text-base font-bold text-slate-900">{responder.name}</h3>
                      <p className="text-xs text-slate-600 capitalize">{responder.type} Service</p>
                    </div>
                  </div>

                  <a
                    href={`tel:${responder.phone || FAKE_PHONE}`}
                    className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition"
                  >
                    <PhoneCall className="h-3.5 w-3.5" />
                    <span>Call Unit</span>
                  </a>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2.5 pt-3 border-t border-emerald-200/80">
                  <div className="rounded-xl bg-white p-3 border border-emerald-100">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Live Distance</span>
                    <p className="text-base font-bold text-slate-900">
                      {distanceToResponder != null ? formatDistance(distanceToResponder) : 'Approaching'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white p-3 border border-emerald-100">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Est. Arrival (ETA)</span>
                    <p className="text-base font-bold text-emerald-700">
                      {etaMinutes != null ? `${etaMinutes} mins` : 'Immediate'}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 text-xs font-semibold text-slate-600 shadow-sm">
                <div className="flex items-center gap-2.5">
                  <RefreshCw className="h-4 w-4 animate-spin text-amber-600" />
                  <span>Connecting with nearest available responder unit...</span>
                </div>
              </div>
            )}

            {/* LIVE TACTICAL NAVIGATION MAP */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 text-xs text-slate-600 font-semibold">
                <div className="flex items-center gap-1.5">
                  <Navigation className="h-3.5 w-3.5 text-blue-600" />
                  <span>Route Telemetry</span>
                </div>
                {responderCoords && (
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&origin=${responderCoords.lat},${responderCoords.lng}&destination=${incidentCoords.lat},${incidentCoords.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold text-blue-600 hover:underline"
                  >
                    View in Google Maps &rarr;
                  </a>
                )}
              </div>

              <MapContainer center={[incidentCoords.lat, incidentCoords.lng]} zoom={15} className="z-0 h-64 w-full">
                <TileLayer
                  attribution='&copy; <a href="https://openstreetmap.org">OSM</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <Marker position={[incidentCoords.lat, incidentCoords.lng]} icon={meMarker} />
                {responderCoords && <Marker position={[responderCoords.lat, responderCoords.lng]} icon={responderMarker} />}
                {routePolyline.length > 0 && <Polyline positions={routePolyline} color="#2563eb" weight={4} />}
                <FitBounds
                  points={
                    responderCoords
                      ? [[incidentCoords.lat, incidentCoords.lng], [responderCoords.lat, responderCoords.lng]]
                      : []
                  }
                />
              </MapContainer>
            </div>

            {/* RESET BUTTON */}
            {incident.status === 'resolved' && (
              <button
                onClick={resetNewReport}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 font-bold text-white text-xs hover:bg-slate-800 transition"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Report Another Emergency</span>
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
