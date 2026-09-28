/**
 * Server-side health aggregator. The browser never calls interface backends
 * directly (spec section 43) -- it calls /ops/status or /ops/interfaces and
 * this module has already done the work.
 *
 * Status vocabulary (exactly 5, spec section 9):
 *   READY | DEGRADED | OPTIONAL_DOWN | UNVERIFIED | BLOCKING
 *
 * A "http" interface whose configured URL is localhost/private is reported
 * UNVERIFIED, not probed-and-failed -- a Heroku dyno has no network path to
 * an operator's laptop, so a connection attempt there isn't evidence of
 * anything being broken.
 */

const { INTERFACES, isLocalOnly } = require("./registry");

const cache = new Map(); // id -> { lastCheck, lastSuccess, lastFailure, lastResult }

function record(id, result) {
  const prev = cache.get(id) || {};
  const now = new Date().toISOString();
  const entry = {
    lastCheck: now,
    lastSuccess: result.ok ? now : prev.lastSuccess || null,
    lastFailure: !result.ok && result.attempted ? now : prev.lastFailure || null,
    lastResult: result,
  };
  cache.set(id, entry);
  return entry;
}

async function probeHttp(iface) {
  const url = iface.url ? `${iface.url}${iface.healthPath || ""}` : "";
  if (!iface.url || isLocalOnly(iface.url)) {
    return {
      ok: false,
      attempted: false,
      status:
        iface.criticality === "OPTIONAL" ? "OPTIONAL_DOWN" : "UNVERIFIED",
      httpStatus: null,
      latencyMs: null,
      reason: !iface.url
        ? "No endpoint configured for this Heroku dyno."
        : "Endpoint is local-only (localhost/private host) -- a Heroku dyno cannot reach an operator laptop. Configure a public tunnel/CloudHub URL to enable a live check.",
    };
  }
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      return { ok: true, attempted: true, status: "READY", httpStatus: res.status, latencyMs, reason: null };
    }
    return {
      ok: false,
      attempted: true,
      status: iface.criticality === "CORE" ? "BLOCKING" : "DEGRADED",
      httpStatus: res.status,
      latencyMs,
      reason: `Endpoint responded HTTP ${res.status}.`,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return {
      ok: false,
      attempted: true,
      status:
        iface.criticality === "CORE"
          ? "BLOCKING"
          : iface.criticality === "OPTIONAL"
          ? "OPTIONAL_DOWN"
          : "DEGRADED",
      httpStatus: null,
      latencyMs,
      reason: `Request failed: ${err.message}`,
    };
  }
}

function probeSelf(iface, fabricState) {
  const domain = fabricState[iface.selfDomain];
  const count =
    iface.selfDomain === "sap"
      ? domain.records.length
      : iface.selfDomain === "contracts"
      ? domain.obligations.length
      : iface.selfDomain === "costpoint"
      ? domain.orders.size
      : domain.byEquipment.size;
  if (iface.sapSpecial) {
    return {
      ok: true,
      attempted: true,
      status: "DEGRADED",
      httpStatus: 200,
      latencyMs: 0,
      reason:
        "Heroku SAP demo adapter is healthy (in-process). Real JCo/RFC path is UNAVAILABLE -- local JCo dependency blocked by SAP licensing (see docs/CURRENT-STATE.md). Current mode: HEROKU_DEMO.",
    };
  }
  return { ok: count > 0, attempted: true, status: count > 0 ? "READY" : "BLOCKING", httpStatus: 200, latencyMs: 0, reason: null };
}

function probeNone(iface) {
  return {
    ok: false,
    attempted: false,
    status: "UNVERIFIED",
    httpStatus: null,
    latencyMs: null,
    reason: "No HTTP health surface on this component from this console (AgentScript broker / A2A endpoint) -- status is config-derived only, not runtime-probed.",
  };
}

async function checkInterface(iface, fabricState) {
  let result;
  if (iface.mode === "self") result = probeSelf(iface, fabricState);
  else if (iface.mode === "none") result = probeNone(iface);
  else result = await probeHttp(iface);

  const entry = record(iface.id, result);
  return {
    id: iface.id,
    name: iface.name,
    group: iface.group,
    type: iface.type,
    criticality: iface.criticality,
    status: result.status,
    httpStatus: result.httpStatus,
    latencyMs: result.latencyMs,
    lastCheck: entry.lastCheck,
    lastSuccess: entry.lastSuccess,
    lastFailure: entry.lastFailure,
    reason: result.reason,
    upstream: iface.upstream,
    downstream: iface.downstream,
    url: iface.url ? redact(iface.url) : null,
  };
}

function redact(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}${u.port ? ":" + u.port : ""}${u.pathname}`;
  } catch {
    return null;
  }
}

async function checkAllInterfaces(fabricState) {
  return Promise.all(INTERFACES.map((iface) => checkInterface(iface, fabricState)));
}

function coreReadiness(results) {
  const core = results.filter((r) => r.criticality === "CORE");
  if (core.some((r) => r.status === "BLOCKING")) return "BLOCKING";
  if (core.some((r) => r.status === "DEGRADED")) return "DEGRADED";
  if (core.some((r) => r.status === "UNVERIFIED")) return "UNVERIFIED";
  return "READY";
}

function scenarioReadiness(results) {
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));
  return {
    contract: byId["contract-demo"]?.status === "READY" ? "READY" : byId["contract-demo"]?.status || "UNVERIFIED",
    engineering: byId["engineering-demo"]?.status === "READY" ? "READY" : byId["engineering-demo"]?.status || "UNVERIFIED",
    sap: byId["sap-demo"]?.status || "UNVERIFIED", // always DEGRADED -- see probeSelf sapSpecial
    agent: byId["agent-broker"]?.status || "UNVERIFIED",
  };
}

module.exports = { checkAllInterfaces, checkInterface, coreReadiness, scenarioReadiness, cache };
