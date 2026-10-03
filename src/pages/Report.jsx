// src/pages/Report.jsx  (route: /report)
import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'

/* ===================== SETTINGS ===================== */
const USE_MOCK = true // set to false when the database is ready
const CENTER_LAT = 12.9716 // fallback location if GPS fails - change to your city
const CENTER_LNG = 77.5946
const ASSIGNED_FIELD = 'assigned_to' // incidents column holding the responder id
const FAKE_PHONE = '+910000000000' // fake number used for the Call button

/* ===================== MOCK DATA ===================== */
// MOCK
const MOCK_RESPONDER = { id: 'r1', name: 'Asha - Ambulance 12', type: 'Ambulance', lat: 0, lng: 0, phone: FAKE_PHONE }
// MOCK
const mockServices = (l) => [
  { id: 's1', name: 'City General Hospital', type: 'Hospital', lat: l.lat + 0.012, lng: l.lng + 0.004 },
  { id: 's2', name: 'Central Fire Station', type: 'Fire station', lat: l.lat - 0.007, lng: l.lng + 0.01 },
  { id: 's3', name: 'Town Police Station', type: 'Police', lat: l.lat + 0.004, lng: l.lng - 0.015 },
  { id: 's4', name: 'Community Clinic', type: 'Clinic', lat: l.lat - 0.03, lng: l.lng - 0.03 },
]
// MOCK - fake backend memory and listeners
const mock = { inc: new Set(), res: new Set(), fresh: new Set(), incident: null, responder: null }
const mockIncidentUpdate = (patch) => { mock.incident = { ...mock.incident, ...patch }; mock.inc.forEach((fn) => fn(mock.incident)) }
// MOCK - pretend a responder gets assigned, drives over, arrives and resolves
function mockRunTimeline() {
  const inc = mock.incident
  const start = { lat: inc.lat + 0.008, lng: inc.lng + 0.008 }
  setTimeout(() => { mock.responder = { ...MOCK_RESPONDER, ...start }; mockIncidentUpdate({ [ASSIGNED_FIELD]: MOCK_RESPONDER.id, status: 'assigned' }) }, 3000)
  setTimeout(() => {
    mockIncidentUpdate({ status: 'en_route' })
    let step = 0
    const t = setInterval(() => {
      step += 1
      const f = step / 8
      mock.responder = { ...mock.responder, lat: start.lat + (inc.lat - start.lat) * f, lng: start.lng + (inc.lng - start.lng) * f }
      mock.res.forEach((fn) => fn(mock.responder))
      if (step >= 8) clearInterval(t)
    }, 1250)
  }, 6000)
  setTimeout(() => mockIncidentUpdate({ status: 'arrived' }), 16500)
  setTimeout(() => mockIncidentUpdate({ status: 'resolved' }), 21000)
}

/* ===================== DATA LAYER ===================== */
function db() {
  if (!supabase) throw new Error('Supabase is not configured. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env, then restart npm run dev.')
  return supabase
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// create_incident may return a bare id, a row, or an array - handle all three
function extractId(data) {
  if (Array.isArray(data)) data = data[0]
  return data && typeof data === 'object' ? data.id : data
}

function listen(table, filter, event, cb) {
  const name = `${table}-${filter || 'all'}-${Math.random().toString(36).slice(2, 7)}`
  const cfg = { event, schema: 'public', table }
  if (filter) cfg.filter = filter
  const ch = db().channel(name).on('postgres_changes', cfg, (p) => cb(p.new)).subscribe()
  return () => db().removeChannel(ch)
}

const api = {
  async createIncident(args) {
    if (USE_MOCK) { // MOCK
      await sleep(600)
      mock.incident = { id: 'inc-' + Date.now(), type: args.p_type, description: args.p_description, lat: args.p_lat, lng: args.p_lng, severity: 1, status: 'reported', [ASSIGNED_FIELD]: null }
      mockRunTimeline()
      return mock.incident.id
    }
    const { data, error } = await db().rpc('create_incident', args)
    if (error) throw error
    const id = extractId(data)
    if (id == null) throw new Error('create_incident did not return an incident id.')
    return id
  },
  async getIncident(id) {
    if (USE_MOCK) return mock.incident // MOCK
    const { data, error } = await db().from('incidents').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    return data
  },
  async getResponder(id) {
    if (USE_MOCK) return mock.responder // MOCK
    const { data, error } = await db().from('responders').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    return data
  },
  async nearbyServices(loc) {
    let rows
    if (USE_MOCK) { await sleep(500); rows = mockServices(loc) } // MOCK
    else {
      const { data, error } = await db().rpc('nearby_services', { p_lat: loc.lat, p_lng: loc.lng, p_radius_km: 5 })
      if (error) throw error
      rows = data || []
    }
    return rows
      .map((s) => ({ ...s, km: s.distance_km ?? (s.lat != null ? haversineKm(loc, { lat: Number(s.lat), lng: Number(s.lng) }) : null) }))
      .sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9))
      .slice(0, 3)
  },
  subscribeIncident(id, cb) {
    if (USE_MOCK) { const fn = (row) => row.id === id && cb(row); mock.inc.add(fn); return () => mock.inc.delete(fn) } // MOCK
    return listen('incidents', `id=eq.${id}`, '*', cb)
  },
  subscribeResponder(id, cb) {
    if (USE_MOCK) { const fn = (row) => row.id === id && cb(row); mock.res.add(fn); return () => mock.res.delete(fn) } // MOCK
    return listen('responders', `id=eq.${id}`, '*', cb)
  },
  subscribeNew(cb) {
    if (USE_MOCK) { mock.fresh.add(cb); return () => mock.fresh.delete(cb) } // MOCK
    return listen('incidents', null, 'INSERT', cb)
  },
}

/* ===================== HELPERS ===================== */
function haversineKm(a, b) {
  const R = 6371
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
const fmtKm = (km) => (km == null ? '' : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`)

const TYPES = [['medical', 'Medical'], ['fire', 'Fire'], ['accident', 'Accident'], ['crime', 'Crime'], ['other', 'Other']]
const STEPS = [['reported', 'Reported'], ['assigned', 'Assigned'], ['en_route', 'En route'], ['arrived', 'Arrived'], ['resolved', 'Resolved']]

const dot = (color, glow) => L.divIcon({
  className: '',
  html: `<div style="background:${color};width:22px;height:22px;border-radius:9999px;border:3px solid #fff;box-shadow:0 0 0 4px ${glow}"></div>`,
  iconSize: [22, 22], iconAnchor: [11, 11],
})
const meIcon = dot('#2563eb', 'rgba(37,99,235,.3)')
const responderIcon = dot('#16a34a', 'rgba(22,163,74,.3)')

function FitBounds({ points, fitKey }) {
  const map = useMap()
  useEffect(() => { if (points.length > 1) map.fitBounds(points, { padding: [50, 50] }) }, [fitKey, map]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

/* ===================== PAGE ===================== */
export default function Report() {
  const [loc, setLoc] = useState(null)
  const [locNote, setLocNote] = useState('')
  const [type, setType] = useState('')
  const [desc, setDesc] = useState('')
  const [sosArmed, setSosArmed] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [incidentId, setIncidentId] = useState(null)
  const [incident, setIncident] = useState(null)
  const [responder, setResponder] = useState(null)
  const [log, setLog] = useState([])
  const [banner, setBanner] = useState(false)
  const [services, setServices] = useState([])
  const [svcLoading, setSvcLoading] = useState(false)
  const [svcError, setSvcError] = useState('')
  const [contacts, setContacts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('emergency_contacts') || '[]') } catch { return [] }
  })
  const [cName, setCName] = useState('')
  const [cPhone, setCPhone] = useState('')

  const locRef = useRef(null)
  const incidentIdRef = useRef(null)
  const sendingRef = useRef(false)
  const responderId = incident ? incident[ASSIGNED_FIELD] : null

  /* ---- 2. location (with fallback) ---- */
  useEffect(() => {
    const fallback = (why) => { setLoc({ lat: CENTER_LAT, lng: CENTER_LNG }); setLocNote(`${why} Using the default city centre instead.`) }
    if (!navigator.geolocation) { fallback('Location is not available on this device.'); return }
    navigator.geolocation.getCurrentPosition(
      (p) => setLoc({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => fallback('We could not get your location.'),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }, [])
  useEffect(() => { locRef.current = loc }, [loc])

  /* ---- 7. nearby services ---- */
  useEffect(() => {
    if (!loc) return
    let off = false
    setSvcLoading(true); setSvcError('')
    api.nearbyServices(loc)
      .then((r) => { if (!off) setServices(r) })
      .catch((e) => { if (!off) setSvcError(e.message || 'Could not load nearby services.') })
      .finally(() => { if (!off) setSvcLoading(false) })
    return () => { off = true }
  }, [loc])

  /* ---- 6. nearby emergency banner ---- */
  useEffect(() => {
    let timer
    let unsub = () => {}
    try {
      unsub = api.subscribeNew((row) => {
        const here = locRef.current
        if (!here || !row || sendingRef.current) return
        if (String(row.id) === String(incidentIdRef.current)) return // my own incident
        if (![1, 2].includes(Number(row.severity))) return
        if (haversineKm(here, { lat: Number(row.lat), lng: Number(row.lng) }) > 2) return
        setBanner(true)
        clearTimeout(timer)
        timer = setTimeout(() => setBanner(false), 15000)
      })
    } catch { /* database not configured yet; the page still works */ }
    return () => { unsub(); clearTimeout(timer) }
  }, [])

  /* ---- 4. live tracking: my incident, then its responder ---- */
  useEffect(() => {
    if (!incidentId) return
    let off = false
    api.getIncident(incidentId).then((r) => { if (!off && r) setIncident((p) => ({ ...p, ...r })) }).catch(() => {})
    const unsub = api.subscribeIncident(incidentId, (row) => setIncident((p) => ({ ...p, ...row })))
    return () => { off = true; unsub() }
  }, [incidentId])

  useEffect(() => {
    if (!responderId) { setResponder(null); return }
    let off = false
    api.getResponder(responderId).then((r) => { if (!off && r) setResponder(r) }).catch(() => {})
    const unsub = api.subscribeResponder(responderId, (row) => setResponder((p) => ({ ...p, ...row })))
    return () => { off = true; unsub() }
  }, [responderId])

  /* ---- 3. send the report ---- */
  async function submit(t, d) {
    if (!loc || sending) return
    setSending(true); sendingRef.current = true; setSendError('')
    try {
      const id = await api.createIncident({ p_type: t, p_description: d, p_lat: loc.lat, p_lng: loc.lng })
      incidentIdRef.current = id
      setIncident({ id, type: t, description: d, lat: loc.lat, lng: loc.lng, status: 'reported', [ASSIGNED_FIELD]: null })
      setIncidentId(id)
      setLog(contacts.map((c) => `Alert sent to ${c.name} (${c.phone})`)) // fake notification log
    } catch (e) {
      setSendError(e.message || 'Could not send your report. Please try again, or call your local emergency number.')
    } finally {
      setSending(false); sendingRef.current = false
    }
  }

  function pressSOS() {
    if (!sosArmed) { setSosArmed(true); setTimeout(() => setSosArmed(false), 4000); return }
    setSosArmed(false)
    submit(type || 'other', desc.trim() || 'SOS - immediate help needed')
  }

  function newReport() {
    incidentIdRef.current = null
    setIncidentId(null); setIncident(null); setResponder(null); setLog([]); setType(''); setDesc('')
  }

  /* ---- 5. emergency contacts (localStorage) ---- */
  function saveContacts(next) { setContacts(next); localStorage.setItem('emergency_contacts', JSON.stringify(next)) }
  function addContact(e) {
    e.preventDefault()
    if (!cName.trim() || !cPhone.trim() || contacts.length >= 3) return
    saveContacts([...contacts, { name: cName.trim(), phone: cPhone.trim() }])
    setCName(''); setCPhone('')
  }

  /* ---- derived ---- */
  const stepIndex = incident ? Math.max(0, STEPS.findIndex(([k]) => k === incident.status)) : 0
  const resPos = responder && responder.lat != null && responder.lng != null ? [Number(responder.lat), Number(responder.lng)] : null
  const myPos = incident && incidentId ? [Number(incident.lat), Number(incident.lng)] : loc ? [loc.lat, loc.lng] : null

  const card = 'rounded-2xl border border-stone-200 bg-white p-4 shadow-sm'

  const servicesBlock = (
    <section className={card}>
      <h2 className="mb-3 text-lg font-bold">Nearby help</h2>
      {svcLoading && <p className="text-stone-500">Looking for services near you...</p>}
      {svcError && <p className="rounded-xl bg-red-50 p-3 text-red-700">{svcError}</p>}
      {!svcLoading && !svcError && services.length === 0 && <p className="text-stone-500">No services found within 5 km.</p>}
      <ul className="space-y-2">
        {services.map((s) => (
          <li key={s.id ?? s.name} className="flex items-center justify-between gap-3 rounded-xl bg-stone-50 p-3">
            <div><p className="font-semibold">{s.name}</p><p className="text-sm text-stone-500">{s.type}</p></div>
            <p className="shrink-0 text-lg font-bold">{fmtKm(s.km)}</p>
          </li>
        ))}
      </ul>
    </section>
  )

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      {banner && (
        <button onClick={() => setBanner(false)} className="sticky top-0 z-50 w-full bg-yellow-300 p-4 text-center text-lg font-bold text-stone-900">
          Nearby emergency reported. Avoid the area.
        </button>
      )}

      <div className="mx-auto max-w-md space-y-4 p-4 pb-16">
        <h1 className="text-2xl font-bold">Get help now</h1>

        {!loc && <p className="rounded-xl bg-white p-4 text-stone-600 shadow-sm">Finding your location...</p>}
        {locNote && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{locNote}</p>}

        {/* ============ FORM VIEW ============ */}
        {!incidentId && loc && (
          <>
            <button
              onClick={pressSOS}
              disabled={sending}
              className={`h-32 w-full rounded-3xl text-5xl font-black text-white shadow-lg transition disabled:opacity-60 ${sosArmed ? 'animate-pulse bg-red-800' : 'bg-red-600'}`}
            >
              {sending ? 'Sending...' : sosArmed ? 'Tap again to send' : 'SOS'}
            </button>
            <p className="-mt-2 text-center text-sm text-stone-500">Tap twice to send an emergency alert right away.</p>

            <section className={`${card} space-y-4`}>
              <h2 className="text-lg font-bold">What is happening?</h2>
              <div className="grid grid-cols-2 gap-3">
                {TYPES.map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setType(k)}
                    className={`h-16 rounded-xl border-2 text-lg font-semibold ${k === 'other' ? 'col-span-2' : ''} ${type === k ? 'border-red-600 bg-red-600 text-white' : 'border-stone-200 bg-white text-stone-800'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={4}
                placeholder="Describe what is happening"
                className="w-full rounded-xl border border-stone-300 p-3 text-lg"
              />
              {sendError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{sendError}</p>}
              <button
                onClick={() => submit(type, desc.trim())}
                disabled={!type || sending}
                className="h-16 w-full rounded-xl bg-stone-900 text-xl font-bold text-white disabled:bg-stone-300"
              >
                {sending ? 'Sending...' : type ? 'Send emergency report' : 'Choose a type first'}
              </button>
            </section>

            <div className="overflow-hidden rounded-2xl border border-stone-200 shadow-sm">
              <MapContainer center={[loc.lat, loc.lng]} zoom={15} className="z-0 h-56 w-full">
                <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <Marker position={[loc.lat, loc.lng]} icon={meIcon} />
              </MapContainer>
            </div>

            {/* ===== contacts ===== */}
            <section className={`${card} space-y-3`}>
              <h2 className="text-lg font-bold">Emergency contacts</h2>
              <p className="text-sm text-stone-500">We alert these people when you send a report. You can add up to 3. They stay on this phone only.</p>
              {contacts.map((c, i) => (
                <div key={i} className="flex items-center justify-between rounded-xl bg-stone-50 p-3">
                  <div><p className="font-semibold">{c.name}</p><p className="text-sm text-stone-500">{c.phone}</p></div>
                  <button onClick={() => saveContacts(contacts.filter((_, j) => j !== i))} className="h-11 rounded-lg px-3 font-semibold text-red-600">Remove</button>
                </div>
              ))}
              {contacts.length < 3 ? (
                <form onSubmit={addContact} className="space-y-2">
                  <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Name" className="h-12 w-full rounded-xl border border-stone-300 px-3" />
                  <input value={cPhone} onChange={(e) => setCPhone(e.target.value)} placeholder="Phone number" inputMode="tel" className="h-12 w-full rounded-xl border border-stone-300 px-3" />
                  <button type="submit" disabled={!cName.trim() || !cPhone.trim()} className="h-12 w-full rounded-xl bg-stone-800 font-bold text-white disabled:bg-stone-300">Add contact</button>
                </form>
              ) : (
                <p className="text-sm text-stone-500">You have added the maximum of 3 contacts.</p>
              )}
            </section>

            {servicesBlock}

            {USE_MOCK && (
              <button
                onClick={() => { // MOCK - fake a nearby severity-1 incident (about 500 m away)
                  const row = { id: 'other-' + Date.now(), severity: 1, lat: loc.lat + 0.004, lng: loc.lng + 0.003 }
                  mock.fresh.forEach((fn) => fn(row))
                }}
                className="h-12 w-full rounded-xl border border-dashed border-stone-400 text-stone-600"
              >
                Test: simulate a nearby emergency (mock only)
              </button>
            )}
          </>
        )}

        {/* ============ LIVE TRACKER VIEW ============ */}
        {incidentId && incident && myPos && (
          <>
            <section className={card}>
              <h2 className="mb-1 text-xl font-bold">{incident.status === 'resolved' ? 'Resolved' : 'Help is being arranged'}</h2>
              <p className="mb-4 text-sm text-stone-500">This page updates by itself. Keep it open.</p>
              <ol className="flex items-start">
                {STEPS.map(([k, label], i) => (
                  <li key={k} className="flex-1 text-center">
                    <div className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${i < stepIndex ? 'bg-green-600 text-white' : i === stepIndex ? 'bg-red-600 text-white ring-4 ring-red-200' : 'bg-stone-200 text-stone-500'}`}>
                      {i < stepIndex ? '✓' : i + 1}
                    </div>
                    <p className={`mt-1 text-xs ${i === stepIndex ? 'font-bold' : 'text-stone-500'}`}>{label}</p>
                  </li>
                ))}
              </ol>
            </section>

            {responderId && !responder && <p className="rounded-xl bg-white p-4 text-stone-600 shadow-sm">Loading responder details...</p>}
            {responder && (
              <section className={`${card} flex items-center justify-between gap-3`}>
                <div>
                  <p className="text-sm text-stone-500">Your responder</p>
                  <p className="text-lg font-bold">{responder.name}</p>
                  <p className="text-stone-600">{responder.type}</p>
                </div>
                <a href={`tel:${responder.phone || FAKE_PHONE}`} className="flex h-14 items-center rounded-xl bg-green-600 px-6 text-lg font-bold text-white">Call</a>
              </section>
            )}

            <div className="overflow-hidden rounded-2xl border border-stone-200 shadow-sm">
              <MapContainer center={myPos} zoom={15} className="z-0 h-72 w-full">
                <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <Marker position={myPos} icon={meIcon} />
                {resPos && <Marker position={resPos} icon={responderIcon} />}
                <FitBounds points={resPos ? [myPos, resPos] : []} fitKey={String(responderId)} />
              </MapContainer>
            </div>
            <p className="text-xs text-stone-500">Blue dot is you. Green dot is your responder.</p>

            <section className={card}>
              <h2 className="mb-2 text-lg font-bold">Contacts alerted</h2>
              {log.length === 0 ? <p className="text-stone-500">No emergency contacts saved.</p> : (
                <ul className="space-y-1">{log.map((l, i) => <li key={i} className="text-stone-700">{l}</li>)}</ul>
              )}
            </section>

            {servicesBlock}

            {incident.status === 'resolved' && (
              <button onClick={newReport} className="h-14 w-full rounded-xl bg-stone-900 text-lg font-bold text-white">Report another emergency</button>
            )}
          </>
        )}

        <p className="pt-2 text-center text-xs text-stone-500">This app supports, and does not replace, your local emergency number (112 in India).</p>
      </div>
    </div>
  )
}
