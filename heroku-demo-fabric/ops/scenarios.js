/**
 * Scenario engine: wraps the existing fabric mutations (ops/fabricMutations)
 * in the operator-facing pipeline model from spec sections 19-21. Tracks the
 * one "active scenario" the Overview page shows.
 *
 * Honesty constraint carried through from health.js: Procurement/Mule
 * Sync/Salesforce/Broker pipeline steps only run for real if the operator
 * has configured a public URL for that dependency (this dyno can't reach
 * localhost). Otherwise the step is marked SKIPPED with a stated reason --
 * the scenario is never reported as fully "loaded" when steps outside this
 * fabric's authority didn't actually run.
 */

const { SCENARIOS, isLocalOnly } = require("./registry");
const mutations = require("./fabricMutations");
const equipmentOps = require("./equipment");

function publicUrl(envName) {
  const url = process.env[envName];
  return url && !isLocalOnly(url) ? url : null;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function createScenarioEngine({ getState, pushContractObligation, broadcast, audit, traces }) {
  let active = null; // { scenarioId, loadedAt, steps, equipmentId, expectedRisk }
  const fabricApplied = { "engineering-change": false, "sap-shortage": false, "no-contract": false };

  function step(name, status, detail) {
    return { name, status, detail, at: new Date().toISOString() };
  }

  async function runPump023(operator, correlationId) {
    const steps = [];
    steps.push(step("Contract", "READY", "Seed already carries required date for EQP-023 (no mutation in this fabric)."));
    steps.push(step("Engineering", "READY", "Seed already carries RELEASED / Rev D for EQP-023 (no mutation in this fabric)."));

    const costpoint = getState().costpoint;
    const order = Array.from(costpoint.orders.values()).find((o) => o.equipmentId === "EQP-023");
    if (!order) {
      steps.push(step("Costpoint", "ERROR", "No Costpoint order exists yet for EQP-023 -- submit its equipment project first (POST /api/costpoint/purchase-orders)."));
    } else {
      order.expectedDeliveryDate = addDays(order.requestedDeliveryDate, 21);
      order.updatedAt = new Date().toISOString();
      costpoint.orders.set(order.costpointOrderId, order);
      steps.push(step("Costpoint", "OK", `Order ${order.costpointOrderId} expectedDeliveryDate -> ${order.expectedDeliveryDate} (in-process, /api/costpoint).`));
    }

    const papiUrl = publicUrl("PAPI_URL");
    if (!papiUrl) {
      steps.push(step("Mule Sync", "SKIPPED_UNREACHABLE", "PAPI_URL not configured to a public tunnel."));
      steps.push(step("Equipment 360 (PAPI)", "SKIPPED_UNREACHABLE", "Depends on Mule Sync above."));
    } else {
      steps.push(step("Mule Sync", "SKIPPED_UNREACHABLE", "Refresh requires a Salesforce equipmentProjectId/costpointOrderId lookup this console doesn't have -- run scripts/pump023-delay.sh locally for the full chain."));
      steps.push(step("Equipment 360 (PAPI)", "SKIPPED_UNREACHABLE", "See above."));
    }

    steps.push(step("Salesforce", "SKIPPED_UNREACHABLE", "Not reachable from this console (see Interfaces page)."));
    steps.push(step("Broker analysis", "OPTIONAL_SKIPPED", "Not reachable from this console -- see Agent Fabric page."));
    return steps;
  }

  async function runFabricScenario(fabricKey, equipmentId) {
    const steps = [];
    const applyFn = { "engineering-change": mutations.applyEngineeringChange, "sap-shortage": mutations.applySapShortage, "no-contract": mutations.applyNoContract }[fabricKey];
    const label = { "engineering-change": "Engineering", "sap-shortage": "SAP", "no-contract": "Contract" }[fabricKey];
    const state = getState();
    const result = fabricKey === "no-contract" ? applyFn(state, pushContractObligation) : applyFn(state);
    fabricApplied[fabricKey] = true;
    steps.push(step(label, "OK", `Applied in-process (${JSON.stringify(result)})`));
    for (const other of ["Contract", "Engineering", "SAP"]) {
      if (other !== label) steps.push(step(other, "NOT_APPLICABLE", `${other} is not part of this scenario.`));
    }
    steps.push(step("Costpoint", "SKIPPED_UNREACHABLE", "See Overview/Interfaces for reachability."));
    steps.push(step("Mule Sync", "SKIPPED_UNREACHABLE", "See Overview/Interfaces for reachability."));
    steps.push(step("Salesforce", "SKIPPED_UNREACHABLE", "See Overview/Interfaces for reachability."));
    steps.push(step("Broker analysis", "OPTIONAL_SKIPPED", "Not reachable from this console."));
    return { steps, equipmentId };
  }

  async function loadScenario(scenarioId, operator) {
    const def = SCENARIOS.find((s) => s.id === scenarioId);
    if (!def) return { error: "UNKNOWN_SCENARIO" };
    const correlationId = `scenario-${scenarioId}-${Date.now()}`;
    broadcast?.("scenario:started", { scenarioId, equipmentId: def.equipmentId, correlationId });

    let steps;
    if (def.executor === "pump023") steps = await runPump023(operator, correlationId);
    else if (def.executor === "fabric") ({ steps } = await runFabricScenario(def.fabricKey, def.equipmentId));
    else steps = [step("Verify", "READY", "No mutation required -- this scenario is inherent to the deterministic seed.")];

    const equipment360 = equipmentOps.getEquipment360(def.equipmentId, getState());
    active = { scenarioId, loadedAt: new Date().toISOString(), steps, equipmentId: def.equipmentId, expectedRisk: def.expectedRisk, correlationId };

    traces?.record({ correlationId, path: "/demo/scenarios/" + scenarioId, method: "POST", statusCode: 200, durationMs: 0, equipmentId: def.equipmentId, operation: `loadScenario(${scenarioId})` });
    audit?.record({ operator, action: "LOAD_SCENARIO", equipmentId: def.equipmentId, scenarioId, after: steps, correlationId, result: "OK" });
    broadcast?.("scenario:completed", { scenarioId, equipmentId: def.equipmentId, steps });

    return { scenario: def, steps, equipment360 };
  }

  async function restoreScenario(scenarioId, operator) {
    const def = SCENARIOS.find((s) => s.id === scenarioId);
    if (!def || def.executor !== "fabric") return { error: "NOT_RESTORABLE_FROM_CONSOLE" };
    const state = getState();
    const restoreFn = { "engineering-change": mutations.restoreEngineeringChange, "sap-shortage": mutations.restoreSapShortage, "no-contract": mutations.restoreNoContract }[def.fabricKey];
    const result = def.fabricKey === "no-contract" ? restoreFn(state, pushContractObligation) : restoreFn(state);
    fabricApplied[def.fabricKey] = false;
    if (active?.scenarioId === scenarioId) active = null;
    audit?.record({ operator, action: "RESTORE_SCENARIO", equipmentId: def.equipmentId, scenarioId, after: result, result: "OK" });
    return { scenario: def, result };
  }

  function listScenarios() {
    return SCENARIOS.map((s) => ({ ...s, currentlyApplied: s.executor === "fabric" ? fabricApplied[s.fabricKey] : active?.scenarioId === s.id }));
  }

  function getActiveScenario() {
    return active;
  }

  return { loadScenario, restoreScenario, listScenarios, getActiveScenario };
}

module.exports = { createScenarioEngine };
