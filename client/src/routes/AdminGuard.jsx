import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { auth, db, doc, getDoc } from "../firebase";

export default function AdminGuard({ children }) {
  const [ok, setOk] = useState(null);

  useEffect(() => {
    const run = async () => {
      const user = auth.currentUser;
      if (!user) return setOk(false);

      const snap = await getDoc(doc(db, "users", user.uid));
      setOk(snap.exists() && snap.data()?.role === "admin");
    };
    run();
  }, []);

  if (ok === null) return null;
  if (!ok) return <Navigate to="/admin" replace />;
  return children;
}