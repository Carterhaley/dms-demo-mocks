/**
 * In-memory audit log of every operator mutation (spec section 45).
 *
 * Known limitation (documented, not hidden): this dyno has no database --
 * the underlying demo fabric itself has always been pure in-memory state
 * (see seed.js / server.js `buildFabric()`), so audit history does not
 * survive a dyno restart either. Adding a new persistence technology for
 * this alone was judged out of scope for this pass (spec section 48: don't
 * introduce a new DB unless necessary) -- see docs/DEMO-CONTROL-CENTER.md
 * "Known limitations" for the tradeoff and how to add Postgres later.
 */

const MAX_ENTRIES = 500;
const entries = [];

function record({ operator, action, equipmentId, scenarioId, before, after, correlationId, result }) {
  const entry = {
    id: entries.length + 1,
    timestamp: new Date().toISOString(),
    operator: operator || "unknown",
    action,
    equipmentId: equipmentId || null,
    scenarioId: scenarioId || null,
    before: before ?? null,
    after: after ?? null,
    correlationId: correlationId || null,
    result: result || "OK",
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  return entry;
}

function list({ limit = 100 } = {}) {
  return entries.slice(-limit).reverse();
}

module.exports = { record, list };
