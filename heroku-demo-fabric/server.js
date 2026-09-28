const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const cookieSession = require("cookie-session");
const { buildFabric, CONTRACT_ID, PROGRAM_ID, WORK_PACKAGES, MILESTONES } = require("./seed");
const fabricMutations = require("./ops/fabricMutations");
const opsAuth = require("./ops/auth");
const { createOpsRouter, traces: opsTraces, events: opsEvents } = require("./ops/routes");

const PORT = process.env.PORT || process.env.FABRIC_PORT || 4010;

const app = express();
app.use(cors());
app.use(express.json());

if (!process.env.SESSION_SECRET) {
  console.warn(
    "SESSION_SECRET not set -- using an ephemeral in-memory secret. Every operator session will be invalidated on the next dyno restart. Set SESSION_SECRET for stable sessions."
  );
}
app.use(
  cookieSession({
    name: "tao213_ops_session",
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
    maxAge: 12 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  })
);

let state = buildFabric();

// Costpoint state lives outside seed.js/buildFabric() (stateful via POST, not
// seeded) but is attached onto `state` so ops/health.js's probeSelf can see
// it like any other self-hosted domain.
let costpointState = {
  projects: new Map(), // programId -> { costpointProjectId, programId, programName }
  orders: new Map(), // costpointOrderId -> order
  ordersByExternalId: new Map(), // externalId -> costpointOrderId
  transientFailFlags: new Set(), // externalId
  orderSeq: 0,
};
state.costpoint = costpointState;

function resetCostpointState() {
  costpointState.projects.clear();
  costpointState.orders.clear();
  costpointState.ordersByExternalId.clear();
  costpointState.transientFailFlags.clear();
  costpointState.orderSeq = 0;
}

function nextCostpointOrderSeq() {
  costpointState.orderSeq += 1;
  return String(costpointState.orderSeq).padStart(5, "0");
}

// Scenario targets, deliberately distinct from the north-star (EQP-023, driven
// externally by mocks/costpoint-mock + scripts/pump023-delay.sh) and from the
// static edge cases (EQP-095 no-engineering, EQP-013/094/096-100 same set).
const SCENARIO_TARGETS = {
  "engineering-change": "EQP-041",
  "sap-shortage": "EQP-057",
  "no-contract": "EQP-066",
};

const scenarioState = {
  "engineering-change": { applied: false },
  "sap-shortage": { applied: false },
  "no-contract": { applied: false },
};

function correlationId(req) {
  return req.get("X-Correlation-Id") || `heroku-demo-fabric-${Date.now()}`;
}

// Push-out to Mule instead of Mule polling this fabric -- Heroku's own SSO
// front only blocks inbound traffic, so an outbound push from this dyno
// isn't affected by it. Target is tao213-sapi-contract's new
// PUT /api/equipment/{equipmentId}/obligations op, fronted by the ingress
// Omni Gateway once registered there (see OMNI-GATEWAY-MCP-BRIDGE.md).
// Fire-and-forget: never blocks or fails the caller's own response.
const MULE_CONTRACT_INGRESS_URL =
  process.env.MULE_CONTRACT_INGRESS_URL ||
  "https://tao213-omni-gateway-ingress-bfzgqn.7ycjbq.usa-e1.cloudhub.io/api";

async function pushContractObligation(equipmentId, obligation) {
  const url = `${MULE_CONTRACT_INGRESS_URL}/equipment/${equipmentId}/obligations`;
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(obligation),
      signal: AbortSignal.timeout(5000),
    });
    console.log(`push contract obligation ${equipmentId} -> ${url}: HTTP ${res.status}`);
  } catch (err) {
    console.warn(`push contract obligation ${equipmentId} -> ${url} failed: ${err.message}`);
  }
}

function notFound(res, sourceSystem, correlationId, message) {
  return res.status(404).json({ type: "NOT_FOUND", sourceSystem, correlationId, message });
}

app.use((req, res, next) => {
  const start = Date.now();
  const cid = correlationId(req);
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`);
    const event = opsTraces.record({
      correlationId: cid,
      path: req.path,
      method: req.method,
      statusCode: res.statusCode,
      durationMs,
    });
    if (event.domain === "SOURCE_SYSTEM") {
      opsEvents.broadcast("activity", { at: event.timestamp, message: `${event.component} ${event.operation} -> ${res.statusCode}`, correlationId: cid });
    }
  });
  next();
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    mock: true,
    fabric: "heroku-demo-fabric",
    domains: ["sap", "engineering", "contracts"],
    seeded: state.sap.records.length,
    scenarios: Object.fromEntries(Object.entries(scenarioState).map(([k, v]) => [k, v.applied])),
  });
});

// ---------------------------------------------------------------------------
// /api/sap -- mirrors mocks/sap-mock's route shapes under a path prefix.
// ---------------------------------------------------------------------------
const sapRouter = express.Router();

sapRouter.get("/health", (req, res) => {
  res.json({ status: "ok", mock: true, source: "SAP_DEMO_FABRIC", seeded: state.sap.records.length, plant: "1000" });
});

sapRouter.get("/materials", (req, res) => {
  const shortages = state.sap.records.filter((r) => r.availableQuantity <= 0).length;
  res.json({
    count: state.sap.records.length,
    shortageCount: shortages,
    plant: "1000",
    items: state.sap.records.map((r) => ({
      equipmentId: r.equipmentId,
      projectId: r.projectId,
      materialNumber: r.materialNumber,
      plant: r.plant,
      availableQuantity: r.availableQuantity,
      description: r.description,
    })),
  });
});

sapRouter.get("/materials/:equipmentId", (req, res) => {
  const rec = state.sap.byId.get(req.params.equipmentId);
  if (!rec) return notFound(res, "SAP_DEMO_FABRIC", correlationId(req), `No T-AO 213 material seed for equipmentId ${req.params.equipmentId}`);
  res.json({
    equipmentId: req.params.equipmentId,
    materialNumber: rec.materialNumber,
    plant: rec.plant,
    description: rec.description,
    baseUnitOfMeasure: rec.unitOfMeasure,
    materialType: rec.materialType,
    plantStatus: rec.plantStatus,
    raw: { seed: true, installationId: rec.installationId, projectId: rec.projectId },
  });
});

sapRouter.get("/materials/:equipmentId/availability", (req, res) => {
  const rec = state.sap.byId.get(req.params.equipmentId);
  if (!rec) return notFound(res, "SAP_DEMO_FABRIC", correlationId(req), `No T-AO 213 material seed for equipmentId ${req.params.equipmentId}`);
  res.json({
    equipmentId: req.params.equipmentId,
    materialNumber: rec.materialNumber,
    plant: rec.plant,
    availableQuantity: rec.availableQuantity,
    unitOfMeasure: rec.unitOfMeasure,
    checkRule: rec.checkRule,
    raw: { seed: true, AV_QTY_PLT: rec.availableQuantity, UNIT: rec.unitOfMeasure },
  });
});

sapRouter.get("/materials/:equipmentId/fulfillment", (req, res) => {
  const rec = state.sap.byId.get(req.params.equipmentId);
  if (!rec) return notFound(res, "SAP_DEMO_FABRIC", correlationId(req), `No T-AO 213 material seed for equipmentId ${req.params.equipmentId}`);
  const rows =
    rec.availableQuantity <= 0
      ? [{ DELB0: "OrdRes", MNG01: 1, DAT00: "2027-01-15", EXTRA: `Open reservation for ${rec.materialNumber}` }]
      : [{ DELB0: "Stock", MNG01: rec.availableQuantity, DAT00: new Date().toISOString().slice(0, 10), EXTRA: `Unrestricted-use stock at plant ${rec.plant}` }];
  res.json({
    equipmentId: req.params.equipmentId,
    materialNumber: rec.materialNumber,
    plant: rec.plant,
    fulfillmentRows: rows,
    fulfillmentStatus: rec.fulfillmentStatus,
    raw: { seed: true, ST_LIST: rows },
  });
});

sapRouter.patch("/admin/materials/:equipmentId", (req, res) => {
  const rec = state.sap.byId.get(req.params.equipmentId);
  if (!rec) return notFound(res, "SAP_DEMO_FABRIC", correlationId(req), `No T-AO 213 material seed for equipmentId ${req.params.equipmentId}`);
  const { availableQuantity } = req.body || {};
  if (availableQuantity !== undefined) {
    rec.availableQuantity = Number(availableQuantity);
    rec.plantStatus = rec.availableQuantity <= 0 ? "SHORTAGE" : "UNRESTRICTED";
    rec.fulfillmentStatus = rec.availableQuantity <= 0 ? "SHORTAGE" : "DATA_RETURNED";
  }
  res.json({ ...rec, aliases: [...rec.aliases] });
});

app.use("/api/sap", sapRouter);

// ---------------------------------------------------------------------------
// /api/contracts -- mirrors mocks/ironclad-mock's route shapes under a prefix.
// ---------------------------------------------------------------------------
const contractsRouter = express.Router();

contractsRouter.get("/health", (req, res) => {
  res.json({ status: "ok", mock: true, source: "CONTRACT_DEMO_FABRIC", seeded: state.contracts.obligations.length });
});

contractsRouter.get("/contracts/:contractId", (req, res) => {
  if (req.params.contractId !== CONTRACT_ID) {
    return notFound(res, "CONTRACT_DEMO_FABRIC", correlationId(req), `No contract ${req.params.contractId}`);
  }
  res.json({
    contractId: CONTRACT_ID,
    programId: PROGRAM_ID,
    title: "T-AO 213 Fleet Oiler Construction Contract",
    workPackages: WORK_PACKAGES.map((wp) => wp.workPackageId),
    mock: true,
  });
});

contractsRouter.get("/contracts/:contractId/work-packages", (req, res) => {
  if (req.params.contractId !== CONTRACT_ID) return notFound(res, "CONTRACT_DEMO_FABRIC", correlationId(req));
  res.json(WORK_PACKAGES.map((wp) => ({ ...wp, contractId: CONTRACT_ID, mock: true })));
});

contractsRouter.get("/contracts/:contractId/milestones", (req, res) => {
  if (req.params.contractId !== CONTRACT_ID) return notFound(res, "CONTRACT_DEMO_FABRIC", correlationId(req));
  res.json(MILESTONES.map((m) => ({ ...m, contractId: CONTRACT_ID, mock: true })));
});

contractsRouter.get("/work-packages/:workPackageId", (req, res) => {
  const wp = WORK_PACKAGES.find((w) => w.workPackageId === req.params.workPackageId);
  if (!wp) return notFound(res, "CONTRACT_DEMO_FABRIC", correlationId(req));
  res.json({ ...wp, contractId: CONTRACT_ID, mock: true });
});

contractsRouter.get("/work-packages/:workPackageId/obligations", (req, res) => {
  const list = state.contracts.byWorkPackage.get(req.params.workPackageId);
  if (!list) return notFound(res, "CONTRACT_DEMO_FABRIC", correlationId(req));
  res.json(list.map((o) => ({ ...o, mock: true })));
});

contractsRouter.get("/obligations/:obligationId", (req, res) => {
  const o = state.contracts.byId.get(req.params.obligationId);
  if (!o) return notFound(res, "CONTRACT_DEMO_FABRIC", correlationId(req));
  res.json({ ...o, mock: true });
});

// Reverse lookup -- what PAPI/agents actually join on for Equipment 360.
contractsRouter.get("/equipment/:equipmentId/obligations", (req, res) => {
  const o = state.contracts.byEquipment.get(req.params.equipmentId);
  if (!o) {
    return notFound(res, "CONTRACT_DEMO_FABRIC", correlationId(req), `No contract obligation mapped for equipmentId ${req.params.equipmentId}`);
  }
  res.json({ ...o, mock: true });
});

// Write-through op contract-sapi's own PUT /admin/equipment/:id/obligations
// forwards to here (mirrors mocks/ironclad-mock's identical route) -- needed
// for parity now that this fabric is contract-sapi's configured backend
// instead of ironclad-mock. Overwrites the equipment-keyed and id-keyed maps
// only; byWorkPackage stays on the original seed, same as ironclad-mock.
contractsRouter.put("/admin/equipment/:equipmentId/obligations", (req, res) => {
  const equipmentId = req.params.equipmentId;
  const pushed = { ...req.body, equipmentId, mock: true, source: "heroku-push-override", pushedAt: new Date().toISOString() };
  state.contracts.byEquipment.set(equipmentId, pushed);
  if (pushed.obligationId) state.contracts.byId.set(pushed.obligationId, pushed);
  res.json({ status: "ok", mock: true, equipmentId, correlationId: correlationId(req), stored: pushed });
});

app.use("/api/contracts", contractsRouter);

// ---------------------------------------------------------------------------
// /api/engineering -- ported from EngineeringMockService.cls, one route.
// ---------------------------------------------------------------------------
const engineeringRouter = express.Router();

engineeringRouter.get("/health", (req, res) => {
  res.json({ status: "ok", mock: true, source: "Engineering Demo Adapter", seeded: state.engineering.byEquipment.size });
});

engineeringRouter.get("/equipment/:equipmentId", (req, res) => {
  const rec = state.engineering.byEquipment.get(req.params.equipmentId);
  if (!rec) {
    return res.json({ equipmentId: req.params.equipmentId, source: "Engineering Demo Adapter", hasData: false });
  }
  res.json(rec);
});

app.use("/api/engineering", engineeringRouter);

// ---------------------------------------------------------------------------
// /api/costpoint -- mirrors mocks/costpoint-mock's route shapes under a path
// prefix, same migration rationale as /api/contracts: gives costpoint-sapi a
// cloud-reachable target instead of the operator's laptop (mocks/costpoint-mock,
// port 4001). Stateful (orders created via POST), not seeded from seed.js --
// own module-level state, reset alongside the rest of the fabric.
// ---------------------------------------------------------------------------
function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const COSTPOINT_SCENARIOS = { pump023: "EQP-023" };

function findCostpointOrderByEquipmentId(equipmentId) {
  return Array.from(costpointState.orders.values()).find((o) => o.equipmentId === equipmentId) || null;
}

const costpointRouter = express.Router();

costpointRouter.get("/health", (req, res) => {
  res.json({ status: "ok", mock: true, source: "COSTPOINT_DEMO_FABRIC" });
});

costpointRouter.post("/projects", (req, res) => {
  const { programId, programName } = req.body || {};
  const existing = costpointState.projects.get(programId);
  if (existing) return res.status(200).json(existing);
  const project = { costpointProjectId: `CP-${programId}-001`, programId, programName };
  costpointState.projects.set(programId, project);
  res.status(201).json(project);
});

costpointRouter.post("/purchase-orders", (req, res) => {
  const {
    costpointProjectId,
    externalId,
    equipmentId,
    description,
    installationId,
    plannedCost,
    requestedDeliveryDate,
    vendor,
    partNumber,
  } = req.body || {};

  if (!installationId || installationId.trim() === "" || installationId === "INVALID") {
    return res.status(422).json({
      errorCategory: "BUSINESS_VALIDATION",
      message: "Installation ID is invalid",
      field: "installationId",
      retryable: false,
    });
  }

  if (costpointState.transientFailFlags.has(externalId)) {
    costpointState.transientFailFlags.delete(externalId);
    return res.status(503).json({ errorCategory: "TRANSIENT_TECHNICAL", message: "Costpoint temporarily unavailable", retryable: true });
  }

  const existingOrderId = costpointState.ordersByExternalId.get(externalId);
  if (existingOrderId) {
    const existing = costpointState.orders.get(existingOrderId);
    return res.status(200).json({ ...existing, duplicate: true });
  }

  const seq = nextCostpointOrderSeq();
  const externalSuffix = String(externalId).split("-").pop();
  const ts = new Date().toISOString();
  const order = {
    costpointOrderId: `PO-TAO213-${seq}`,
    costpointProjectId,
    costpointLineId: `LINE-${externalSuffix}`,
    externalId,
    equipmentId,
    description,
    installationId,
    vendor,
    partNumber,
    plannedCost,
    actualCost: null,
    requestedDeliveryDate,
    expectedDeliveryDate: requestedDeliveryDate,
    erpStatus: "OPEN",
    createdAt: ts,
    updatedAt: ts,
  };
  costpointState.orders.set(order.costpointOrderId, order);
  costpointState.ordersByExternalId.set(externalId, order.costpointOrderId);
  res.status(201).json({ ...order, duplicate: false });
});

costpointRouter.get("/orders/changes", (req, res) => {
  const { modifiedSince } = req.query;
  const all = Array.from(costpointState.orders.values());
  if (!modifiedSince) return res.json(all);
  const since = new Date(modifiedSince).getTime();
  res.json(all.filter((o) => new Date(o.updatedAt).getTime() > since));
});

costpointRouter.get("/orders/:costpointOrderId", (req, res) => {
  const order = costpointState.orders.get(req.params.costpointOrderId);
  if (!order) return res.status(404).json({ errorCategory: "NOT_FOUND", retryable: false });
  res.json(order);
});

costpointRouter.get("/projects/:costpointProjectId/actuals", (req, res) => {
  const { costpointProjectId } = req.params;
  const actuals = Array.from(costpointState.orders.values())
    .filter((o) => o.costpointProjectId === costpointProjectId)
    .map((o) => ({ costpointOrderId: o.costpointOrderId, externalId: o.externalId, actualCost: o.actualCost }));
  res.json({ costpointProjectId, actuals });
});

costpointRouter.get("/equipment/:externalId", (req, res) => {
  const orderId = costpointState.ordersByExternalId.get(req.params.externalId);
  const order = orderId ? costpointState.orders.get(orderId) : null;
  if (!order) return res.status(404).json({ errorCategory: "NOT_FOUND", retryable: false });
  res.json(order);
});

costpointRouter.post("/admin/orders/:externalId/fail-next-transient", (req, res) => {
  costpointState.transientFailFlags.add(req.params.externalId);
  res.json({ armed: true });
});

costpointRouter.patch("/admin/orders/:costpointOrderId", (req, res) => {
  const order = costpointState.orders.get(req.params.costpointOrderId);
  if (!order) return res.status(404).json({ errorCategory: "NOT_FOUND", retryable: false });
  const { expectedDeliveryDate, actualCost } = req.body || {};
  if (expectedDeliveryDate !== undefined) order.expectedDeliveryDate = expectedDeliveryDate;
  if (actualCost !== undefined) order.actualCost = actualCost;
  order.updatedAt = new Date().toISOString();
  costpointState.orders.set(order.costpointOrderId, order);
  res.json(order);
});

costpointRouter.post("/demo/scenarios/:scenarioKey/delay", (req, res) => {
  const equipmentId = COSTPOINT_SCENARIOS[req.params.scenarioKey];
  if (!equipmentId) return res.status(404).json({ errorCategory: "NOT_FOUND", message: "Unknown demo scenario key", retryable: false });
  const order = findCostpointOrderByEquipmentId(equipmentId);
  if (!order) {
    return res.status(404).json({ errorCategory: "NOT_FOUND", message: `No Costpoint order exists yet for ${equipmentId} - submit its equipment project first`, retryable: false });
  }
  const delayDays = Number.isFinite(req.body?.delayDays) ? req.body.delayDays : 21;
  order.expectedDeliveryDate = addDays(order.requestedDeliveryDate, delayDays);
  order.updatedAt = new Date().toISOString();
  costpointState.orders.set(order.costpointOrderId, order);
  res.json({ scenario: req.params.scenarioKey, equipmentId, delayDays, order });
});

costpointRouter.post("/demo/scenarios/:scenarioKey/restore", (req, res) => {
  const equipmentId = COSTPOINT_SCENARIOS[req.params.scenarioKey];
  if (!equipmentId) return res.status(404).json({ errorCategory: "NOT_FOUND", message: "Unknown demo scenario key", retryable: false });
  const order = findCostpointOrderByEquipmentId(equipmentId);
  if (!order) return res.status(404).json({ errorCategory: "NOT_FOUND", message: `No Costpoint order exists yet for ${equipmentId}`, retryable: false });
  order.expectedDeliveryDate = order.requestedDeliveryDate;
  order.updatedAt = new Date().toISOString();
  costpointState.orders.set(order.costpointOrderId, order);
  res.json({ scenario: req.params.scenarioKey, equipmentId, order });
});

costpointRouter.post("/demo/reset", (req, res) => {
  resetCostpointState();
  res.json({ reset: true });
});

app.use("/api/costpoint", costpointRouter);

// ---------------------------------------------------------------------------
// /demo -- fabric-wide reset + scoped scenario mutation (one business change
// per button). Each scenario is independently apply/restore-able.
// ---------------------------------------------------------------------------
app.get("/demo/scenarios", (req, res) => {
  res.json({
    scenarios: Object.entries(scenarioState).map(([key, s]) => ({
      key,
      equipmentId: SCENARIO_TARGETS[key],
      applied: s.applied,
    })),
  });
});

app.post("/demo/scenarios/engineering-change/apply", (req, res) => {
  const { equipmentId, engineering } = fabricMutations.applyEngineeringChange(state);
  scenarioState["engineering-change"].applied = true;
  res.json({ scenario: "engineering-change", applied: true, equipmentId, engineering });
});

app.post("/demo/scenarios/engineering-change/restore", (req, res) => {
  const { equipmentId, engineering } = fabricMutations.restoreEngineeringChange(state);
  scenarioState["engineering-change"].applied = false;
  res.json({ scenario: "engineering-change", applied: false, equipmentId, engineering });
});

app.post("/demo/scenarios/sap-shortage/apply", (req, res) => {
  const { equipmentId, sap } = fabricMutations.applySapShortage(state);
  scenarioState["sap-shortage"].applied = true;
  res.json({ scenario: "sap-shortage", applied: true, equipmentId, sap });
});

app.post("/demo/scenarios/sap-shortage/restore", (req, res) => {
  const { equipmentId, sap } = fabricMutations.restoreSapShortage(state);
  scenarioState["sap-shortage"].applied = false;
  res.json({ scenario: "sap-shortage", applied: false, equipmentId, sap });
});

app.post("/demo/scenarios/no-contract/apply", (req, res) => {
  const { equipmentId, removed } = fabricMutations.applyNoContract(state, pushContractObligation);
  scenarioState["no-contract"].applied = true;
  res.json({ scenario: "no-contract", applied: true, equipmentId, removed });
});

app.post("/demo/scenarios/no-contract/restore", (req, res) => {
  const { equipmentId, restored } = fabricMutations.restoreNoContract(state, pushContractObligation);
  scenarioState["no-contract"].applied = false;
  res.json({ scenario: "no-contract", applied: false, equipmentId, restored });
});

app.post("/demo/reset", (req, res) => {
  state = buildFabric();
  resetCostpointState();
  state.costpoint = costpointState;
  for (const key of Object.keys(scenarioState)) scenarioState[key].applied = false;
  res.json({ reset: true, mock: true, seeded: state.sap.records.length });
});

// ---------------------------------------------------------------------------
// /ops -- T-AO 213 Integration Control Center (operator-only). Separate
// namespace from /api (source-system mocks) and /demo (legacy scenario
// triggers), per spec section 40.
// ---------------------------------------------------------------------------
app.use("/ops/auth", opsAuth.router);
app.use(
  "/ops",
  createOpsRouter({
    getState: () => state,
    pushContractObligation,
    buildFabric,
    onReset: () => {
      state = buildFabric();
      resetCostpointState();
      state.costpoint = costpointState;
      for (const key of Object.keys(scenarioState)) scenarioState[key].applied = false;
    },
  })
);

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`heroku-demo-fabric listening on ${PORT} (sap+contracts+engineering, ${state.sap.records.length} equipment items)`);
});
