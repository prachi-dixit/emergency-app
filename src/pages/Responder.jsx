import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Responder() {
  const [responders, setResponders] = useState([]);
  const [selectedResponder, setSelectedResponder] = useState("");
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Load responders and incidents
  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError("");

    const [respondersResult, incidentsResult] = await Promise.all([
      supabase
        .from("responders")
        .select("id, name, type, status, lat, lng")
        .order("name"),

      supabase
        .from("incidents")
        .select(
          "id, type, description, severity, lat, lng, status, notified_responder, assigned_to, escalated, notified_at, created_at"
        )
        .order("created_at", { ascending: false }),
    ]);

    if (respondersResult.error) {
      setError(respondersResult.error.message);
    }

    if (incidentsResult.error) {
      setError(incidentsResult.error.message);
    }

    setResponders(respondersResult.data || []);
    setIncidents(incidentsResult.data || []);
    setLoading(false);
  }

  async function acceptIncident(incidentId) {
    if (!selectedResponder) {
      setError("Please choose who you are first.");
      return;
    }

    setError("");
    setMessage("");

    const { error: rpcError } = await supabase.rpc("accept_incident", {
      p_incident: incidentId,
      p_responder: selectedResponder,
    });

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setMessage("Emergency accepted.");

    await loadData();
  }

  async function updateIncidentStatus(incidentId, status) {
    setError("");
    setMessage("");

    const { error: rpcError } = await supabase.rpc("update_status", {
      p_incident: incidentId,
      p_status: status,
    });

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setMessage(`Emergency marked as ${status}.`);

    await loadData();
  }

  function getResponderName(responderId) {
    const responder = responders.find(
      (item) => item.id === responderId
    );

    return responder ? responder.name : "Unknown responder";
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        <h1 className="text-3xl font-bold">Responder</h1>
        <p className="mt-4">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Responder</h1>
          <p className="mt-1 text-gray-600">
            View emergencies and respond to them.
          </p>
        </div>

        {/* Who am I? */}
        <div className="mb-6 rounded-lg bg-white p-5 shadow">
          <label className="mb-2 block font-semibold">
            Who am I?
          </label>

          <select
            value={selectedResponder}
            onChange={(event) =>
              setSelectedResponder(event.target.value)
            }
            className="w-full rounded border border-gray-300 p-3"
          >
            <option value="">Select responder</option>

            {responders.map((responder) => (
              <option key={responder.id} value={responder.id}>
                {responder.name} ({responder.type})
              </option>
            ))}
          </select>
        </div>

        {/* Messages */}
        {message && (
          <div className="mb-4 rounded bg-green-100 p-3 text-green-800">
            {message}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded bg-red-100 p-3 text-red-800">
            {error}
          </div>
        )}

        {/* Emergencies */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-semibold">
            Emergencies
          </h2>

          <button
            onClick={loadData}
            className="rounded bg-gray-700 px-4 py-2 text-white hover:bg-gray-800"
          >
            Refresh
          </button>
        </div>

        {incidents.length === 0 ? (
          <div className="rounded-lg bg-white p-6 shadow">
            <p>No emergencies found.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {incidents.map((incident) => (
              <div
                key={incident.id}
                className="rounded-lg bg-white p-5 shadow"
              >
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-semibold">
                      {incident.type}
                    </h3>

                    <span className="rounded bg-gray-200 px-3 py-1 text-sm">
                      {incident.status}
                    </span>
                  </div>

                  <p>
                    <strong>Description:</strong>{" "}
                    {incident.description || "No description"}
                  </p>

                  <p>
                    <strong>Severity:</strong>{" "}
                    {incident.severity}
                  </p>

                  <p>
                    <strong>Location:</strong>{" "}
                    {incident.lat}, {incident.lng}
                  </p>

                  {incident.assigned_to && (
                    <p>
                      <strong>Assigned responder:</strong>{" "}
                      {getResponderName(incident.assigned_to)}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2 pt-2">
                    {!incident.assigned_to &&
                      incident.status !== "resolved" && (
                        <button
                          onClick={() =>
                            acceptIncident(incident.id)
                          }
                          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                        >
                          Accept
                        </button>
                      )}

                    {incident.assigned_to ===
                      selectedResponder &&
                      incident.status !== "resolved" &&
                      incident.status !== "arrived" && (
                        <button
                          onClick={() =>
                            updateIncidentStatus(
                              incident.id,
                              "arrived"
                            )
                          }
                          className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700"
                        >
                          I have arrived
                        </button>
                      )}

                    {incident.assigned_to ===
                      selectedResponder &&
                      incident.status === "arrived" && (
                        <button
                          onClick={() =>
                            updateIncidentStatus(
                              incident.id,
                              "resolved"
                            )
                          }
                          className="rounded bg-purple-600 px-4 py-2 text-white hover:bg-purple-700"
                        >
                          Resolved
                        </button>
                      )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}