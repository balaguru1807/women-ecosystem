// backend/src/middleware.js
import { authAdmin } from "./firebaseAdmin.js";

/**
 * Express middleware to verify Firebase ID token
 * - Looks for "Authorization: Bearer <token>" header
 * - Verifies token using firebase-admin
 * - On success: attaches decoded token to req.user and calls next()
 * - On failure: returns 401
 */
export async function verifyFirebaseToken(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.substring(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: "Missing Authorization token" });
  }

  try {
    const decoded = await authAdmin.verifyIdToken(token);
    req.user = decoded; // uid, email, etc.
    next();
  } catch (err) {
    console.error("Token verify error:", err);
    return res.status(401).json({ error: "Invalid token" });
  }
}