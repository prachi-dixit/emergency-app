// src/App.jsx
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom'
import {
  ShieldAlert,
  Radio,
  LayoutDashboard,
  Home as HomeIcon,
  PhoneCall,
  Activity,
  MapPin,
  ArrowRight,
  ShieldCheck,
  Navigation,
  Sparkles,
  Users,
  BellRing,
  FileSpreadsheet,
  Lock
} from 'lucide-react'
import Report from './pages/Report.jsx'
import Responder from './pages/Responder.jsx'
import Admin from './pages/Admin.jsx'

function Navbar() {
  const location = useLocation()
  const path = location.pathname

  const navLinks = [
    { path: '/', label: 'Overview', icon: HomeIcon },
    { path: '/report', label: 'Citizen Portal', icon: ShieldAlert, highlight: true },
    { path: '/responder', label: 'Responder Terminal', icon: Radio },
    { path: '/admin', label: 'Command Center', icon: LayoutDashboard },
  ]

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Brand */}
        <Link to="/" className="flex items-center gap-3 group">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-red-600 via-rose-600 to-orange-500 text-white shadow-md shadow-red-500/20 group-hover:scale-105 transition-transform">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-slate-900 tracking-tight text-base sm:text-lg">
                ResQ
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 border border-slate-200">
                Dispatch v2.4
              </span>
            </div>
            <p className="text-[11px] font-medium text-slate-500">Hyperlocal Emergency Response Platform</p>
          </div>
        </Link>

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-1.5 rounded-2xl bg-slate-100/80 p-1 border border-slate-200/60">
          {navLinks.map((link) => {
            const Icon = link.icon
            const active = path === link.path
            return (
              <Link
                key={link.path}
                to={link.path}
                className={`relative flex items-center gap-2 rounded-xl px-4 py-1.5 text-xs font-bold transition-all ${
                  active
                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200/60'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                }`}
              >
                <Icon className={`h-4 w-4 ${active ? (link.highlight ? 'text-red-600' : 'text-blue-600') : 'text-slate-400'}`} />
                <span>{link.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Live Grid Status & Emergency Helpline */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span>Live Grid: Online</span>
          </div>

          <a
            href="tel:112"
            className="flex items-center gap-1.5 rounded-xl bg-red-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm shadow-red-600/30 hover:bg-red-700 transition"
          >
            <PhoneCall className="h-3.5 w-3.5" />
            <span>Emergency 112</span>
          </a>
        </div>
      </div>

      {/* Mobile Nav Bar */}
      <div className="flex md:hidden border-t border-slate-200 bg-white px-2 py-1.5 justify-around text-center">
        {navLinks.map((link) => {
          const Icon = link.icon
          const active = path === link.path
          return (
            <Link
              key={link.path}
              to={link.path}
              className={`flex flex-col items-center py-1 px-3 text-[11px] font-bold rounded-xl transition ${
                active ? 'text-red-600 bg-red-50' : 'text-slate-600'
              }`}
            >
              <Icon className="h-4 w-4 mb-0.5" />
              <span>{link.label}</span>
            </Link>
          )
        })}
      </div>
    </header>
  )
}

function Home() {
  const capabilities = [
    {
      icon: MapPin,
      title: 'Automatic Location Detection',
      desc: 'Instant GPS capture with pinpoint mapping, reverse-geocoding, and interactive manual coordinate adjustments.',
    },
    {
      icon: Sparkles,
      title: 'AI Severity Classification',
      desc: 'Natural language keyword triage analyzing casualty risk, recommending response units, and providing first-aid advice.',
    },
    {
      icon: BellRing,
      title: 'Hyperlocal Proximity Alerts',
      desc: 'Automatic broadcast warning surrounding citizens when critical emergencies occur within a 3.5 km radius.',
    },
    {
      icon: Navigation,
      title: 'Real-Time Route Telemetry',
      desc: 'Live vehicle tracking with dynamic route polylines, travel distance in km, driving ETA countdown, and turn-by-turn navigation.',
    },
    {
      icon: Users,
      title: 'Responder Dispatch Coordination',
      desc: 'Specialized mobile terminal for ambulances, fire engines, and police with 1-click accept, en route, and arrival actions.',
    },
    {
      icon: ShieldCheck,
      title: 'Incident Escalation Engine',
      desc: 'Automated SLA timeout monitor that escalates delayed responses and flags supervisor intervention.',
    },
    {
      icon: LayoutDashboard,
      title: 'Interactive Command Center',
      desc: 'Unified tactical map with multi-filter incident queues, responder fleet telemetry, and manual dispatch overrides.',
    },
    {
      icon: FileSpreadsheet,
      title: 'Audit Trails & Reports',
      desc: 'Exportable CSV compliance logs with spreadsheet formula injection protection and response time analytics.',
    },
    {
      icon: Lock,
      title: 'Discreet Security & Privacy',
      desc: 'Privacy mode toggle with coordinate fuzzing and secure data storage for sensitive community emergencies.',
    },
  ]

  return (
    <div className="min-h-[calc(100vh-61px)] bg-slate-50 text-slate-900 pb-16">
      {/* Hero Header */}
      <section className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-b from-white via-slate-50 to-slate-100 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3.5 py-1 text-xs font-bold text-red-700 shadow-sm">
            <Activity className="h-3.5 w-3.5 text-red-600 animate-pulse" />
            <span>High-Availability Emergency Response Network</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900 sm:leading-tight">
            Hyperlocal Emergency <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-red-600 via-rose-600 to-orange-600 bg-clip-text text-transparent">
              Response Platform
            </span>
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-base sm:text-lg text-slate-600 leading-relaxed">
            A comprehensive, coordinated emergency management system connecting citizens in distress with nearby emergency services, field responders, and central dispatch in real time.
          </p>

          {/* 3 Main Role Portals */}
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-3 text-left">
            {/* Citizen Portal */}
            <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-red-100 bg-white p-6 shadow-sm hover:shadow-md hover:border-red-300 transition-all">
              <div>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-600 mb-4 group-hover:scale-105 transition-transform">
                  <ShieldAlert className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 group-hover:text-red-600 transition-colors">
                  Citizen Portal
                </h3>
                <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                  One-tap SOS dispatch, automated GPS positioning, AI-guided severity classification, and live responder arrival tracking.
                </p>
              </div>
              <Link
                to="/report"
                className="mt-6 flex items-center justify-between rounded-xl bg-red-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-red-700 transition"
              >
                <span>Report Emergency</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {/* Responder Terminal */}
            <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-blue-100 bg-white p-6 shadow-sm hover:shadow-md hover:border-blue-300 transition-all">
              <div>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 mb-4 group-hover:scale-105 transition-transform">
                  <Radio className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                  Responder Terminal
                </h3>
                <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                  Mobile first-responder console for ambulance, fire, and police units. Accept dispatches, access route telemetry, and report status.
                </p>
              </div>
              <Link
                to="/responder"
                className="mt-6 flex items-center justify-between rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700 transition"
              >
                <span>Responder Console</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {/* Command Center */}
            <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md hover:border-slate-400 transition-all">
              <div>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-700 mb-4 group-hover:scale-105 transition-transform">
                  <LayoutDashboard className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 group-hover:text-slate-700 transition-colors">
                  Command Center
                </h3>
                <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                  Live tactical map of all active emergencies, responder fleet tracking, automated SLA escalations, and incident compliance reports.
                </p>
              </div>
              <Link
                to="/admin"
                className="mt-6 flex items-center justify-between rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-slate-800 transition"
              >
                <span>Admin Dashboard</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Core Capabilities Section */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Enterprise Platform Capabilities</h2>
          <p className="mt-2 text-xs sm:text-sm text-slate-500">
            Engineered to minimize emergency response latency, maximize situational awareness, and protect community safety.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {capabilities.map((item, idx) => {
            const Icon = item.icon
            return (
              <div
                key={idx}
                className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm hover:border-slate-300 transition"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700 mb-3">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">{item.title}</h3>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">{item.desc}</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* Emergency Helplines Bar */}
      <section className="mx-auto max-w-6xl px-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              National Emergency Hotlines (India)
            </h3>
            <span className="text-xs text-slate-400">Toll-free 24/7 service</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <a
              href="tel:112"
              className="rounded-xl border border-slate-200 bg-slate-50 p-3 hover:border-red-300 hover:bg-red-50/50 transition group"
            >
              <span className="block text-xl font-extrabold text-red-600 group-hover:scale-105 transition-transform">
                112
              </span>
              <span className="text-xs font-medium text-slate-600">National Emergency</span>
            </a>
            <a
              href="tel:108"
              className="rounded-xl border border-slate-200 bg-slate-50 p-3 hover:border-red-300 hover:bg-red-50/50 transition group"
            >
              <span className="block text-xl font-extrabold text-red-600 group-hover:scale-105 transition-transform">
                108
              </span>
              <span className="text-xs font-medium text-slate-600">Medical Ambulance</span>
            </a>
            <a
              href="tel:101"
              className="rounded-xl border border-slate-200 bg-slate-50 p-3 hover:border-red-300 hover:bg-red-50/50 transition group"
            >
              <span className="block text-xl font-extrabold text-red-600 group-hover:scale-105 transition-transform">
                101
              </span>
              <span className="text-xs font-medium text-slate-600">Fire & Rescue</span>
            </a>
            <a
              href="tel:100"
              className="rounded-xl border border-slate-200 bg-slate-50 p-3 hover:border-red-300 hover:bg-red-50/50 transition group"
            >
              <span className="block text-xl font-extrabold text-red-600 group-hover:scale-105 transition-transform">
                100
              </span>
              <span className="text-xs font-medium text-slate-600">Police Patrol</span>
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased">
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/report" element={<Report />} />
        <Route path="/responder" element={<Responder />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}