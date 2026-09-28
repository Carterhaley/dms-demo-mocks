/**
 * Fabric mutation logic, extracted verbatim from the original inline
 * /demo/scenarios/* route handlers so both the legacy /demo/* routes AND
 * the new /ops/scenarios pipeline call the exact same code -- no
 * duplicated/drifting mutation logic (spec section 21 implies one seed
 * engine, not two).
 */

const { sapRecordForIndex, obligationForIndex, engineeringRecordFor } = require("../seed");

const SCENARIO_TARGETS = {
  "engineering-change": "EQP-041",
  "sap-shortage": "EQP-057",
  "no-contract": "EQP-066",
};

function applyEngineeringChange(state) {
  const equipmentId = SCENARIO_TARGETS["engineering-change"];
  const rec = state.engineering.byEquipment.get(equipmentId);
  rec.status = "PENDING_CHANGE";
  rec.changeNote = "Engineering change order issued -- drawing revision pending re-release.";
  return { equipmentId, engineering: rec };
}

function restoreEngineeringChange(state) {
  const equipmentId = SCENARIO_TARGETS["engineering-change"];
  const fresh = engineeringRecordFor(equipmentId);
  state.engineering.byEquipment.set(equipmentId, fresh);
  return { equipmentId, engineering: fresh };
}

function applySapShortage(state) {
  const equipmentId = SCENARIO_TARGETS["sap-shortage"];
  const rec = state.sap.byId.get(equipmentId);
  rec.availableQuantity = 0;
  rec.plantStatus = "SHORTAGE";
  rec.fulfillmentStatus = "SHORTAGE";
  return { equipmentId, sap: { ...rec, aliases: [...rec.aliases] } };
}

function restoreSapShortage(state) {
  const equipmentId = SCENARIO_TARGETS["sap-shortage"];
  const current = state.sap.byId.get(equipmentId);
  const fresh = sapRecordForIndex(current.index);
  for (const alias of current.aliases) state.sap.byId.delete(alias);
  for (const alias of fresh.aliases) state.sap.byId.set(alias, fresh);
  state.sap.records[fresh.index - 1] = fresh;
  return { equipmentId, sap: fresh };
}

function applyNoContract(state, pushContractObligation) {
  const equipmentId = SCENARIO_TARGETS["no-contract"];
  const o = state.contracts.byEquipment.get(equipmentId);
  state.contracts.byEquipment.delete(equipmentId);
  state.contracts.byId.delete(o.obligationId);
  const list = state.contracts.byWorkPackage.get(o.workPackageId) || [];
  state.contracts.byWorkPackage.set(o.workPackageId, list.filter((x) => x.obligationId !== o.obligationId));
  state.contracts.obligations = state.contracts.obligations.filter((x) => x.obligationId !== o.obligationId);
  pushContractObligation?.(equipmentId, { equipmentId, removed: true, reason: "no-contract scenario applied" });
  return { equipmentId, removed: o.obligationId };
}

function restoreNoContract(state, pushContractObligation) {
  const equipmentId = SCENARIO_TARGETS["no-contract"];
  const i = parseInt(equipmentId.split("-")[1], 10);
  const fresh = obligationForIndex(i);
  state.contracts.byEquipment.set(equipmentId, fresh);
  state.contracts.byId.set(fresh.obligationId, fresh);
  const list = state.contracts.byWorkPackage.get(fresh.workPackageId) || [];
  list.push(fresh);
  state.contracts.byWorkPackage.set(fresh.workPackageId, list);
  state.contracts.obligations.push(fresh);
  pushContractObligation?.(equipmentId, fresh);
  return { equipmentId, restored: fresh.obligationId };
}

module.exports = {
  SCENARIO_TARGETS,
  applyEngineeringChange,
  restoreEngineeringChange,
  applySapShortage,
  restoreSapShortage,
  applyNoContract,
  restoreNoContract,
};
