import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/authcontext.jsx";

export default function AdminRoute({ children }) {
  const { firebaseUser, profile, loading } = useAuth();

  if (loading) return null;

  // not logged in => go admin login
  if (!firebaseUser) return <Navigate to="/admin" replace />;

  const role = (profile?.role || "").toLowerCase();
  if (role !== "admin") return <Navigate to="/admin" replace />;

  return children;
}