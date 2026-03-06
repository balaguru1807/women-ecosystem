// client/src/pages/AuthPage.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  auth,
  db,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "../firebase";

// Small stickman + text block
function StickmanHero({ activeRole, mode }) {
  const [animateIn, setAnimateIn] = useState(false);

  useEffect(() => setAnimateIn(true), []);

  const isUser = activeRole === "user";
  const isLogin = mode === "login";

  const subtitle = isUser
    ? isLogin
      ? "Welcome back, student. Stay safe on campus."
      : "Create your student safety account."
    : isLogin
    ? "Guardian login to monitor SOS alerts."
    : "Register as a guardian to receive alerts.";

  return (
    <div className="auth-stickman-wrapper">
      <div className={`stickman-animation ${animateIn ? "stickman-in" : ""}`}>
        <svg className="stickman-svg" viewBox="0 0 100 150" aria-hidden="true">
          <circle cx="50" cy="40" r="18" className="stickman-head" />
          <line x1="50" y1="58" x2="50" y2="100" className="stickman-line stickman-body" />
          <line x1="50" y1="70" x2="28" y2="85" className="stickman-line stickman-arm-left" />
          <line x1="50" y1="70" x2="72" y2="85" className="stickman-line stickman-arm-right" />
          <line x1="50" y1="100" x2="35" y2="130" className="stickman-line stickman-leg-left" />
          <line x1="50" y1="100" x2="65" y2="130" className="stickman-line stickman-leg-right" />
        </svg>
      </div>
      <p className="stickman-subtitle">{subtitle}</p>
    </div>
  );
}

// ✅ Ensures users/{uid} exists and role is correct (this fixes your redirect issue)
async function ensureUserProfile({ user, role, name }) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  const base = {
    email: (user.email || "").toLowerCase(),
    name: name || user.email || "User",
    role, // ✅ "user" or "guardian"
    updatedAt: serverTimestamp(),
  };

  if (!snap.exists()) {
    // create fresh profile
    await setDoc(ref, {
      ...base,
      createdAt: serverTimestamp(),

      // user-only default fields (safe to keep even for guardian)
      guardianEmail: "",
      guardianPhone: "",
      guardianEmails: [], // ✅ multi-guardian list
      extraContacts: [],
      extraPhones: [],
      currentLocation: null,
      lastUpdated: null,
      riskLevel: "NORMAL",
      riskScore: 0,
    });
    return;
  }

  // update if missing or wrong role
  const data = snap.data();
  if (!data?.role || data.role !== role) {
    await setDoc(ref, base, { merge: true });
  } else {
    // keep it up to date anyway
    await setDoc(ref, { updatedAt: serverTimestamp() }, { merge: true });
  }
}

// ✅ Create guardians/{uid} document (optional, but keeps your guardian dashboard structure)
async function ensureGuardianDoc({ user, name }) {
  const ref = doc(db, "guardians", user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      name: name || user.email || "Guardian",
      email: (user.email || "").toLowerCase(),
      role: "guardian",
      watching: [],
      createdAt: serverTimestamp(),
    });
  }
}

export default function AuthPage() {
  const [activeRole, setActiveRole] = useState("user"); // "user" | "guardian"
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const navigate = useNavigate();

  const isUser = activeRole === "user";
  const isLogin = mode === "login";

  const title = isUser
    ? isLogin
      ? "Student Login"
      : "Student Registration"
    : isLogin
    ? "Guardian Login"
    : "Guardian Registration";

  const subtitle = isUser
    ? "Smart Campus Safety Ecosystem • Secure access for students."
    : "Smart Campus Safety Ecosystem • Stay connected to your ward’s safety.";

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();

    try {
      let cred;

      if (isLogin) {
        // ✅ LOGIN
        cred = await signInWithEmailAndPassword(auth, cleanEmail, password);

        // ✅ ensure users/{uid} exists for BOTH roles
        await ensureUserProfile({
          user: cred.user,
          role: isUser ? "user" : "guardian",
          name: cleanName,
        });

        // ✅ if guardian login, also ensure guardians/{uid}
        if (!isUser) {
          await ensureGuardianDoc({ user: cred.user, name: cleanName });
        }
      } else {
        // ✅ REGISTER
        cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);

        // ✅ create users/{uid} for BOTH roles
        await ensureUserProfile({
          user: cred.user,
          role: isUser ? "user" : "guardian",
          name: cleanName || cleanEmail,
        });

        // ✅ if guardian register, also create guardians/{uid}
        if (!isUser) {
          await ensureGuardianDoc({ user: cred.user, name: cleanName || cleanEmail });
        }
      }

      // ✅ redirect after success
      navigate(isUser ? "/user" : "/guardian", { replace: true });
    } catch (err) {
      console.error("AUTH ERROR:", err?.code, err?.message);

      let msg = "Authentication error. Please try again.";
      if (err?.code === "auth/email-already-in-use") msg = "Email already in use.";
      if (err?.code === "auth/invalid-credential") msg = "Invalid email or password.";
      if (err?.code === "auth/user-not-found") msg = "No account with this email.";
      if (err?.code === "auth/wrong-password") msg = "Wrong password.";
      if (err?.code === "auth/weak-password")
        msg = "Password should be at least 6 characters.";

      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-root auth-page-root">
      <div className="auth-card auth-card-split">
        {/* LEFT */}
        <div className="auth-left">
          <StickmanHero activeRole={activeRole} mode={mode} />
        </div>

        {/* RIGHT */}
        <div className="auth-right">
          {/* Role toggle */}
          <div className="auth-toggle-row">
            <button
              type="button"
              className={`pill ${isUser ? "pill-active" : ""}`}
              onClick={() => {
                setActiveRole("user");
                setError("");
              }}
            >
              User
            </button>
            <button
              type="button"
              className={`pill ${!isUser ? "pill-active" : ""}`}
              onClick={() => {
                setActiveRole("guardian");
                setError("");
              }}
            >
              Guardian
            </button>
          </div>

          {/* Mode toggle */}
          <div className="auth-toggle-row">
            <button
              type="button"
              className={`pill ${isLogin ? "pill-active" : ""}`}
              onClick={() => {
                setMode("login");
                setError("");
              }}
            >
              Login
            </button>
            <button
              type="button"
              className={`pill ${!isLogin ? "pill-active" : ""}`}
              onClick={() => {
                setMode("register");
                setError("");
              }}
            >
              Register
            </button>
          </div>

          <h2 className="auth-title">{title}</h2>
          <p className="auth-subtitle">{subtitle}</p>

          <form className="auth-form" onSubmit={handleSubmit}>
            {!isLogin && (
              <div className="field">
                <label className="field-label">Name</label>
                <input
                  className="field-input"
                  type="text"
                  placeholder="Enter your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            )}

            <div className="field">
              <label className="field-label">Email</label>
              <input
                className="field-input"
                type="email"
                placeholder="name@example.com"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label className="field-label">Password</label>
              <input
                className="field-input"
                type="password"
                placeholder="Enter password"
                autoComplete={isLogin ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && <p className="auth-error">{error}</p>}

            <button className="auth-button" type="submit" disabled={loading}>
              {loading
                ? "Please wait..."
                : isUser
                ? isLogin
                  ? "Login as student"
                  : "Register as student"
                : isLogin
                ? "Login as guardian"
                : "Register as guardian"}
            </button>
          </form>

          <p className="auth-tip">
            Tip: Register parent account as <strong>Guardian</strong> using their
            email, then link it from the <strong>Student</strong> dashboard.
          </p>
        </div>
      </div>
    </div>
  );
} 