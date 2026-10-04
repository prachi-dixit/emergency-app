import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "../lib/supabase";

/* =========================================================
   CONSTANTS
========================================================= */

const CENTER = [17.5605, 78.4550]; // City coordinates
const PAGE_SIZE = 10;
const ESCALATION_INTERVAL_MS = 30000;
const TEST_INTERVAL_MS = 8000;

const INCIDENT_TYPES = ["Medical", "Fire", "Accident", "Crime", "Other"];
const STATUS_OPTIONS = ["reported", "assigned", "en_route", "arrived", "resolved"];

const STATUS_LABELS = {
  active: "Active",
  assigned: "Assigned",
  arrived: "Arrived",
  resolved: "Resolved",
};

const STATUS_COLORS = {
  active: "bg-red-100 text-red-700",
  assigned: "bg-yellow-100 text-yellow-700",
  arrived: "bg-blue-100 text-blue-700",
  resolved: "bg-green-100 text-green-700",
};

const STATUS_HEX = {
  active: "#dc2626",
  assigned: "#ca8a04",
  arrived: "#2563eb",
  resolved: "#16a34a",
};

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, moderate: 2, low: 1 };

/* =========================================================
   HELPERS
========================================================= */

const normSeverity = (s) => String(s || "").toLowerCase();

function severityColor(severity) {
  const value = normSeverity(severity);
  if (value === "critical" || value === "high") return "bg-red-100 text-red-700";
  if (value === "medium" || value === "moderate")
    return "bg-yellow-100 text-yellow-700";
  return "bg-green-100 text-green-700";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function hasCoords(item) {
  return (
    item &&
    item.lat !== null &&
    item.lat !== undefined &&
    item.lng !== null &&
    item.lng !== undefined &&
    Number.isFinite(Number(item.lat)) &&
    Number.isFinite(Number(item.lng))
  );
}

function distanceKm(a, b) {
  const R = 6371;
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) *
      Math.cos(toRad(b.lat)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function createIncidentIcon(status, selected = false, escalated = false) {
  const color = STATUS_HEX[status] || STATUS_HEX.active;
  const size = selected ? 26 : 18;
  const ring = escalated ? "0 0 0 4px rgba(249,115,22,.45)," : "";

  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;background:${color};
      border:3px solid white;border-radius:50%;
      box-shadow:${ring}0 2px 8px rgba(0,0,0,.35);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function createResponderIcon(status) {
  const color =
    String(status || "").toLowerCase() === "available" ? "#16a34a" : "#6b7280";
  return L.divIcon({
    className: "",
    html: `<div style="
      width:14px;height:14px;background:${color};
      border:2px solid white;border-radius:3px;
      box-shadow:0 1px 5px rgba(0,0,0,.4);
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function timeSince(date) {
  if (!date) return "-";
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${Math.max(seconds, 0)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function durationLabel(ms) {
  if (ms === null || ms === undefined || ms < 0 || Number.isNaN(ms)) return "-";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function responseMs(createdAt, arrivedAt) {
  if (!createdAt || !arrivedAt) return null;
  const diff = new Date(arrivedAt).getTime() - new Date(createdAt).getTime();
  return diff < 0 ? null : diff;
}

function formatDate(date) {
  if (!date) return "-";
  return new Date(date).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/* Prevents spreadsheet formula injection in exported CSV */
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/* =========================================================
   COMPONENT
========================================================= */

export default function Admin() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const incidentLayer = useRef(null);
  const responderLayer = useRef(null);
  const creatingTest = useRef(false);

  const [incidents, setIncidents] = useState([]);
  const [responders, setResponders] = useState([]);
  const [events, setEvents] = useState([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [toasts, setToasts] = useState([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [escalatedOnly, setEscalatedOnly] = useState(false);
  const [hideResolved, setHideResolved] = useState(false);

  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);

  const [selectedIncidentId, setSelectedIncidentId] = useState(null);
  const [updatingIncident, setUpdatingIncident] = useState(false);
  const [assigningResponder, setAssigningResponder] = useState(false);

  const [showResponders, setShowResponders] = useState(true);
  const [simulationOn, setSimulationOn] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  /* ---------------------------------------------------------
     TOASTS
  --------------------------------------------------------- */

  const addToast = useCallback((message, tone = "info") => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev.slice(-3), { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  /* ---------------------------------------------------------
     LOAD DATA
  --------------------------------------------------------- */

  const loadData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);

    try {
      const [incidentsRes, respondersRes, eventsRes] = await Promise.all([
        supabase
          .from("incidents")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase
          .from("responders")
          .select("*")
          .order("name", { ascending: true }),
        supabase
          .from("incident_events")
          .select("*")
          .order("created_at", { ascending: true }),
      ]);

      if (incidentsRes.error) throw incidentsRes.error;
      if (respondersRes.error) throw respondersRes.error;
      if (eventsRes.error) throw eventsRes.error;

      setError("");
      setIncidents(incidentsRes.data || []);
      setResponders(respondersRes.data || []);
      setEvents(eventsRes.data || []);
      setLastUpdated(Date.now());
    } catch (err) {
      console.error("Dashboard load failed:", err);
      setError(
        err?.message || "Could not load dashboard data from Supabase."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        const [incidentsRes, respondersRes, eventsRes] = await Promise.all([
          supabase
            .from("incidents")
            .select("*")
            .order("created_at", { ascending: false }),
          supabase
            .from("responders")
            .select("*")
            .order("name", { ascending: true }),
          supabase
            .from("incident_events")
            .select("*")
            .order("created_at", { ascending: true }),
        ]);

        if (ignore) return;
        if (incidentsRes.error) throw incidentsRes.error;
        if (respondersRes.error) throw respondersRes.error;
        if (eventsRes.error) throw eventsRes.error;

        setIncidents(incidentsRes.data || []);
        setResponders(respondersRes.data || []);
        setEvents(eventsRes.data || []);
        setLastUpdated(Date.now());
      } catch (err) {
        if (ignore) return;
        console.error("Dashboard load failed:", err);
        setError(
          err?.message || "Could not load dashboard data from Supabase."
        );
      } finally {
        if (!ignore) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
    init();
    return () => {
      ignore = true;
    };
  }, []);

  /* ---------------------------------------------------------
     LIVE CLOCK (keeps relative times fresh)
  --------------------------------------------------------- */

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  /* ---------------------------------------------------------
     REALTIME
  --------------------------------------------------------- */

  useEffect(() => {
    let refreshTimer;

    const scheduleRefresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => loadData(false), 500);
    };

    const channel = supabase
      .channel("admin-dashboard-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "incidents" },
        (payload) => {
          const row = payload.new || {};
          addToast(
            `New ${row.type || "incident"} reported${
              row.severity ? ` (${row.severity})` : ""
            }`,
            "alert"
          );
          scheduleRefresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "incidents" },
        (payload) => {
          if (payload.new?.escalated && !payload.old?.escalated) {
            addToast(
              `Incident ${payload.new.type || ""} was escalated`,
              "warn"
            );
          }
          scheduleRefresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "incidents" },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "responders" },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "incident_events" },
        scheduleRefresh
      )
      .subscribe();

    return () => {
      clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [loadData, addToast]);

  /* ---------------------------------------------------------
     ESCALATION CHECK
  --------------------------------------------------------- */

  useEffect(() => {
    const interval = setInterval(async () => {
      const { error: rpcError } = await supabase.rpc("escalate_stale");
      if (rpcError) {
        console.warn("Escalation check failed:", rpcError);
        return;
      }
      loadData(false);
    }, ESCALATION_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [loadData]);

  /* ---------------------------------------------------------
     DERIVED DATA
  --------------------------------------------------------- */

  const responderById = useMemo(() => {
    const map = new Map();
    responders.forEach((r) => map.set(String(r.id), r));
    return map;
  }, [responders]);

  const selectedIncident = useMemo(
    () => incidents.find((i) => i.id === selectedIncidentId) || null,
    [incidents, selectedIncidentId]
  );

  const selectedIncidentEvents = useMemo(() => {
    if (!selectedIncident) return [];
    return events
      .filter((e) => e.incident_id === selectedIncident.id)
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
  }, [events, selectedIncident]);

  const typeOptions = useMemo(() => {
    const set = new Set(INCIDENT_TYPES);
    incidents.forEach((i) => i.type && set.add(i.type));
    return [...set];
  }, [incidents]);

  const filteredIncidents = useMemo(() => {
    const query = search.trim().toLowerCase();

    const list = incidents.filter((incident) => {
      const matchesSearch =
        !query ||
        String(incident.id || "").toLowerCase().includes(query) ||
        String(incident.type || "").toLowerCase().includes(query) ||
        String(incident.description || "").toLowerCase().includes(query) ||
        String(
          responderById.get(String((incident.assigned_to || incident.assigned_responder_id)))?.name || ""
        )
          .toLowerCase()
          .includes(query);

      const matchesStatus =
        statusFilter === "all" || incident.status === statusFilter;
      const matchesSeverity =
        severityFilter === "all" ||
        normSeverity(incident.severity) === severityFilter;
      const matchesType = typeFilter === "all" || incident.type === typeFilter;
      const matchesEscalated = !escalatedOnly || incident.escalated === true;
      const matchesResolved = !hideResolved || incident.status !== "resolved";

      return (
        matchesSearch &&
        matchesStatus &&
        matchesSeverity &&
        matchesType &&
        matchesEscalated &&
        matchesResolved
      );
    });

    const dir = sortDir === "asc" ? 1 : -1;

    return [...list].sort((a, b) => {
      let av;
      let bv;
      switch (sortKey) {
        case "severity":
          av = SEVERITY_RANK[normSeverity(a.severity)] || 0;
          bv = SEVERITY_RANK[normSeverity(b.severity)] || 0;
          break;
        case "status":
          av = STATUS_OPTIONS.indexOf(a.status);
          bv = STATUS_OPTIONS.indexOf(b.status);
          break;
        case "type":
          av = String(a.type || "");
          bv = String(b.type || "");
          return av.localeCompare(bv) * dir;
        default:
          av = new Date(a.created_at).getTime() || 0;
          bv = new Date(b.created_at).getTime() || 0;
      }
      return (av - bv) * dir;
    });
  }, [
    incidents,
    search,
    statusFilter,
    severityFilter,
    typeFilter,
    escalatedOnly,
    hideResolved,
    sortKey,
    sortDir,
    responderById,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredIncidents.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const pagedIncidents = useMemo(
    () =>
      filteredIncidents.slice(
        (currentPage - 1) * PAGE_SIZE,
        currentPage * PAGE_SIZE
      ),
    [filteredIncidents, currentPage]
  );

  const filterKey = `${search}|${statusFilter}|${severityFilter}|${typeFilter}|${escalatedOnly}|${hideResolved}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  const stats = useMemo(() => {
    const active = incidents.filter((i) => i.status !== "resolved").length;
    const critical = incidents.filter((i) => {
      const s = normSeverity(i.severity);
      return i.status !== "resolved" && (s === "critical" || s === "high");
    }).length;
    const escalated = incidents.filter(
      (i) => i.escalated === true && i.status !== "resolved"
    ).length;
    const unassigned = incidents.filter(
      (i) => (i.status === "active" || i.status === "reported") && !(i.assigned_to || i.assigned_responder_id)
    ).length;
    const resolved = incidents.filter((i) => i.status === "resolved").length;

    const availableResponders = responders.filter(
      (r) => String(r.status || "").toLowerCase() === "available"
    ).length;
    const busyResponders = responders.filter(
      (r) => String(r.status || "").toLowerCase() === "busy"
    ).length;

    const times = incidents
      .map((i) => responseMs(i.created_at, i.arrived_at))
      .filter((t) => t !== null);
    const avgResponse = times.length
      ? times.reduce((sum, t) => sum + t, 0) / times.length
      : null;

    return {
      active,
      critical,
      escalated,
      unassigned,
      resolved,
      availableResponders,
      busyResponders,
      avgResponse,
    };
  }, [incidents, responders]);

  const incidentTypeData = useMemo(() => {
    const counts = {};
    incidents.forEach((i) => {
      const type = i.type || "Other";
      counts[type] = (counts[type] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [incidents]);

  /* Nearest available responder to the selected incident */
  const nearestResponder = useMemo(() => {
    if (!selectedIncident || !hasCoords(selectedIncident)) return null;

    const origin = {
      lat: Number(selectedIncident.lat),
      lng: Number(selectedIncident.lng),
    };

    let best = null;
    responders.forEach((r) => {
      if (String(r.status || "").toLowerCase() !== "available") return;
      if (!hasCoords(r)) return;
      const km = distanceKm(origin, { lat: Number(r.lat), lng: Number(r.lng) });
      if (!best || km < best.km) best = { responder: r, km };
    });
    return best;
  }, [selectedIncident, responders]);

  /* ---------------------------------------------------------
     MAP SETUP
  --------------------------------------------------------- */

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current).setView(CENTER, 12);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    incidentLayer.current = L.layerGroup().addTo(map);
    responderLayer.current = L.layerGroup().addTo(map);
    mapInstance.current = map;

    const timer = setTimeout(() => map.invalidateSize(), 300);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapInstance.current = null;
      incidentLayer.current = null;
      responderLayer.current = null;
    };
  }, []);

  /* Incident markers */
  useEffect(() => {
    const layer = incidentLayer.current;
    if (!layer) return;

    layer.clearLayers();

    incidents.forEach((incident) => {
      if (!hasCoords(incident)) return;
      if (incident.status === "resolved" && incident.id !== selectedIncidentId)
        return;

      const marker = L.marker([Number(incident.lat), Number(incident.lng)], {
        icon: createIncidentIcon(
          incident.status,
          incident.id === selectedIncidentId,
          incident.escalated === true
        ),
        zIndexOffset: incident.id === selectedIncidentId ? 1000 : 0,
      });

      marker.bindPopup(`
        <div style="min-width:170px">
          <strong>${escapeHtml(incident.type || "Incident")}</strong><br/>
          Status: ${escapeHtml(
            STATUS_LABELS[incident.status] || incident.status || "-"
          )}<br/>
          Severity: ${escapeHtml(incident.severity || "-")}
          ${incident.escalated ? "<br/><b style='color:#ea580c'>Escalated</b>" : ""}
        </div>
      `);

      marker.on("click", () => setSelectedIncidentId(incident.id));
      marker.addTo(layer);
    });
  }, [incidents, selectedIncidentId]);

  /* Responder markers */
  useEffect(() => {
    const layer = responderLayer.current;
    if (!layer) return;

    layer.clearLayers();
    if (!showResponders) return;

    responders.forEach((r) => {
      if (!hasCoords(r)) return;

      const marker = L.marker([Number(r.lat), Number(r.lng)], {
        icon: createResponderIcon(r.status),
      });

      marker.bindPopup(`
        <div>
          <strong>${escapeHtml(r.name || "Responder")}</strong><br/>
          ${escapeHtml(r.type || "Responder")} · ${escapeHtml(r.status || "-")}
        </div>
      `);

      marker.addTo(layer);
    });
  }, [responders, showResponders]);

  /* Fly to the selected incident */
  useEffect(() => {
    if (!selectedIncident || !mapInstance.current || !hasCoords(selectedIncident))
      return;

    mapInstance.current.flyTo(
      [Number(selectedIncident.lat), Number(selectedIncident.lng)],
      Math.max(mapInstance.current.getZoom(), 14),
      { duration: 0.8 }
    );
    // only re-fly when selection changes, not on every data refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIncidentId]);

  const fitAllIncidents = () => {
    const map = mapInstance.current;
    if (!map) return;

    const points = incidents
      .filter((i) => hasCoords(i) && i.status !== "resolved")
      .map((i) => [Number(i.lat), Number(i.lng)]);

    if (points.length === 0) {
      map.setView(CENTER, 12);
      return;
    }

    map.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
  };

  /* Esc closes the details panel */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") setSelectedIncidentId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------------------------------------------------------
     RESPONDER STATUS HELPER
  --------------------------------------------------------- */

  const setResponderStatus = async (responderId, status) => {
    if (!responderId) return;

    const { error: respError } = await supabase
      .from("responders")
      .update({ status })
      .eq("id", responderId);

    if (respError) {
      console.warn("Responder status update failed:", respError);
    }
  };

  /* ---------------------------------------------------------
     INCIDENT STATUS UPDATE
  --------------------------------------------------------- */

  const updateIncidentStatus = async (newStatus) => {
    if (!selectedIncident || selectedIncident.status === newStatus) return;

    if (
      newStatus === "resolved" &&
      !window.confirm("Mark this incident as resolved?")
    ) {
      return;
    }

    setUpdatingIncident(true);
    setActionError("");

    try {
      const patch = { status: newStatus };

      /* arrival timestamp captured in incident_events */

      const { error: updateError } = await supabase
        .from("incidents")
        .update(patch)
        .eq("id", selectedIncident.id);

      if (updateError) throw updateError;

      const { error: eventError } = await supabase
        .from("incident_events")
        .insert({ incident_id: selectedIncident.id, status: newStatus });

      if (eventError) {
        console.warn("Incident updated, but timeline event failed:", eventError);
      }

      /* Free the responder once the incident is resolved */
      if (newStatus === "resolved") {
        await setResponderStatus(
          (selectedIncident.assigned_to || selectedIncident.assigned_responder_id),
          "available"
        );
      }

      addToast(`Status changed to ${STATUS_LABELS[newStatus]}`, "success");
      await loadData(false);
    } catch (err) {
      console.error("Incident status update failed:", err);
      setActionError(err?.message || "Failed to update incident status.");
    } finally {
      setUpdatingIncident(false);
    }
  };

  /* ---------------------------------------------------------
     RESPONDER ASSIGNMENT
  --------------------------------------------------------- */

  const assignResponder = async (responderId) => {
    if (!selectedIncident) return;

    const value = responderId === "" ? null : responderId;
    const previousId = (selectedIncident.assigned_to || selectedIncident.assigned_responder_id);

    if (String(value ?? "") === String(previousId ?? "")) return;

    setAssigningResponder(true);
    setActionError("");

    try {
      let nextStatus = selectedIncident.status;
      if (value && selectedIncident.status === "active") nextStatus = "assigned";
      if (!value && selectedIncident.status === "assigned") nextStatus = "active";

      const { error: updateError } = await supabase
        .from("incidents")
        .update({ assigned_to: value, status: nextStatus })
        .eq("id", selectedIncident.id);

      if (updateError) throw updateError;

      if (nextStatus !== selectedIncident.status) {
        const { error: eventError } = await supabase
          .from("incident_events")
          .insert({ incident_id: selectedIncident.id, status: nextStatus });

        if (eventError) {
          console.warn("Assignment saved, but timeline event failed:", eventError);
        }
      }

      /* Keep responder availability in sync */
      if (previousId) await setResponderStatus(previousId, "available");
      if (value) await setResponderStatus(value, "busy");

      addToast(
        value
          ? `Assigned ${responderById.get(String(value))?.name || "responder"}`
          : "Responder unassigned",
        "success"
      );
      await loadData(false);
    } catch (err) {
      console.error("Responder assignment failed:", err);
      setActionError(err?.message || "Failed to assign responder.");
    } finally {
      setAssigningResponder(false);
    }
  };

  /* ---------------------------------------------------------
     TEST INCIDENTS
  --------------------------------------------------------- */

  const createTestIncident = useCallback(
    async (silent = false) => {
      if (creatingTest.current) return;
      creatingTest.current = true;
      setActionError("");

      try {
        const type =
          INCIDENT_TYPES[Math.floor(Math.random() * INCIDENT_TYPES.length)];
        const jitter = () => (Math.random() - 0.5) * 0.08;

        const { error: rpcError } = await supabase.rpc("create_incident", {
          p_type: type,
          p_description: "Simulated emergency incident.",
          p_lat: CENTER[0] + jitter(),
          p_lng: CENTER[1] + jitter(),
        });

        if (rpcError) throw rpcError;

        if (!silent) addToast(`Test ${type} incident created`, "success");
        await loadData(false);
      } catch (err) {
        console.error("Test incident creation failed:", err);
        setActionError(err?.message || "Could not create test incident.");
        setSimulationOn(false);
      } finally {
        creatingTest.current = false;
      }
    },
    [loadData, addToast]
  );

  useEffect(() => {
    if (!simulationOn) return;

    const interval = setInterval(() => createTestIncident(true), TEST_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [simulationOn, createTestIncident]);

  /* ---------------------------------------------------------
     CSV EXPORT (respects current filters)
  --------------------------------------------------------- */

  const exportCSV = () => {
    if (!filteredIncidents.length) return;

    const headers = [
      "ID",
      "Type",
      "Description",
      "Severity",
      "Status",
      "Escalated",
      "Responder",
      "Latitude",
      "Longitude",
      "Created At",
      "Arrived At",
      "Response Time",
      "Last Updated",
    ];

    const rows = filteredIncidents.map((incident) => [
      incident.id,
      incident.type,
      incident.description,
      incident.severity,
      incident.status,
      incident.escalated ? "Yes" : "No",
      responderById.get(String((incident.assigned_to || incident.assigned_responder_id)))?.name,
      incident.lat,
      incident.lng,
      incident.created_at,
      incident.arrived_at,
      durationLabel(responseMs(incident.created_at, incident.arrived_at)),
      incident.updated_at,
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\n");

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `emergency-incidents-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  /* ---------------------------------------------------------
     UI HELPERS
  --------------------------------------------------------- */

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "type" ? "asc" : "desc");
    }
  };

  const sortArrow = (key) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setSeverityFilter("all");
    setTypeFilter("all");
    setEscalatedOnly(false);
    setHideResolved(false);
  };

  const filtersActive =
    search ||
    statusFilter !== "all" ||
    severityFilter !== "all" ||
    typeFilter !== "all" ||
    escalatedOnly ||
    hideResolved;

  const toastStyles = {
    info: "bg-slate-900 text-white",
    success: "bg-emerald-600 text-white",
    warn: "bg-orange-500 text-white",
    alert: "bg-red-600 text-white",
  };

  const statCards = [
    { label: "Open Incidents", value: stats.active, color: "" },
    { label: "Critical / High", value: stats.critical, color: "text-red-600" },
    { label: "Escalated", value: stats.escalated, color: "text-orange-600" },
    { label: "Unassigned", value: stats.unassigned, color: "text-red-600" },
    {
      label: "Responders Free",
      value: `${stats.availableResponders}/${responders.length}`,
      color: "text-green-600",
    },
    {
      label: "Avg Response",
      value: durationLabel(stats.avgResponse),
      color: "text-blue-600",
    },
    { label: "Resolved", value: stats.resolved, color: "text-green-600" },
  ];

  /* ---------------------------------------------------------
     RENDER
  --------------------------------------------------------- */

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* TOASTS */}
      <div
        className="fixed top-4 right-4 z-[2000] space-y-2 w-72"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
              toastStyles[toast.tone] || toastStyles.info
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>

      {/* HEADER */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-[1100]">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Emergency Admin Dashboard</h1>
            <p className="text-sm text-slate-500 mt-1 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Live · {new Date(now).toLocaleTimeString("en-IN")}
              {lastUpdated && ` · synced ${timeSince(lastUpdated)}`}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => loadData(true)}
              disabled={refreshing}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>

            <button
              onClick={() => createTestIncident(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50"
            >
              Test Incident
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* ERRORS */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 flex justify-between gap-4">
            <div>
              <p className="font-semibold">Could not load dashboard</p>
              <p className="text-sm mt-1">{error}</p>
            </div>
            <button
              onClick={() => loadData(true)}
              className="text-sm font-medium underline"
            >
              Retry
            </button>
          </div>
        )}

        {actionError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4">
            <div className="flex justify-between gap-4">
              <div>
                <p className="font-semibold">Action failed</p>
                <p className="text-sm mt-1">{actionError}</p>
              </div>
              <button
                onClick={() => setActionError("")}
                className="text-red-700 font-bold"
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* UNASSIGNED ALERT */}
        {stats.unassigned > 0 && (
          <div className="bg-red-600 text-white rounded-xl px-5 py-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              ⚠ {stats.unassigned} active incident
              {stats.unassigned > 1 ? "s" : ""} waiting for a responder
            </p>
            <button
              onClick={() => {
                setStatusFilter("active");
                setSortKey("severity");
                setSortDir("desc");
              }}
              className="text-xs font-semibold bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg"
            >
              Show them
            </button>
          </div>
        )}

        {/* STATS */}
        <section className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
          {statCards.map((card) => (
            <div
              key={card.label}
              className="bg-white rounded-xl border border-slate-200 p-4"
            >
              <p className="text-sm text-slate-500">{card.label}</p>
              <p className={`text-2xl font-bold mt-1 ${card.color}`}>
                {loading ? "…" : card.value}
              </p>
            </div>
          ))}
        </section>

        {/* MAP */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Live Incident Map</h2>
              <p className="text-sm text-slate-500">
                Open incidents and responder positions
              </p>
            </div>

            <div className="flex items-center gap-4 text-sm">
              <label className="flex items-center gap-2 text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showResponders}
                  onChange={(e) => setShowResponders(e.target.checked)}
                />
                Responders
              </label>

              <button
                onClick={fitAllIncidents}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Fit all
              </button>
            </div>
          </div>

          <div ref={mapRef} className="h-[380px] w-full" />

          <div className="px-5 py-3 border-t border-slate-100 flex flex-wrap gap-4 text-xs text-slate-500">
            {STATUS_OPTIONS.map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span
                  className="inline-block w-3 h-3 rounded-full"
                  style={{ background: STATUS_HEX[s] }}
                />
                {STATUS_LABELS[s]}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-green-600" />
              Responder
            </span>
          </div>
        </section>

        {/* INCIDENTS */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-slate-200 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <h2 className="font-semibold">Incidents</h2>
                <p className="text-sm text-slate-500">
                  {filteredIncidents.length} of {incidents.length} incidents
                </p>
              </div>

              <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search type, description, responder..."
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-300"
                />

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="all">All statuses</option>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>

                <select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="all">All severity</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>

                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="all">All types</option>
                  {typeOptions.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={escalatedOnly}
                  onChange={(e) => setEscalatedOnly(e.target.checked)}
                />
                Escalated only
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideResolved}
                  onChange={(e) => setHideResolved(e.target.checked)}
                />
                Hide resolved
              </label>

              {filtersActive && (
                <button
                  onClick={clearFilters}
                  className="text-slate-900 underline font-medium"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="p-5 space-y-3">
              {[0, 1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="h-12 bg-slate-100 rounded-lg animate-pulse"
                />
              ))}
            </div>
          ) : filteredIncidents.length === 0 ? (
            <div className="p-10 text-center text-slate-500">
              No incidents found.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {[
                        ["type", "Type"],
                        ["severity", "Severity"],
                        ["status", "Status"],
                      ].map(([key, label]) => (
                        <th
                          key={key}
                          onClick={() => toggleSort(key)}
                          className="text-left px-5 py-3 font-medium text-slate-500 cursor-pointer select-none hover:text-slate-900"
                        >
                          {label}
                          {sortArrow(key)}
                        </th>
                      ))}
                      <th className="text-left px-5 py-3 font-medium text-slate-500">
                        Responder
                      </th>
                      <th
                        onClick={() => toggleSort("created_at")}
                        className="text-left px-5 py-3 font-medium text-slate-500 cursor-pointer select-none hover:text-slate-900"
                      >
                        Reported{sortArrow("created_at")}
                      </th>
                      <th className="text-right px-5 py-3 font-medium text-slate-500">
                        Action
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {pagedIncidents.map((incident) => {
                      const responder = responderById.get(
                        String((incident.assigned_to || incident.assigned_responder_id))
                      );
                      const isSelected = incident.id === selectedIncidentId;

                      return (
                        <tr
                          key={incident.id}
                          onClick={() => setSelectedIncidentId(incident.id)}
                          className={`border-b border-slate-100 cursor-pointer hover:bg-slate-50 ${
                            isSelected ? "bg-slate-100" : ""
                          }`}
                        >
                          <td className="px-5 py-4">
                            <div className="font-medium flex items-center gap-2">
                              {incident.type || "Other"}
                              {incident.escalated && (
                                <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-[10px] font-semibold uppercase">
                                  Escalated
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-400 max-w-[250px] truncate">
                              {incident.description || "No description"}
                            </div>
                          </td>

                          <td className="px-5 py-4">
                            <span
                              className={`px-2 py-1 rounded-full text-xs font-medium ${severityColor(
                                incident.severity
                              )}`}
                            >
                              {incident.severity || "Unknown"}
                            </span>
                          </td>

                          <td className="px-5 py-4">
                            <span
                              className={`px-2 py-1 rounded-full text-xs font-medium ${
                                STATUS_COLORS[incident.status] ||
                                "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {STATUS_LABELS[incident.status] ||
                                incident.status ||
                                "Unknown"}
                            </span>
                          </td>

                          <td className="px-5 py-4">
                            {responder?.name || (
                              <span className="text-slate-400">Unassigned</span>
                            )}
                          </td>

                          <td
                            className="px-5 py-4 text-slate-500"
                            title={formatDate(incident.created_at)}
                          >
                            {timeSince(incident.created_at)}
                          </td>

                          <td className="px-5 py-4 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedIncidentId(incident.id);
                              }}
                              className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* PAGINATION */}
              <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between text-sm text-slate-500">
                <span>
                  Page {currentPage} of {totalPages}
                </span>

                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        {/* SELECTED INCIDENT */}
        {selectedIncident && (
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="font-semibold flex items-center gap-2">
                  Incident Details
                  {selectedIncident.escalated && (
                    <span className="px-2 py-0.5 rounded bg-orange-100 text-orange-700 text-xs font-semibold">
                      Escalated
                    </span>
                  )}
                </h2>
                <p className="text-sm text-slate-500 break-all">
                  Incident #{selectedIncident.id}
                </p>
              </div>

              <button
                onClick={() => setSelectedIncidentId(null)}
                className="text-slate-400 hover:text-slate-700 text-xl"
                aria-label="Close details"
              >
                ×
              </button>
            </div>

            <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* DETAILS */}
              <div>
                <h3 className="font-medium mb-3">Details</h3>

                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-slate-400">Type</p>
                    <p className="font-medium">
                      {selectedIncident.type || "Other"}
                    </p>
                  </div>

                  <div>
                    <p className="text-slate-400">Description</p>
                    <p>
                      {selectedIncident.description || "No description provided."}
                    </p>
                  </div>

                  <div>
                    <p className="text-slate-400">Severity</p>
                    <span
                      className={`inline-block mt-1 px-2 py-1 rounded-full text-xs font-medium ${severityColor(
                        selectedIncident.severity
                      )}`}
                    >
                      {selectedIncident.severity || "Unknown"}
                    </span>
                  </div>

                  <div>
                    <p className="text-slate-400">Reported</p>
                    <p>
                      {formatDate(selectedIncident.created_at)}{" "}
                      <span className="text-slate-400">
                        ({timeSince(selectedIncident.created_at)})
                      </span>
                    </p>
                  </div>

                  <div>
                    <p className="text-slate-400">Response Time</p>
                    <p>
                      {durationLabel(
                        responseMs(
                          selectedIncident.created_at,
                          selectedIncident.arrived_at
                        )
                      )}
                    </p>
                  </div>

                  {hasCoords(selectedIncident) && (
                    <div>
                      <p className="text-slate-400">Location</p>
                      <p>
                        {Number(selectedIncident.lat).toFixed(5)},{" "}
                        {Number(selectedIncident.lng).toFixed(5)}
                      </p>
                      <a
                        href={`https://www.google.com/maps?q=${selectedIncident.lat},${selectedIncident.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 underline text-xs"
                      >
                        Open in Google Maps
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* STATUS + ASSIGNMENT */}
              <div>
                <h3 className="font-medium mb-3">Manage Incident</h3>

                <p className="text-xs text-slate-500 mb-2">Update status</p>

                <div className="flex flex-wrap gap-2">
                  {STATUS_OPTIONS.map((status) => (
                    <button
                      key={status}
                      onClick={() => updateIncidentStatus(status)}
                      disabled={
                        updatingIncident || selectedIncident.status === status
                      }
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                        selectedIncident.status === status
                          ? "bg-slate-700 text-white cursor-default"
                          : status === "resolved"
                          ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                          : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                      } disabled:opacity-50`}
                    >
                      {status === "resolved" ? "✓ Resolve" : STATUS_LABELS[status]}
                    </button>
                  ))}
                </div>

                <div className="mt-6">
                  <label className="text-xs text-slate-500 block mb-2">
                    Assign responder
                  </label>

                  <select
                    value={(selectedIncident.assigned_to || selectedIncident.assigned_responder_id) || ""}
                    onChange={(e) => assignResponder(e.target.value)}
                    disabled={
                      assigningResponder || selectedIncident.status === "resolved"
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white disabled:bg-slate-50"
                  >
                    <option value="">Unassigned</option>
                    {responders.map((responder) => {
                      const isCurrent =
                        String(responder.id) ===
                        String((selectedIncident.assigned_to || selectedIncident.assigned_responder_id));
                      const busy =
                        String(responder.status || "").toLowerCase() === "busy";

                      return (
                        <option
                          key={responder.id}
                          value={responder.id}
                          disabled={busy && !isCurrent}
                        >
                          {responder.name}
                          {responder.status ? ` — ${responder.status}` : ""}
                        </option>
                      );
                    })}
                  </select>

                  {nearestResponder &&
                    !(selectedIncident.assigned_to || selectedIncident.assigned_responder_id) &&
                    selectedIncident.status !== "resolved" && (
                      <button
                        onClick={() =>
                          assignResponder(String(nearestResponder.responder.id))
                        }
                        disabled={assigningResponder}
                        className="mt-3 w-full px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50"
                      >
                        Assign nearest: {nearestResponder.responder.name} (
                        {nearestResponder.km.toFixed(1)} km)
                      </button>
                    )}

                  {assigningResponder && (
                    <p className="text-xs text-slate-400 mt-2">
                      Updating assignment...
                    </p>
                  )}
                </div>
              </div>

              {/* TIMELINE */}
              <div>
                <h3 className="font-medium mb-3">Incident Timeline</h3>

                {selectedIncidentEvents.length === 0 ? (
                  <p className="text-sm text-slate-400">No timeline events yet.</p>
                ) : (
                  <div className="space-y-4">
                    {selectedIncidentEvents.map((event, index) => (
                      <div
                        key={event.id || `${event.created_at}-${index}`}
                        className="flex gap-3"
                      >
                        <div className="flex flex-col items-center">
                          <div
                            className="w-3 h-3 rounded-full mt-1"
                            style={{
                              background: STATUS_HEX[event.status] || "#334155",
                            }}
                          />
                          {index !== selectedIncidentEvents.length - 1 && (
                            <div className="w-px bg-slate-200 flex-1 mt-1" />
                          )}
                        </div>

                        <div className="pb-3">
                          <p className="text-sm font-medium">
                            {STATUS_LABELS[event.status] ||
                              event.status ||
                              "Updated"}
                          </p>
                          <p className="text-xs text-slate-400 mt-1">
                            {formatDate(event.created_at)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ANALYTICS */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="mb-4">
              <h2 className="font-semibold">Incident Types</h2>
              <p className="text-sm text-slate-500">
                Current incident distribution
              </p>
            </div>

            {incidentTypeData.length === 0 ? (
              <p className="text-sm text-slate-400">No incident data available.</p>
            ) : (
              <div className="space-y-3">
                {incidentTypeData.map(([type, count]) => {
                  const percentage =
                    incidents.length > 0
                      ? Math.round((count / incidents.length) * 100)
                      : 0;

                  return (
                    <div key={type}>
                      <div className="flex justify-between text-sm mb-1">
                        <span>{type}</span>
                        <span className="text-slate-500">
                          {count} ({percentage}%)
                        </span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-slate-700 rounded-full"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="mb-4">
              <h2 className="font-semibold">Responder Availability</h2>
              <p className="text-sm text-slate-500">
                {stats.availableResponders} available · {stats.busyResponders} busy
              </p>
            </div>

            {responders.length === 0 ? (
              <p className="text-sm text-slate-400">No responders found.</p>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {responders.map((responder) => {
                  const status = String(responder.status || "").toLowerCase();
                  const currentJob = incidents.find(
                    (i) =>
                      String((i.assigned_to || i.assigned_responder_id)) === String(responder.id) &&
                      i.status !== "resolved"
                  );

                  return (
                    <div
                      key={responder.id}
                      className="flex items-center justify-between border-b border-slate-100 pb-3"
                    >
                      <div>
                        <p className="font-medium text-sm">{responder.name}</p>
                        <p className="text-xs text-slate-400">
                          {responder.type || "Responder"}
                          {currentJob && (
                            <button
                              onClick={() => setSelectedIncidentId(currentJob.id)}
                              className="ml-2 text-blue-600 underline"
                            >
                              on {currentJob.type || "incident"}
                            </button>
                          )}
                        </p>
                      </div>

                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          status === "available"
                            ? "bg-green-100 text-green-700"
                            : status === "busy"
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {responder.status || "Unknown"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* REPORTS */}
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="font-semibold">Reports</h2>
              <p className="text-sm text-slate-500">
                Export the {filteredIncidents.length} incident
                {filteredIncidents.length === 1 ? "" : "s"} matching the current
                filters
              </p>
            </div>

            <button
              onClick={exportCSV}
              disabled={filteredIncidents.length === 0}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-40"
            >
              Export CSV
            </button>
          </div>
        </section>

        {/* TEST MODE */}
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold">Test Mode</h2>
              <p className="text-sm text-slate-500">
                Creates real test incidents in Supabase every 8 seconds. Turn off
                before going live.
              </p>
            </div>

            <button
              onClick={() => setSimulationOn((value) => !value)}
              className={`px-4 py-2 rounded-lg text-sm font-medium shrink-0 ${
                simulationOn
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {simulationOn ? "Stop Test Mode" : "Start Test Mode"}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
