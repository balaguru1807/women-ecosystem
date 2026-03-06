import React, { useEffect, useMemo, useState } from "react";
import { signOut } from "firebase/auth";
import {
  auth,
  db,
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
} from "../firebase";
import { useAuth } from "../context/authcontext.jsx";
import { useNavigate } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000"||"https://women-ecosystem-backend.onrender.com";

export default function GuardianDashboard() {
  const { firebaseUser, profile } = useAuth();

  const [alerts, setAlerts] = useState([]);
  const [reports, setReports] = useState([]);
  const [students, setStudents] = useState([]);
  const [checkins, setCheckins] = useState([]);

  const [error, setError] = useState("");
  const [resolvingId, setResolvingId] = useState("");

  const guardianEmail = useMemo(() => {
    return (firebaseUser?.email || "").trim().toLowerCase();
  }, [firebaseUser?.email]);

  // ---------------- SOS ALERTS ----------------
  useEffect(() => {
    if (!guardianEmail) return;

    const q1 = query(
      collection(db, "sos_alerts"),
      where("guardianEmail", "==", guardianEmail),
      orderBy("time", "desc")
    );

    const unsub = onSnapshot(
      q1,
      (snap) => {
        const items = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        setAlerts(items);
      },
      (err) => {
        console.error("sos_alerts subscribe error:", err);
        setError("Failed to load SOS alerts.");
      }
    );

    return () => unsub();
  }, [guardianEmail]);

  // ---------------- INCIDENT REPORTS ----------------
  useEffect(() => {
    if (!guardianEmail) return;

    const q2 = query(
      collection(db, "incident_reports"),
      where("guardianEmail", "==", guardianEmail)
    );

    const unsub = onSnapshot(
      q2,
      (snap) => {
        const items = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        setReports(items);
      },
      (err) => {
        console.error("incident_reports subscribe error:", err);
      }
    );

    return () => unsub();
  }, [guardianEmail]);

  // ---------------- CHECKINS ----------------
  // IMPORTANT:
  // This version reads ONLY single-field guardianEmail
  // to avoid the permission error from guardianEmails array query.
  useEffect(() => {
    if (!guardianEmail) return;

    const q3 = query(
      collection(db, "checkins"),
      where("guardianEmail", "==", guardianEmail),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      q3,
      (snap) => {
        const items = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        setCheckins(items);
      },
      (err) => {
        console.error("checkins subscribe error:", err);
      }
    );

    return () => unsub();
  }, [guardianEmail]);

  // ---------------- STUDENTS ----------------
  // This version uses ONLY guardianEmail single field
  // to avoid the users(multi) permission issue.
  useEffect(() => {
    if (!guardianEmail) return;

    const q4 = query(
      collection(db, "users"),
      where("guardianEmail", "==", guardianEmail)
    );

    const unsub = onSnapshot(
      q4,
      (snap) => {
        const items = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        setStudents(items);
      },
      (err) => {
        console.error("students subscribe error:", err);
      }
    );

    return () => unsub();
  }, [guardianEmail]);

  if (!firebaseUser) return null;

 // inside component
const navigate = useNavigate();

const handleLogout = async () => {
  await signOut(auth);
  navigate("/auth");
};

  const handleResolve = async (sosId) => {
    setError("");
    setResolvingId(sosId);

    try {
      const token = await firebaseUser.getIdToken();

      const res = await fetch(`${API_BASE}/api/resolve-sos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ sosId }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Failed to resolve alert.");
      }
    } catch (err) {
      console.error("resolve error:", err);
      setError("Failed to contact server.");
    } finally {
      setResolvingId("");
    }
  };

  const activeAlerts = alerts.filter((a) => a.status !== "resolved");
  const missedCheckins = checkins.filter((c) => c.status === "missed");

  return (
    <div className="app-shell">
      <div className="glass-card-wide">
        <div className="stack-lg">
          <div className="section-title-row">
            <div>
              <h2 className="card-title">
                Guardian console, {profile?.name || firebaseUser.email}
              </h2>
              <p className="card-subtitle">
                Monitor SOS alerts, safety check-ins, and incident reports in
                real-time.
              </p>
            </div>

            <button className="btn btn-ghost" onClick={handleLogout}>
              Logout
            </button>
          </div>

          {/* Safety Check-ins */}
          <div className="stack">
            <div className="section-title-row">
              <h3 style={{ fontSize: "0.95rem", margin: 0 }}>
                ✅ Safety Check-ins
              </h3>
              <span
                className={`chip ${
                  missedCheckins.length > 0 ? "chip-danger" : "chip-accent"
                }`}
              >
                {missedCheckins.length > 0
                  ? `${missedCheckins.length} missed`
                  : "All good"}
              </span>
            </div>

            {checkins.length === 0 ? (
              <p className="text-muted">No check-ins yet.</p>
            ) : (
              <div className="alert-list">
                {checkins.map((c) => {
                  const createdAt =
                    c.createdAt?.toDate?.().toLocaleString() || "-";
                  const dueAt = c.dueAt?.toDate?.().toLocaleString() || null;

                  const geoLink =
                    c.locationGeo?.lat && c.locationGeo?.lng
                      ? `https://www.google.com/maps?q=${c.locationGeo.lat},${c.locationGeo.lng}`
                      : null;

                  const chipClass =
                    c.status === "missed"
                      ? "chip chip-danger"
                      : c.status === "pending"
                      ? "chip chip-warning"
                      : "chip chip-accent";

                  return (
                    <div key={c.id} className="alert-card compact">
                      <div>
                        <strong>{c.userName || c.userEmail || c.userId}</strong>
                        <div className="alert-meta">
                          Time: {createdAt}
                          <br />
                          Status:{" "}
                          <span className={chipClass}>{c.status || "-"}</span>
                          <br />
                          Message: {c.message || "-"}
                          {dueAt ? (
                            <>
                              <br />
                              Due: {dueAt}
                            </>
                          ) : null}
                        </div>

                        {geoLink ? (
                          <a
                            className="link"
                            href={geoLink}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open GPS location
                          </a>
                        ) : (
                          <span className="text-muted">No location.</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* SOS Alerts */}
          <div className="stack">
            <div className="section-title-row">
              <h3 style={{ fontSize: "0.95rem", margin: 0 }}>
                Active SOS alerts
              </h3>
              <span
                className={`chip ${
                  activeAlerts.length > 0 ? "chip-danger" : "chip-accent"
                }`}
              >
                {activeAlerts.length > 0
                  ? `${activeAlerts.length} active`
                  : "No active alerts"}
              </span>
            </div>

            <div className="alert-list">
              {alerts.length === 0 && (
                <p className="text-muted">
                  No alerts yet. You&apos;ll see them here.
                </p>
              )}

              {alerts.map((alert) => {
                const createdAt =
                  alert.time?.toDate?.().toLocaleString() || "-";

                const loc = alert.location;
                const mapLink =
                  loc?.lat && loc?.lng
                    ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}`
                    : null;

                return (
                  <div key={alert.id} className="alert-card">
                    <div>
                      <div style={{ marginBottom: "0.2rem" }}>
                        <strong>{alert.userEmail || alert.userId}</strong>
                      </div>

                      <div className="alert-meta">
                        Time: {createdAt}
                        <br />
                        Status:{" "}
                        <span
                          className={
                            alert.status === "resolved"
                              ? "chip chip-accent"
                              : "chip chip-danger"
                          }
                        >
                          {alert.status || "open"}
                        </span>
                        {alert.note ? (
                          <>
                            <br />
                            Note: {alert.note}
                          </>
                        ) : null}
                      </div>

                      {alert.audioBase64 ? (
                        <div style={{ marginTop: "0.6rem" }}>
                          <div
                            className="text-muted"
                            style={{ marginBottom: "0.25rem" }}
                          >
                            Audio evidence:
                          </div>
                          <audio
                            controls
                            style={{ width: "100%" }}
                            src={alert.audioBase64}
                          />
                        </div>
                      ) : null}
                    </div>

                    <div className="alert-actions">
                      <div style={{ flex: 1 }}>
                        {mapLink ? (
                          <a
                            className="link"
                            href={mapLink}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open location
                          </a>
                        ) : (
                          <span className="text-muted">
                            No location shared.
                          </span>
                        )}
                      </div>

                      <button
                        className="btn btn-ghost"
                        type="button"
                        disabled={
                          alert.status === "resolved" ||
                          resolvingId === alert.id
                        }
                        onClick={() => handleResolve(alert.id)}
                      >
                        {alert.status === "resolved"
                          ? "Resolved"
                          : resolvingId === alert.id
                          ? "Resolving..."
                          : "Mark resolved"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Incident Reports */}
          <div className="stack" style={{ marginTop: "1.5rem" }}>
            <div className="section-title-row">
              <h3 style={{ fontSize: "0.95rem", margin: 0 }}>
                📄 Incident Reports
              </h3>
              <span
                className={`chip ${
                  reports.length > 0 ? "chip-warning" : "chip-accent"
                }`}
              >
                {reports.length > 0 ? `${reports.length} reports` : "No reports"}
              </span>
            </div>

            {reports.length === 0 ? (
              <p className="text-muted">No incident reports yet.</p>
            ) : (
              <div className="alert-list">
                {reports.map((r) => {
                  const t =
                    r.timestamp?.toDate?.().toLocaleString?.() || "-";

                  const geoLink =
                    r.locationGeo?.lat && r.locationGeo?.lng
                      ? `https://www.google.com/maps?q=${r.locationGeo.lat},${r.locationGeo.lng}`
                      : null;

                  return (
                    <div key={r.id} className="alert-card">
                      <div>
                        <strong>{r.userName || r.userEmail || r.userId}</strong>
                        <div
                          className="alert-meta"
                          style={{ marginTop: "0.25rem" }}
                        >
                          <b>Time:</b> {t}
                          <br />
                          {r.locationText ? (
                            <>
                              <b>Location:</b> {r.locationText}
                              <br />
                            </>
                          ) : null}
                          <b>Description:</b> {r.description}
                        </div>

                        {geoLink ? (
                          <a
                            className="link"
                            href={geoLink}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open GPS location
                          </a>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Students */}
          <div className="stack" style={{ marginTop: "1.5rem" }}>
            <div className="section-title-row">
              <h3 style={{ fontSize: "0.95rem", margin: 0 }}>
                Students you are watching
              </h3>
            </div>

            {students.length === 0 ? (
              <p className="text-muted">No students have linked you yet.</p>
            ) : (
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                {students.map((s) => {
                  const level = s.riskLevel || "NORMAL";
                  const score =
                    typeof s.riskScore === "number" ? s.riskScore : null;

                  const chipClass =
                    level === "ALERT"
                      ? "chip chip-danger"
                      : level === "CAUTION"
                      ? "chip chip-warning"
                      : "chip chip-accent";

                  const mapLink =
                    s.currentLocation?.lat && s.currentLocation?.lng
                      ? `https://www.google.com/maps?q=${s.currentLocation.lat},${s.currentLocation.lng}`
                      : null;

                  return (
                    <li
                      key={s.id}
                      style={{
                        padding: "0.6rem 0.8rem",
                        borderRadius: "0.9rem",
                        background: "rgba(15,23,42,0.96)",
                        border: "1px solid rgba(55,65,81,0.9)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "0.6rem",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 500 }}>
                          {s.name || s.email || s.id}
                        </div>
                        <div
                          className="text-muted"
                          style={{ fontSize: "0.8rem" }}
                        >
                          <span className={chipClass}>
                            Risk: {level}
                            {score !== null ? ` (score ${score})` : ""}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        {mapLink ? (
                          <button
                            className="btn btn-ghost"
                            type="button"
                            onClick={() => window.open(mapLink, "_blank")}
                          >
                            View location
                          </button>
                        ) : (
                          <span className="text-muted">Location unknown</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {error ? (
            <div className="text-error" style={{ marginTop: "1rem" }}>
              {error}
            </div>
          ) : null}
        </div>

        <div className="stack" style={{ fontSize: "0.84rem" }}>
          <div
            style={{
              padding: "1rem 1.1rem",
              borderRadius: "1.1rem",
              background: "rgba(15,23,42,0.96)",
              border: "1px solid rgba(55,65,81,0.9)",
            }}
          >
            <p
              style={{
                marginTop: 0,
                fontWeight: 600,
                marginBottom: "0.35rem",
              }}
            >
              When you receive an SOS / Missed check-in
            </p>
            <ul
              style={{
                paddingLeft: "1.1rem",
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: "0.3rem",
              }}
            >
              <li>Try contacting the student immediately by phone.</li>
              <li>
                If location is available, share with campus security quickly.
              </li>
              <li>
                After confirming safety, mark the alert as{" "}
                <strong>resolved</strong>.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}