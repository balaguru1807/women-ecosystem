import React, { useEffect, useMemo, useState } from "react";
import { signOut } from "firebase/auth";
import {
  auth,
  db,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "../firebase";
import { useAuth } from "../context/authcontext.jsx";

function TabBtn({ active, onClick, children }) {
  return (
    <button
      className={`btn btn-ghost ${active ? "btn-ghost-active" : ""}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

export default function AdminDashboard() {
  const { firebaseUser, profile } = useAuth();

  const [tab, setTab] = useState("overview");
  const [users, setUsers] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [reports, setReports] = useState([]);
  const [error, setError] = useState("");

  // USERS
  useEffect(() => {
    const q1 = query(collection(db, "users"));
    const unsub = onSnapshot(
      q1,
      (snap) => {
        setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => setError(err.message)
    );
    return () => unsub();
  }, []);

  // SOS ALERTS (global)
  useEffect(() => {
    const q2 = query(collection(db, "sos_alerts"), orderBy("time", "desc"));
    const unsub = onSnapshot(
      q2,
      (snap) => {
        setAlerts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => setError(err.message)
    );
    return () => unsub();
  }, []);

  // INCIDENT REPORTS (global)
  useEffect(() => {
    const q3 = query(collection(db, "incident_reports"), orderBy("timestamp", "desc"));
    const unsub = onSnapshot(
      q3,
      (snap) => {
        setReports(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => setError(err.message)
    );
    return () => unsub();
  }, []);

  if (!firebaseUser) return null;

  const handleLogout = async () => {
    await signOut(auth);
    window.location.href = "/auth";
  };

  const counts = useMemo(() => {
    const totalUsers = users.length;
    const admins = users.filter((u) => (u.role || "").toLowerCase() === "admin").length;
    const guardians = users.filter((u) => (u.role || "").toLowerCase() === "guardian").length;
    const students = users.filter((u) => (u.role || "").toLowerCase() === "user").length;

    const activeSOS = alerts.filter((a) => a.status !== "resolved").length;

    return { totalUsers, admins, guardians, students, activeSOS };
  }, [users, alerts]);

  const setUserRole = async (userId, role) => {
    try {
      setError("");
      await updateDoc(doc(db, "users", userId), { role });
    } catch (e) {
      setError(e.message || "Failed to update role");
    }
  };

  const resolveSOS = async (sosId) => {
    try {
      setError("");
      await updateDoc(doc(db, "sos_alerts", sosId), {
        status: "resolved",
        resolvedAt: new Date(),
      });
    } catch (e) {
      setError(e.message || "Failed to resolve SOS");
    }
  };

  const deleteIncident = async (reportId) => {
    try {
      setError("");
      await deleteDoc(doc(db, "incident_reports", reportId));
    } catch (e) {
      setError(e.message || "Failed to delete report");
    }
  };

  return (
    <div className="app-shell">
      <div className="glass-card-wide">
        <div className="stack-lg">
          <div className="section-title-row">
            <div>
              <h2 className="card-title">Admin Dashboard</h2>
              <p className="card-subtitle">
                Welcome, {profile?.name || firebaseUser.email}
              </p>
            </div>
            <button className="btn btn-ghost" onClick={handleLogout}>
              Logout
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            <TabBtn active={tab === "overview"} onClick={() => setTab("overview")}>
              Overview
            </TabBtn>
            <TabBtn active={tab === "users"} onClick={() => setTab("users")}>
              Users
            </TabBtn>
            <TabBtn active={tab === "sos"} onClick={() => setTab("sos")}>
              SOS Alerts
            </TabBtn>
            <TabBtn active={tab === "incidents"} onClick={() => setTab("incidents")}>
              Incident Reports
            </TabBtn>
          </div>

          {error && <div className="text-error">{error}</div>}

          {/* OVERVIEW */}
          {tab === "overview" && (
            <div className="panel">
              <h3 className="panel-title">System overview</h3>

              <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
                <span className="chip chip-accent">Total users: {counts.totalUsers}</span>
                <span className="chip chip-accent">Students: {counts.students}</span>
                <span className="chip chip-accent">Guardians: {counts.guardians}</span>
                <span className="chip chip-accent">Admins: {counts.admins}</span>
                <span className={`chip ${counts.activeSOS ? "chip-danger" : "chip-accent"}`}>
                  Active SOS: {counts.activeSOS}
                </span>
              </div>

              <p className="panel-text" style={{ marginTop: "0.8rem" }}>
                You can manage roles, monitor SOS and review incidents from the tabs.
              </p>
            </div>
          )}

          {/* USERS */}
          {tab === "users" && (
            <div className="panel">
              <h3 className="panel-title">Users & Roles</h3>

              {users.length === 0 ? (
                <p className="text-muted">No users found.</p>
              ) : (
                <div className="alert-list">
                  {users.map((u) => {
                    const role = (u.role || "user").toLowerCase();
                    return (
                      <div key={u.id} className="alert-card compact">
                        <div>
                          <strong>{u.name || u.email || u.id}</strong>
                          <div className="text-muted" style={{ fontSize: "0.8rem" }}>
                            {u.email || "-"}
                            <br />
                            Role: <span className="chip chip-accent">{role}</span>
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                          <button
                            className="btn btn-ghost"
                            type="button"
                            onClick={() => setUserRole(u.id, "user")}
                          >
                            Make User
                          </button>
                          <button
                            className="btn btn-ghost"
                            type="button"
                            onClick={() => setUserRole(u.id, "guardian")}
                          >
                            Make Guardian
                          </button>
                          <button
                            className="btn btn-ghost"
                            type="button"
                            onClick={() => setUserRole(u.id, "admin")}
                          >
                            Make Admin
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* SOS */}
          {tab === "sos" && (
            <div className="panel">
              <h3 className="panel-title">SOS Alerts</h3>

              {alerts.length === 0 ? (
                <p className="text-muted">No SOS alerts yet.</p>
              ) : (
                <div className="alert-list">
                  {alerts.map((a) => {
                    const createdAt =
                      a.time?.toDate?.().toLocaleString() ||
                      a.timestamp?.toDate?.().toLocaleString() ||
                      "-";

                    const loc = a.location;
                    const mapLink =
                      loc?.lat && loc?.lng
                        ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}`
                        : null;

                    return (
                      <div key={a.id} className="alert-card">
                        <div>
                          <strong>{a.userEmail || a.userId || "User"}</strong>
                          <div className="alert-meta">
                            Time: {createdAt}
                            <br />
                            Status:{" "}
                            <span className={`chip ${a.status === "resolved" ? "chip-accent" : "chip-danger"}`}>
                              {a.status || "open"}
                            </span>
                            {a.note ? (
                              <>
                                <br />
                                Note: {a.note}
                              </>
                            ) : null}
                          </div>

                          {a.audioBase64 ? (
                            <div style={{ marginTop: "0.6rem" }}>
                              <div className="text-muted" style={{ marginBottom: "0.25rem" }}>
                                Audio evidence:
                              </div>
                              <audio controls style={{ width: "100%" }} src={a.audioBase64} />
                            </div>
                          ) : null}
                        </div>

                        <div className="alert-actions">
                          {mapLink ? (
                            <a className="link" href={mapLink} target="_blank" rel="noreferrer">
                              Open location
                            </a>
                          ) : (
                            <span className="text-muted">No location</span>
                          )}

                          <button
                            className="btn btn-ghost"
                            type="button"
                            disabled={a.status === "resolved"}
                            onClick={() => resolveSOS(a.id)}
                          >
                            {a.status === "resolved" ? "Resolved" : "Mark resolved"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* INCIDENTS */}
          {tab === "incidents" && (
            <div className="panel">
              <h3 className="panel-title">Incident Reports</h3>

              {reports.length === 0 ? (
                <p className="text-muted">No incident reports yet.</p>
              ) : (
                <div className="alert-list">
                  {reports.map((r) => {
                    const createdAt =
                      r.timestamp?.toDate?.().toLocaleString() ||
                      r.time?.toDate?.().toLocaleString() ||
                      "-";

                    return (
                      <div key={r.id} className="alert-card">
                        <div>
                          <strong>{r.userName || r.userEmail || "User"}</strong>
                          <div className="alert-meta">
                            Time: {createdAt}
                            <br />
                            Location: {r.location || "-"}
                            <br />
                            Guardian: {r.guardianEmail || "-"}
                            <br />
                            Status: <span className="chip chip-accent">{r.status || "reported"}</span>
                          </div>
                          <div style={{ marginTop: "0.5rem" }}>{r.description}</div>
                        </div>

                        <div className="alert-actions">
                          <button className="btn btn-ghost" type="button" onClick={() => deleteIncident(r.id)}>
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right column small guide */}
        <div className="stack" style={{ fontSize: "0.84rem" }}>
          <div
            style={{
              padding: "1rem 1.1rem",
              borderRadius: "1.1rem",
              background: "rgba(15,23,42,0.96)",
              border: "1px solid rgba(55,65,81,0.9)",
            }}
          >
            <p style={{ marginTop: 0, fontWeight: 600, marginBottom: "0.35rem" }}>
              Admin actions
            </p>
            <ul style={{ paddingLeft: "1.1rem", margin: 0, display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              <li>Assign user roles carefully.</li>
              <li>Resolve SOS after confirmation.</li>
              <li>Review incident reports and take action.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}