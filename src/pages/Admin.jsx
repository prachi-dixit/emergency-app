import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "../lib/supabase";

const CENTER = [17.385, 78.4867];

const INCIDENT_TYPES = [
  "Medical",
  "Fire",
  "Accident",
  "Crime",
  "Other",
];

const STATUS_OPTIONS = [
  "active",
  "assigned",
  "arrived",
  "resolved",
];

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

function severityColor(severity) {
  const value = String(severity || "").toLowerCase();

  if (value === "critical" || value === "high") {
    return "bg-red-100 text-red-700";
  }

  if (value === "medium" || value === "moderate") {
    return "bg-yellow-100 text-yellow-700";
  }

  return "bg-green-100 text-green-700";
}

function createMapIcon(status) {
  const color =
    status === "resolved"
      ? "#16a34a"
      : status === "arrived"
      ? "#2563eb"
      : status === "assigned"
      ? "#ca8a04"
      : "#dc2626";

  return L.divIcon({
    className: "",
    html: `
      <div style="
        width:18px;
        height:18px;
        background:${color};
        border:3px solid white;
        border-radius:50%;
        box-shadow:0 2px 8px rgba(0,0,0,.35);
      "></div>
    `,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function timeSince(date) {
  if (!date) return "-";

  const seconds = Math.floor(
    (Date.now() - new Date(date).getTime()) / 1000
  );

  if (seconds < 60) return `${Math.max(seconds, 0)}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

function responseTime(createdAt, arrivedAt) {
  if (!createdAt || !arrivedAt) return "-";

  const diff =
    new Date(arrivedAt).getTime() -
    new Date(createdAt).getTime();

  if (diff < 0) return "-";

  const minutes = Math.floor(diff / 60000);

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;

  return `${hours}h ${remaining}m`;
}

function formatDate(date) {
  if (!date) return "-";

  return new Date(date).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function Admin() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markersRef = useRef([]);

  const [incidents, setIncidents] = useState([]);
  const [responders, setResponders] = useState([]);
  const [services, setServices] = useState([]);
  const [events, setEvents] = useState([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");

  const [selectedIncidentId, setSelectedIncidentId] = useState(null);

  const [updatingIncident, setUpdatingIncident] = useState(false);
  const [assigningResponder, setAssigningResponder] = useState(false);

  const [simulationOn, setSimulationOn] = useState(false);

  const [now, setNow] = useState(Date.now());

  /* ---------------------------------------------------------
     LOAD DATA
  --------------------------------------------------------- */

  const loadData = useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }

    setError("");

    try {
      const [
        incidentsResult,
        respondersResult,
        servicesResult,
        eventsResult,
      ] = await Promise.all([
        supabase
          .from("incidents")
          .select("*")
          .order("created_at", { ascending: false }),

        supabase
          .from("responders")
          .select("*")
          .order("name", { ascending: true }),

        supabase
          .from("services")
          .select("*")
          .order("name", { ascending: true }),

        supabase
          .from("incident_events")
          .select("*")
          .order("created_at", { ascending: true }),
      ]);

      if (incidentsResult.error) throw incidentsResult.error;
      if (respondersResult.error) throw respondersResult.error;
      if (servicesResult.error) throw servicesResult.error;
      if (eventsResult.error) throw eventsResult.error;

      setIncidents(incidentsResult.data || []);
      setResponders(respondersResult.data || []);
      setServices(servicesResult.data || []);
      setEvents(eventsResult.data || []);
    } catch (err) {
      console.error("Dashboard load failed:", err);

      setError(
        err?.message ||
          "Could not load dashboard data from Supabase."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /* ---------------------------------------------------------
     LIVE CLOCK
  --------------------------------------------------------- */

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  /* ---------------------------------------------------------
     REALTIME UPDATES
  --------------------------------------------------------- */

  useEffect(() => {
    let refreshTimer;

    const scheduleRefresh = () => {
      clearTimeout(refreshTimer);

      refreshTimer = setTimeout(() => {
        loadData(false);
      }, 500);
    };

    const channel = supabase
      .channel("admin-dashboard-live")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "incidents",
        },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "responders",
        },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "services",
        },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "incident_events",
        },
        scheduleRefresh
      )
      .subscribe();

    return () => {
      clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  /* ---------------------------------------------------------
     ESCALATION CHECK
  --------------------------------------------------------- */

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        await supabase.rpc("escalate_stale");
        loadData(false);
      } catch (err) {
        console.warn("Escalation check failed:", err);
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [loadData]);

  /* ---------------------------------------------------------
     MAP
  --------------------------------------------------------- */

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current).setView(CENTER, 12);

    L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution: "&copy; OpenStreetMap contributors",
      }
    ).addTo(map);

    mapInstance.current = map;

    setTimeout(() => {
      map.invalidateSize();
    }, 300);

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapInstance.current) return;

    markersRef.current.forEach((marker) => {
      marker.remove();
    });

    markersRef.current = [];

    incidents.forEach((incident) => {
      if (
        incident.lat === null ||
        incident.lat === undefined ||
        incident.lng === null ||
        incident.lng === undefined
      ) {
        return;
      }

      const marker = L.marker(
        [Number(incident.lat), Number(incident.lng)],
        {
          icon: createMapIcon(incident.status),
        }
      );

      marker.bindPopup(`
        <div style="min-width:180px">
          <strong>${incident.type || "Incident"}</strong>
          <br/>
          Status: ${STATUS_LABELS[incident.status] || incident.status || "-"}
          <br/>
          Severity: ${incident.severity || "-"}
        </div>
      `);

      marker.on("click", () => {
        setSelectedIncidentId(incident.id);
      });

      marker.addTo(mapInstance.current);

      markersRef.current.push(marker);
    });
  }, [incidents]);

  /* ---------------------------------------------------------
     SELECTED INCIDENT
  --------------------------------------------------------- */

  const selectedIncident = useMemo(() => {
    return incidents.find(
      (incident) => incident.id === selectedIncidentId
    );
  }, [incidents, selectedIncidentId]);

  const selectedIncidentEvents = useMemo(() => {
    if (!selectedIncident) return [];

    return events
      .filter(
        (event) => event.incident_id === selectedIncident.id
      )
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() -
          new Date(b.created_at).getTime()
      );
  }, [events, selectedIncident]);

  /* ---------------------------------------------------------
     FILTERING
  --------------------------------------------------------- */

  const filteredIncidents = useMemo(() => {
    const query = search.trim().toLowerCase();

    return incidents.filter((incident) => {
      const matchesSearch =
        !query ||
        String(incident.id || "")
          .toLowerCase()
          .includes(query) ||
        String(incident.type || "")
          .toLowerCase()
          .includes(query) ||
        String(incident.description || "")
          .toLowerCase()
          .includes(query);

      const matchesStatus =
        statusFilter === "all" ||
        incident.status === statusFilter;

      const matchesSeverity =
        severityFilter === "all" ||
        String(incident.severity || "").toLowerCase() ===
          severityFilter.toLowerCase();

      return (
        matchesSearch &&
        matchesStatus &&
        matchesSeverity
      );
    });
  }, [
    incidents,
    search,
    statusFilter,
    severityFilter,
  ]);

  /* ---------------------------------------------------------
     STATS
  --------------------------------------------------------- */

  const stats = useMemo(() => {
    const active = incidents.filter(
      (i) => i.status !== "resolved"
    ).length;

    const critical = incidents.filter((i) => {
      const severity = String(
        i.severity || ""
      ).toLowerCase();

      return (
        severity === "critical" ||
        severity === "high"
      );
    }).length;

    const escalated = incidents.filter(
      (i) => i.escalated === true
    ).length;

    const availableResponders = responders.filter(
      (r) =>
        String(r.status || "").toLowerCase() ===
        "available"
    ).length;

    const busyResponders = responders.filter(
      (r) =>
        String(r.status || "").toLowerCase() ===
        "busy"
    ).length;

    const resolved = incidents.filter(
      (i) => i.status === "resolved"
    ).length;

    return {
      active,
      critical,
      escalated,
      availableResponders,
      busyResponders,
      resolved,
    };
  }, [incidents, responders]);

  /* ---------------------------------------------------------
     INCIDENT STATUS UPDATE
  --------------------------------------------------------- */

  const updateIncidentStatus = async (newStatus) => {
    if (!selectedIncident) return;

    if (selectedIncident.status === newStatus) {
      return;
    }

    setUpdatingIncident(true);
    setActionError("");

    try {
      const { error: updateError } = await supabase
        .from("incidents")
        .update({
          status: newStatus,
        })
        .eq("id", selectedIncident.id);

      if (updateError) {
        throw updateError;
      }

      /*
       * Add the status change to the timeline.
       */
      const { error: eventError } = await supabase
        .from("incident_events")
        .insert({
          incident_id: selectedIncident.id,
          status: newStatus,
        });

      if (eventError) {
        console.warn(
          "Incident updated, but timeline event failed:",
          eventError
        );
      }

      await loadData(false);
    } catch (err) {
      console.error(
        "Incident status update failed:",
        err
      );

      setActionError(
        err?.message ||
          "Failed to update incident status."
      );
    } finally {
      setUpdatingIncident(false);
    }
  };

  /* ---------------------------------------------------------
     RESPONDER ASSIGNMENT
  --------------------------------------------------------- */

  const assignResponder = async (responderId) => {
    if (!selectedIncident) return;

    setAssigningResponder(true);
    setActionError("");

    try {
      const value =
        responderId === "" ? null : responderId;

      const { error } = await supabase
        .from("incidents")
        .update({
          assigned_responder_id: value,
          status:
            value && selectedIncident.status === "active"
              ? "assigned"
              : selectedIncident.status,
        })
        .eq("id", selectedIncident.id);

      if (error) {
        throw error;
      }

      if (value) {
        const { error: eventError } = await supabase
          .from("incident_events")
          .insert({
            incident_id: selectedIncident.id,
            status: "assigned",
          });

        if (eventError) {
          console.warn(
            "Responder assigned, but timeline event failed:",
            eventError
          );
        }
      }

      await loadData(false);
    } catch (err) {
      console.error(
        "Responder assignment failed:",
        err
      );

      setActionError(
        err?.message ||
          "Failed to assign responder."
      );
    } finally {
      setAssigningResponder(false);
    }
  };

  /* ---------------------------------------------------------
     TEST INCIDENT
     REAL SUPABASE ONLY
  --------------------------------------------------------- */

  const createTestIncident = async () => {
    setActionError("");

    try {
      const { error } = await supabase.rpc(
        "create_incident",
        {
          p_type: "Medical",
          p_description:
            "Test emergency incident created from admin dashboard.",
          p_lat: CENTER[0],
          p_lng: CENTER[1],
        }
      );

      if (error) {
        throw error;
      }

      await loadData(true);
    } catch (err) {
      console.error(
        "Test incident creation failed:",
        err
      );

      setActionError(
        err?.message ||
          "Could not create test incident."
      );
    }
  };

  /* ---------------------------------------------------------
     AUTO TEST INCIDENT
  --------------------------------------------------------- */

  useEffect(() => {
    if (!simulationOn) return;

    const interval = setInterval(() => {
      createTestIncident();
    }, 8000);

    return () => clearInterval(interval);
  }, [simulationOn]);

  /* ---------------------------------------------------------
     CSV EXPORT
  --------------------------------------------------------- */

  const exportCSV = () => {
    if (!incidents.length) return;

    const headers = [
      "ID",
      "Type",
      "Description",
      "Severity",
      "Status",
      "Responder",
      "Created At",
      "Resolved At",
    ];

    const rows = incidents.map((incident) => {
      const responder = responders.find(
        (r) =>
          String(r.id) ===
          String(incident.assigned_responder_id)
      );

      return [
        incident.id,
        incident.type || "",
        incident.description || "",
        incident.severity || "",
        incident.status || "",
        responder?.name || "",
        incident.created_at || "",
        incident.status === "resolved"
          ? incident.updated_at || ""
          : "",
      ];
    });

    const csv = [
      headers,
      ...rows,
    ]
      .map((row) =>
        row
          .map((value) =>
            `"${String(value ?? "").replaceAll(
              '"',
              '""'
            )}"`
          )
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "emergency-incidents.csv";
    link.click();

    URL.revokeObjectURL(url);
  };

  /* ---------------------------------------------------------
     INCIDENT TYPES
  --------------------------------------------------------- */

  const incidentTypeData = useMemo(() => {
    const counts = {};

    incidents.forEach((incident) => {
      const type = incident.type || "Other";
      counts[type] = (counts[type] || 0) + 1;
    });

    return Object.entries(counts).sort(
      (a, b) => b[1] - a[1]
    );
  }, [incidents]);

  /* ---------------------------------------------------------
     RENDER
  --------------------------------------------------------- */

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* HEADER */}

      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">
              Emergency Admin Dashboard
            </h1>

            <p className="text-sm text-slate-500 mt-1">
              Monitor incidents, responders and emergency services
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
              onClick={createTestIncident}
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
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4">
            <p className="font-semibold">
              Could not load dashboard
            </p>

            <p className="text-sm mt-1">
              {error}
            </p>
          </div>
        )}

        {actionError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4">
            <div className="flex justify-between gap-4">
              <div>
                <p className="font-semibold">
                  Action failed
                </p>

                <p className="text-sm mt-1">
                  {actionError}
                </p>
              </div>

              <button
                onClick={() => setActionError("")}
                className="text-red-700 font-bold"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* STATS */}

        <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-sm text-slate-500">
              Active Incidents
            </p>

            <p className="text-2xl font-bold mt-1">
              {stats.active}
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-sm text-slate-500">
              Critical
            </p>

            <p className="text-2xl font-bold mt-1 text-red-600">
              {stats.critical}
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-sm text-slate-500">
              Escalated
            </p>

            <p className="text-2xl font-bold mt-1 text-orange-600">
              {stats.escalated}
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-sm text-slate-500">
              Available Responders
            </p>

            <p className="text-2xl font-bold mt-1 text-green-600">
              {stats.availableResponders}
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-sm text-slate-500">
              Busy Responders
            </p>

            <p className="text-2xl font-bold mt-1 text-yellow-600">
              {stats.busyResponders}
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-sm text-slate-500">
              Resolved
            </p>

            <p className="text-2xl font-bold mt-1 text-green-600">
              {stats.resolved}
            </p>
          </div>
        </section>

        {/* MAP */}

        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">
                Live Incident Map
              </h2>

              <p className="text-sm text-slate-500">
                Real-time incident locations
              </p>
            </div>

            <div className="text-xs text-slate-500">
              Updated {timeSince(new Date(now))}
            </div>
          </div>

          <div
            ref={mapRef}
            className="h-[380px] w-full"
          />
        </section>

        {/* INCIDENTS */}

        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-slate-200">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <h2 className="font-semibold">
                  Incidents
                </h2>

                <p className="text-sm text-slate-500">
                  {filteredIncidents.length} of{" "}
                  {incidents.length} incidents
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={search}
                  onChange={(e) =>
                    setSearch(e.target.value)
                  }
                  placeholder="Search incidents..."
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-300"
                />

                <select
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value)
                  }
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="all">
                    All statuses
                  </option>

                  {STATUS_OPTIONS.map((status) => (
                    <option
                      key={status}
                      value={status}
                    >
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>

                <select
                  value={severityFilter}
                  onChange={(e) =>
                    setSeverityFilter(e.target.value)
                  }
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="all">
                    All severity
                  </option>

                  <option value="critical">
                    Critical
                  </option>

                  <option value="high">
                    High
                  </option>

                  <option value="medium">
                    Medium
                  </option>

                  <option value="low">
                    Low
                  </option>
                </select>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="p-10 text-center text-slate-500">
              Loading incidents...
            </div>
          ) : filteredIncidents.length === 0 ? (
            <div className="p-10 text-center text-slate-500">
              No incidents found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-5 py-3 font-medium text-slate-500">
                      Type
                    </th>

                    <th className="text-left px-5 py-3 font-medium text-slate-500">
                      Severity
                    </th>

                    <th className="text-left px-5 py-3 font-medium text-slate-500">
                      Status
                    </th>

                    <th className="text-left px-5 py-3 font-medium text-slate-500">
                      Responder
                    </th>

                    <th className="text-left px-5 py-3 font-medium text-slate-500">
                      Reported
                    </th>

                    <th className="text-right px-5 py-3 font-medium text-slate-500">
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {filteredIncidents.map((incident) => {
                    const responder = responders.find(
                      (r) =>
                        String(r.id) ===
                        String(
                          incident.assigned_responder_id
                        )
                    );

                    return (
                      <tr
                        key={incident.id}
                        className="border-b border-slate-100 hover:bg-slate-50"
                      >
                        <td className="px-5 py-4">
                          <div className="font-medium">
                            {incident.type || "Other"}
                          </div>

                          <div className="text-xs text-slate-400 max-w-[250px] truncate">
                            {incident.description ||
                              "No description"}
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium ${severityColor(
                              incident.severity
                            )}`}
                          >
                            {incident.severity ||
                              "Unknown"}
                          </span>
                        </td>

                        <td className="px-5 py-4">
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium ${
                              STATUS_COLORS[
                                incident.status
                              ] ||
                              "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {STATUS_LABELS[
                              incident.status
                            ] ||
                              incident.status ||
                              "Unknown"}
                          </span>
                        </td>

                        <td className="px-5 py-4">
                          {responder?.name || (
                            <span className="text-slate-400">
                              Unassigned
                            </span>
                          )}
                        </td>

                        <td className="px-5 py-4 text-slate-500">
                          {timeSince(
                            incident.created_at
                          )}
                        </td>

                        <td className="px-5 py-4 text-right">
                          <button
                            onClick={() =>
                              setSelectedIncidentId(
                                incident.id
                              )
                            }
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
          )}
        </section>

        {/* SELECTED INCIDENT */}

        {selectedIncident && (
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">
                  Incident Details
                </h2>

                <p className="text-sm text-slate-500">
                  Incident #{selectedIncident.id}
                </p>
              </div>

              <button
                onClick={() =>
                  setSelectedIncidentId(null)
                }
                className="text-slate-400 hover:text-slate-700 text-xl"
              >
                ×
              </button>
            </div>

            <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* DETAILS */}

              <div>
                <h3 className="font-medium mb-3">
                  Details
                </h3>

                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-slate-400">
                      Type
                    </p>

                    <p className="font-medium">
                      {selectedIncident.type ||
                        "Other"}
                    </p>
                  </div>

                  <div>
                    <p className="text-slate-400">
                      Description
                    </p>

                    <p>
                      {selectedIncident.description ||
                        "No description provided."}
                    </p>
                  </div>

                  <div>
                    <p className="text-slate-400">
                      Severity
                    </p>

                    <span
                      className={`inline-block mt-1 px-2 py-1 rounded-full text-xs font-medium ${severityColor(
                        selectedIncident.severity
                      )}`}
                    >
                      {selectedIncident.severity ||
                        "Unknown"}
                    </span>
                  </div>

                  <div>
                    <p className="text-slate-400">
                      Reported
                    </p>

                    <p>
                      {formatDate(
                        selectedIncident.created_at
                      )}
                    </p>
                  </div>

                  <div>
                    <p className="text-slate-400">
                      Response Time
                    </p>

                    <p>
                      {responseTime(
                        selectedIncident.created_at,
                        selectedIncident.arrived_at
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* STATUS + ASSIGNMENT */}

              <div>
                <h3 className="font-medium mb-3">
                  Manage Incident
                </h3>

                <p className="text-xs text-slate-500 mb-2">
                  Update status
                </p>

                <div className="flex flex-wrap gap-2">
                  {STATUS_OPTIONS.map((status) => (
                    <button
                      key={status}
                      onClick={() =>
                        updateIncidentStatus(status)
                      }
                      disabled={
                        updatingIncident ||
                        selectedIncident.status ===
                          status
                      }
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                        selectedIncident.status ===
                        status
                          ? "bg-slate-700 text-white cursor-default"
                          : status === "resolved"
                          ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                          : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                      } disabled:opacity-50`}
                    >
                      {status === "resolved"
                        ? "✓ Resolve"
                        : STATUS_LABELS[status]}
                    </button>
                  ))}
                </div>

                <div className="mt-6">
                  <label className="text-xs text-slate-500 block mb-2">
                    Assign responder
                  </label>

                  <select
                    value={
                      selectedIncident.assigned_responder_id ||
                      ""
                    }
                    onChange={(e) =>
                      assignResponder(
                        e.target.value
                      )
                    }
                    disabled={assigningResponder}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                  >
                    <option value="">
                      Unassigned
                    </option>

                    {responders.map((responder) => (
                      <option
                        key={responder.id}
                        value={responder.id}
                      >
                        {responder.name}
                        {responder.status
                          ? ` — ${responder.status}`
                          : ""}
                      </option>
                    ))}
                  </select>

                  {assigningResponder && (
                    <p className="text-xs text-slate-400 mt-2">
                      Updating assignment...
                    </p>
                  )}
                </div>
              </div>

              {/* TIMELINE */}

              <div>
                <h3 className="font-medium mb-3">
                  Incident Timeline
                </h3>

                {selectedIncidentEvents.length ===
                0 ? (
                  <p className="text-sm text-slate-400">
                    No timeline events yet.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {selectedIncidentEvents.map(
                      (event, index) => (
                        <div
                          key={
                            event.id ||
                            `${event.created_at}-${index}`
                          }
                          className="flex gap-3"
                        >
                          <div className="flex flex-col items-center">
                            <div className="w-3 h-3 rounded-full bg-slate-700 mt-1" />

                            {index !==
                              selectedIncidentEvents.length -
                                1 && (
                              <div className="w-px bg-slate-200 flex-1 mt-1" />
                            )}
                          </div>

                          <div className="pb-3">
                            <p className="text-sm font-medium">
                              {STATUS_LABELS[
                                event.status
                              ] ||
                                event.status ||
                                "Updated"}
                            </p>

                            <p className="text-xs text-slate-400 mt-1">
                              {formatDate(
                                event.created_at
                              )}
                            </p>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ANALYTICS */}

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold">
                  Incident Types
                </h2>

                <p className="text-sm text-slate-500">
                  Current incident distribution
                </p>
              </div>
            </div>

            {incidentTypeData.length === 0 ? (
              <p className="text-sm text-slate-400">
                No incident data available.
              </p>
            ) : (
              <div className="space-y-3">
                {incidentTypeData.map(
                  ([type, count]) => {
                    const percentage =
                      incidents.length > 0
                        ? Math.round(
                            (count /
                              incidents.length) *
                              100
                          )
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
                            style={{
                              width: `${percentage}%`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  }
                )}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold">
                  Responder Availability
                </h2>

                <p className="text-sm text-slate-500">
                  Current responder status
                </p>
              </div>
            </div>

            {responders.length === 0 ? (
              <p className="text-sm text-slate-400">
                No responders found.
              </p>
            ) : (
              <div className="space-y-3">
                {responders.map((responder) => (
                  <div
                    key={responder.id}
                    className="flex items-center justify-between border-b border-slate-100 pb-3"
                  >
                    <div>
                      <p className="font-medium text-sm">
                        {responder.name}
                      </p>

                      <p className="text-xs text-slate-400">
                        {responder.type ||
                          "Responder"}
                      </p>
                    </div>

                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        String(
                          responder.status || ""
                        ).toLowerCase() ===
                        "available"
                          ? "bg-green-100 text-green-700"
                          : String(
                              responder.status || ""
                            ).toLowerCase() ===
                            "busy"
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {responder.status ||
                        "Unknown"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* REPORTS */}

        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="font-semibold">
                Reports
              </h2>

              <p className="text-sm text-slate-500">
                Export current incident data
              </p>
            </div>

            <button
              onClick={exportCSV}
              disabled={incidents.length === 0}
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
              <h2 className="font-semibold">
                Test Mode
              </h2>

              <p className="text-sm text-slate-500">
                Creates real test incidents in Supabase every 8 seconds.
              </p>
            </div>

            <button
              onClick={() =>
                setSimulationOn((value) => !value)
              }
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                simulationOn
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {simulationOn
                ? "Stop Test Mode"
                : "Start Test Mode"}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}