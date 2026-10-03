import { Routes, Route, Link } from 'react-router-dom'
import Report from './pages/Report.jsx'
import Responder from './pages/Responder.jsx'
import Admin from './pages/Admin.jsx'

function Home() {
  const cls =
    'block rounded-xl bg-red-600 px-6 py-5 text-center text-xl font-semibold text-white hover:bg-red-700'

  return (
    <div className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-2xl font-bold">Emergency Response Platform</h1>

      <Link className={cls} to="/report">
        Citizen: report an emergency
      </Link>

      <Link className={cls} to="/responder">
        Responder
      </Link>

      <Link className={cls} to="/admin">
        Admin dashboard
      </Link>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/report" element={<Report />} />
      <Route path="/responder" element={<Responder />} />
      <Route path="/admin" element={<Admin />} />
    </Routes>
  )
}