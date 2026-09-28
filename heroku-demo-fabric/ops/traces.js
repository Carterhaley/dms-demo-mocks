/**
 * Trace aggregator (spec sections 36-37). Honest scope: this dyno can only
 * see hops that pass through it -- its own /api/sap, /api/contracts,
 * /api/engineering, /demo/* and /ops/* routes. It cannot see XAPI/PAPI/
 * Broker hops that happen entirely on the operator's local Mule runtime,
 * because those never call this fabric over HTTP. The Traces UI says this
 * plainly rather than fabricating cross-Mule rows.
 */

const MAX_EVENTS = 2000;
const events = [];

function componentFor(path) {
  if (path.startsWith("/api/sap")) return { component: "SAP_DEMO_FABRIC", domain: "SOURCE_SYSTEM" };
  if (path.startsWith("/api/contracts")) return { component: "CONTRACT_DEMO_FABRIC", domain: "SOURCE_SYSTEM" };
  if (path.startsWith("/api/engineering")) return { component: "ENGINEERING_DEMO_FABRIC", domain: "SOURCE_SYSTEM" };
  if (path.startsWith("/demo/scenarios")) return { component: "ScenarioEngine", domain: "CONTROL_CENTER" };
  if (path.startsWith("/demo/reset")) return { component: "ResetEngine", domain: "CONTROL_CENTER" };
  if (path.startsWith("/ops/")) return { component: "ControlCenter", domain: "CONTROL_CENTER" };
  return { component: "heroku-demo-fabric", domain: "SOURCE_SYSTEM" };
}

function extractEquipmentId(path) {
  const m = path.match(/EQP-\d{3}/i);
  return m ? m[0].toUpperCase() : null;
}

function record({ correlationId, path, method, statusCode, durationMs, equipmentId, operation }) {
  const { component, domain } = componentFor(path);
  const event = {
    timestamp: new Date().toISOString(),
    correlationId,
    component,
    domain,
    operation: operation || `${method} ${path}`,
    status: statusCode >= 200 && statusCode < 400 ? "SUCCESS" : "ERROR",
    httpStatus: statusCode,
    durationMs,
    equipmentId: equipmentId || extractEquipmentId(path),
  };
  events.push(event);
  if (events.length > MAX_EVENTS) events.shift();
  return event;
}

function byCorrelationId(correlationId) {
  return events.filter((e) => e.correlationId === correlationId);
}

function search({ correlationId, equipmentId, limit = 200 }) {
  let results = events;
  if (correlationId) results = results.filter((e) => e.correlationId === correlationId);
  if (equipmentId) results = results.filter((e) => e.equipmentId === equipmentId.toUpperCase());
  return results.slice(-limit).reverse();
}

function correlationIds({ limit = 50 } = {}) {
  const seen = new Map();
  for (let i = events.length - 1; i >= 0 && seen.size < limit; i--) {
    const e = events[i];
    if (!seen.has(e.correlationId)) seen.set(e.correlationId, e.timestamp);
  }
  return [...seen.entries()].map(([correlationId, timestamp]) => ({ correlationId, timestamp }));
}

module.exports = { record, search, byCorrelationId, correlationIds };
