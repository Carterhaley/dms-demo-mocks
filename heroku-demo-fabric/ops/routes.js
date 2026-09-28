/**
 * All operator-facing endpoints, namespaced under /ops (spec section 39),
 * deliberately separate from the /api/* source-system mock routes and the
 * legacy /demo/* routes (spec section 40).
 */

const express = require("express");
const { INTERFACES, SCENARIOS } = require("./registry");
const health = require("./health");
const equipmentOps = require("./equipment");
const agentFabric = require("./agentFabric");
const governance = require("./governance");
const traces = require("./traces");
const audit = require("./audit");
const events = require("./events");
const { createScenarioEngine } = require("./scenarios");
const { requireSession, requireOperator } = require("./auth");

function correlationId() {
  return `ops-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createOpsRouter({ getState, pushContractObligation, buildFabric, onReset }) {
  const router = express.Router();
  const scenarioEngine = createScenarioEngine({
    getState,
    pushContractObligation,
    broadcast: events.broadcast,
    audit,
    traces,
  });

  let lastReset = new Date().toISOString();

  router.use(requireSession);

  router.get("/status", async (req, res) => {
    const results = await health.checkAllInterfaces(getState());
    const core = health.coreReadiness(results);
    const scenario = health.scenarioReadiness(results);
    res.json({
      environment: "DEMO",
      herokuStatus: "READY",
      coreDemo: core,
      scenarios: scenario,
      activeScenario: scenarioEngine.getActiveScenario(),
      lastReset,
      timestamp: new Date().toISOString(),
    });
  });

  router.get("/interfaces", async (req, res) => {
    const results = await health.checkAllInterfaces(getState());
    res.json({ interfaces: results });
  });

  router.get("/interfaces/:id", async (req, res) => {
    const iface = INTERFACES.find((i) => i.id === req.params.id);
    if (!iface) return res.status(404).json({ error: "UNKNOWN_INTERFACE" });
    const result = await health.checkInterface(iface, getState());
    const recent = traces.search({ limit: 500 }).filter((e) => e.component === iface.name || e.operation?.includes(iface.id)).slice(0, 20);
    res.json({ ...result, recentEvents: recent });
  });

  router.post("/interfaces/:id/test", requireOperator, async (req, res) => {
    const iface = INTERFACES.find((i) => i.id === req.params.id);
    if (!iface) return res.status(404).json({ error: "UNKNOWN_INTERFACE" });
    const result = await health.checkInterface(iface, getState());
    audit.record({ operator: req.session.role, action: "RUN_HEALTH_CHECK", result: result.status, correlationId: correlationId() });
    res.json(result);
  });

  router.get("/scenarios", (req, res) => {
    res.json({ scenarios: scenarioEngine.listScenarios(), active: scenarioEngine.getActiveScenario() });
  });

  router.get("/scenarios/:id/status", (req, res) => {
    const active = scenarioEngine.getActiveScenario();
    if (active?.scenarioId === req.params.id) return res.json(active);
    const def = SCENARIOS.find((s) => s.id === req.params.id);
    if (!def) return res.status(404).json({ error: "UNKNOWN_SCENARIO" });
    res.json({ scenarioId: req.params.id, loadedAt: null, steps: [], note: "Not currently the active scenario." });
  });

  router.post("/scenarios/:id/load", requireOperator, async (req, res) => {
    const result = await scenarioEngine.loadScenario(req.params.id, req.session.role);
    if (result.error) return res.status(404).json(result);
    res.json(result);
  });

  router.post("/scenarios/:id/restore", requireOperator, async (req, res) => {
    const result = await scenarioEngine.restoreScenario(req.params.id, req.session.role);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  });

  router.post("/reset", requireOperator, (req, res) => {
    if (req.body?.confirm !== "RESET") {
      return res.status(400).json({ error: "CONFIRMATION_REQUIRED", message: 'Send {"confirm":"RESET"} to proceed.' });
    }
    const before = { seeded: getState().sap.records.length };
    onReset();
    lastReset = new Date().toISOString();
    events.broadcast("reset:completed", { at: lastReset });
    audit.record({ operator: req.session.role, action: "RESET", before, after: { at: lastReset }, result: "OK" });
    res.json({ reset: true, at: lastReset });
  });

  router.get("/equipment", (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: "MISSING_QUERY", message: "Pass ?q=EQP-023 (or 'Pump 023', 'P-023')." });
    const equipmentId = equipmentOps.resolveEquipmentId(q, getState());
    if (!equipmentId) return res.status(404).json({ error: "NOT_RESOLVABLE", message: `Could not resolve "${q}" to an equipmentId from this console.` });
    const record = equipmentOps.getEquipment360(equipmentId, getState());
    res.json(record);
  });

  router.get("/equipment/:equipmentId", (req, res) => {
    const record = equipmentOps.getEquipment360(req.params.equipmentId.toUpperCase(), getState());
    if (!record) return res.status(404).json({ error: "NOT_FOUND" });
    res.json(record);
  });

  router.get("/agents/status", (req, res) => {
    res.json({ status: agentFabric.STATUS, capabilities: agentFabric.CAPABILITIES });
  });

  router.get("/agents/tasks", (req, res) => {
    res.json({ tasks: [agentFabric.referenceTask()] });
  });

  router.get("/agents/tasks/:taskId", (req, res) => {
    res.json(agentFabric.referenceTask());
  });

  router.get("/agents/mcp-tools", (req, res) => {
    res.json({ tools: agentFabric.MCP_TOOLS });
  });

  router.get("/governance", (req, res) => {
    res.json({ controls: governance.CONTROLS });
  });

  router.post("/governance/test/pii", requireOperator, (req, res) => {
    const mode = req.body?.mode === "pii" ? "pii" : "safe";
    const result = governance.runPiiSimulation(mode);
    audit.record({ operator: req.session.role, action: "RUN_AGENT_TEST", after: result, result: result.result });
    res.json(result);
  });

  router.get("/traces", (req, res) => {
    if (req.query.correlationId) return res.json({ events: traces.byCorrelationId(req.query.correlationId) });
    res.json({ correlationIds: traces.correlationIds(), events: traces.search({ equipmentId: req.query.equipmentId, limit: 50 }) });
  });

  router.get("/traces/:correlationId", (req, res) => {
    const evs = traces.byCorrelationId(req.params.correlationId);
    res.json({ correlationId: req.params.correlationId, events: evs });
  });

  router.get("/audit", (req, res) => {
    res.json({ entries: audit.list() });
  });

  router.get("/events", events.handler);

  return router;
}

module.exports = { createOpsRouter, traces, audit, events };
