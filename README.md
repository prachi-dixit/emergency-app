# Hyperlocal Emergency Response Platform

A real-time emergency dispatch and coordination platform connecting citizens in distress with nearby emergency services, on-scene field responders, and central dispatch command.

---

## 🚀 Core Modules & Features

### 1. Citizen Emergency Portal (`/report`)
- **One-Touch SOS**: Double-tap armed SOS button with confirmation guard for instantaneous emergency broadcasts.
- **Automatic Geolocation**: High-accuracy GPS location capture with interactive map pinpoint verification.
- **AI/ML Severity Triage**: Real-time natural language analyzer (`aiTriage.js`) detecting trauma risk keywords (cardiac, heavy bleeding, entrapped, collision, fire) to calculate priority levels (Critical P1 to Low P4), target response units, and pre-arrival first-aid guidance.
- **Voice-to-Text Dictation**: Speech recognition (`webkitSpeechRecognition`) for hands-free incident reporting.
- **Hyperlocal Proximity Alerts**: Real-time notifications warning citizens when severe incidents occur within a 3.5 km radius.
- **Live Dispatch Tracking**: Multi-stage progress tracking (`Reported` → `Assigned` → `En Route` → `Arrived` → `Resolved`), responder distance, driving ETA, and dynamic route polyline on Leaflet map.
- **WhatsApp SOS Broadcast**: One-click emergency broadcast generating pre-formatted WhatsApp messages with live Google Maps coordinate links for personal contacts.
- **Nearby Facilities Directory**: Live querying of hospitals, fire stations, and police stations with real-time distance and click-to-call hotlines.

### 2. First-Responder Mobile Terminal (`/responder`)
- **Complete Fleet Directory (12 Units)**:
  - 🚑 **Ambulances (4 Units)**: Ravi Kumar (101), Priya Sharma (102), Suresh Naidu (103), Fatima Begum (104)
  - 🚒 **Fire & Rescue (3 Units)**: Venkat Rao (Engine 1), Imran Khan (Engine 2), Lakshmi Devi (Engine 3)
  - 🚓 **Police Patrols (3 Units)**: Inspector Arjun Singh, SI Kavita Iyer, Constable Mohan Das
  - 🤝 **First-Aid Volunteers (2 Units)**: Sneha Patel, Rahul Verma
- **1-Click Unit Switcher**: Easily switch between any unit to test and operate across all emergency departments.
- **Tactical Navigation & Route Telemetry**: Interactive map displaying responder GPS, incident pinpoint, route polyline, live distance, driving ETA in minutes, and external turn-by-turn navigation via Google Maps.
- **Lifecycle Actions**:
  - `Accept Dispatch` (calls Supabase `accept_incident` RPC)
  - `Mark as En Route`
  - `Mark as Arrived on Scene`
  - `Mark Incident Resolved` (frees unit availability back to the fleet)

### 3. Command Center Dashboard (`/admin`)
- **Live Tactical Operations Map**: Real-time Leaflet map displaying active emergencies and responder fleet availability halos.
- **Fleet & Incident Metrics**: Live counts of Active Incidents, Critical/High Alarms, Unassigned Calls, Available Units, and Average Response Duration.
- **Multi-Parameter Filtering**: Filter incidents by category, priority severity, escalation state, and status.
- **Manual Unit Dispatch**: Real-time override and responder assignment with database availability synchronization.
- **Audit Timeline**: Historical transition log powered by the `incident_events` audit table.
- **Visual Analytics & CSV Export**: Recharts distribution graphs and formula-injection-sanitized CSV compliance export.

---

## 🛠️ Technology Stack

- **Frontend**: React 19, React Router v7, Vite
- **Styling**: TailwindCSS v4, Plus Jakarta Sans typography
- **Mapping & GIS**: Leaflet, React-Leaflet, OpenStreetMap Tile Layer
- **Backend & Database**: Supabase (PostgreSQL, Realtime WebSockets, Stored Procedures/RPCs)
- **Analytics & Icons**: Recharts, Lucide React

---

## ⚙️ Environment Variables

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=https://flfcoxkgyuvotpulyuup.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_RreT8NJkX_q_P-90WynwCg_f3IIkICz
```

---

## 📦 Deployment Guide

### Deploying to Vercel
1. Push this repository to GitHub.
2. In Vercel, click **"Add New Project"** and select the repository.
3. Set the **Root Directory** to `emergency-app` (if in a subfolder) or `./`.
4. Add the **Environment Variables**:
   - `VITE_SUPABASE_URL`: `https://flfcoxkgyuvotpulyuup.supabase.co`
   - `VITE_SUPABASE_ANON_KEY`: `sb_publishable_RreT8NJkX_q_P-90WynwCg_f3IIkICz`
5. Click **Deploy**. Single-page app routing is pre-configured via `vercel.json`.

---

## 🏃 Local Development

```bash
# Install dependencies
npm install

# Start local development server
npm run dev

# Build for production
npm run build
```
