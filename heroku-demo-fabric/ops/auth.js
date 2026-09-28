/**
 * Server-side operator session auth for the Control Center. No secret is
 * ever shipped to the browser bundle -- the browser only ever sees a
 * signed, httpOnly session cookie (set up via `cookie-session` in
 * server.js) and posts a password once to /ops/auth/login.
 *
 * Two roles, per spec section 47 MVP minimum:
 *   viewer   -- can read /ops/* GET endpoints.
 *   operator -- can also call mutation endpoints (reset, scenario load,
 *               governance test).
 *
 * If OPS_OPERATOR_PASSWORD isn't set in the environment, operator login is
 * disabled outright (503) rather than falling back to any default/invented
 * credential.
 */

const express = require("express");
const router = express.Router();

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

router.get("/session", (req, res) => {
  res.json({ authenticated: !!req.session?.role, role: req.session?.role || null });
});

router.post("/login", express.json(), (req, res) => {
  const { password } = req.body || {};
  const operatorPassword = process.env.OPS_OPERATOR_PASSWORD;
  const viewerPassword = process.env.OPS_VIEWER_PASSWORD;

  if (!operatorPassword) {
    return res.status(503).json({
      error: "OPERATOR_AUTH_NOT_CONFIGURED",
      message: "OPS_OPERATOR_PASSWORD is not set on this dyno. Set it via `heroku config:set OPS_OPERATOR_PASSWORD=...` before the console can authenticate an operator.",
    });
  }
  if (typeof password === "string" && timingSafeEqual(password, operatorPassword)) {
    req.session.role = "operator";
    return res.json({ authenticated: true, role: "operator" });
  }
  if (viewerPassword && typeof password === "string" && timingSafeEqual(password, viewerPassword)) {
    req.session.role = "viewer";
    return res.json({ authenticated: true, role: "viewer" });
  }
  return res.status(401).json({ error: "INVALID_CREDENTIALS" });
});

router.post("/logout", (req, res) => {
  req.session = null;
  res.json({ authenticated: false });
});

function requireSession(req, res, next) {
  if (!req.session?.role) {
    return res.status(401).json({ error: "UNAUTHENTICATED", message: "Sign in to the Control Center." });
  }
  next();
}

function requireOperator(req, res, next) {
  if (req.session?.role !== "operator") {
    return res.status(403).json({ error: "OPERATOR_ROLE_REQUIRED", message: "This action requires the operator role, not read-only." });
  }
  // Minimal CSRF mitigation: mutation calls must be same-origin fetch()
  // carrying this header (a cross-site <form> POST can't set custom headers).
  if (req.get("X-Ops-Request") !== "1") {
    return res.status(403).json({ error: "MISSING_OPS_HEADER" });
  }
  next();
}

module.exports = { router, requireSession, requireOperator };
