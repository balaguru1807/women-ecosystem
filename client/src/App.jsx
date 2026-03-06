// client/src/App.jsx
import { Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";

import { useAuth } from "./context/authcontext.jsx";

import AuthPage from "./pages/AuthPage.jsx";
import UserDashboard from "./pages/UserDaashboard.jsx"; // keep this if your file name is really UserDaashboard.jsx
import GuardianDashboard from "./pages/GuardianDashboard.jsx";

// ✅ Admin pages (create these files if not created yet)
import AdminAuthPage from "./pages/AdminAuthPage.jsx";
import AdminDashboard from "./pages/AdminDashboard.jsx";

// ✅ Firebase (path must be ./firebase because App.jsx is inside src/)
import { auth, db, doc, getDoc } from "./firebase";

// ✅ ADMIN ROUTE GUARD
function AdminRoute({ children }) {
  const [ok, setOk] = useState(null);
  const { firebaseUser } = useAuth();

  useEffect(() => {
    const run = async () => {
      const user = firebaseUser || auth.currentUser;
      if (!user) return setOk(false);

      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const role = snap.exists() ? snap.data()?.role : null;
        setOk(role === "admin");
      } catch (e) {
        console.error("AdminRoute error:", e);
        setOk(false);
      }
    };

    run();
  }, [firebaseUser]);

  if (ok === null) return null;
  if (!ok) return <Navigate to="/admin" replace />;
  return children;
}

// ✅ USER/GUARDIAN PRIVATE ROUTE
function PrivateRoute({ children, role }) {
  const { firebaseUser, profile, loading } = useAuth();

  // if your authcontext has loading state
  if (loading) return null;

  if (!firebaseUser) return <Navigate to="/auth" replace />;

  // if role mismatch, redirect to correct dashboard
  if (role && profile?.role !== role) {
    if (profile?.role === "guardian") return <Navigate to="/guardian" replace />;
    if (profile?.role === "user") return <Navigate to="/user" replace />;
    if (profile?.role === "admin") return <Navigate to="/admin/dashboard" replace />;
    return <Navigate to="/auth" replace />;
  }

  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/auth" replace />} />
      <Route path="/auth" element={<AuthPage />} />

      <Route
        path="/user"
        element={
          <PrivateRoute role="user">
            <UserDashboard />
          </PrivateRoute>
        }
      />

      <Route
        path="/guardian"
        element={
          <PrivateRoute role="guardian">
            <GuardianDashboard />
          </PrivateRoute>
        }
      />

      {/* ✅ Admin login page */}
      <Route path="/admin" element={<AdminAuthPage />} />

      {/* ✅ Admin dashboard protected */}
      <Route
        path="/admin/dashboard"
        element={
          <AdminRoute>
            <AdminDashboard />
          </AdminRoute>
        }
      />

      <Route path="*" element={<Navigate to="/auth" replace />} />
    </Routes>
  );
}