// client/src/pages/AdminAuthPage.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth, db, doc, getDoc } from "../firebase";

export default function AdminAuthPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("admin@gmail.com");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);

      // ✅ check role in Firestore
      const snap = await getDoc(doc(db, "users", cred.user.uid));
      const role = snap.exists() ? snap.data()?.role : null;

      if (role !== "admin") {
        setErr("This account is not an admin.");
        await auth.signOut();
        setLoading(false);
        return;
      }

      navigate("/admin/dashboard");
    } catch (error) {
      console.error(error);
      setErr("Admin login failed. Check email/password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <div className="glass-card" style={{ maxWidth: 520, margin: "0 auto" }}>
        <h2 className="card-title">Admin Login</h2>
        <p className="card-subtitle">Only admin accounts can access the admin panel.</p>

        <form onSubmit={handleLogin} className="stack" style={{ marginTop: "1rem" }}>
          {err && <div className="text-error">{err}</div>}

          <div className="field">
            <span className="field-label">Admin Email</span>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div className="field">
            <span className="field-label">Password</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? "Logging in..." : "Login as Admin"}
          </button>

          <p className="text-muted" style={{ fontSize: "0.8rem" }}>
            Note: Create this admin in Firebase Auth once, then set role="admin" in Firestore users/{`{uid}`}.
          </p>
        </form>
      </div>
    </div>
  );
}