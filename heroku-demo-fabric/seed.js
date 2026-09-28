/**
 * Externally-reachable T-AO 213 demo-system fabric. This is NOT a live SAP /
 * Ironclad / AVEVA integration -- no such integrations exist anywhere in this
 * repo. It re-derives the SAME EQP-001..EQP-100 canonical catalog and the SAME
 * deterministic formulas already used by mocks/sap-mock and mocks/ironclad-mock,
 * and ports mocks/../salesforce/tao213-metadata EngineeringMockService.cls's
 * logic verbatim to JS, so this fabric and the local mocks never drift.
 *
 * Scope: this fabric owns SAP + Contracts + Engineering. Costpoint stays a
 * separate local mock (mocks/costpoint-mock) -- the Pump 023 north-star delay
 * is driven from there via scripts/pump023-delay.sh, unchanged by this file.
 */

const INSTALLATIONS = ["INSTALL-A", "INSTALL-B", "INSTALL-C", "INSTALL-D", "INSTALL-E"];
const ZONES = ["A", "B", "C", "D"];
const ENGINEERING_SYSTEMS = ["Propulsion", "Fuel Transfer", "Hull Structure", "Outfitting", "Mission Systems"];
const REVISIONS = ["A", "B", "C", "D"];

// Same 8-item "no engineering data" edge case as EngineeringMockService.cls.
const NO_ENGINEERING_DATA = new Set([
  "EQP-013", "EQP-094", "EQP-095", "EQP-096", "EQP-097", "EQP-098", "EQP-099", "EQP-100",
]);

const CONTRACT_ID = "CTR-TAO213-001";
const PROGRAM_ID = "T-AO-213";

const WORK_PACKAGES = [
  { workPackageId: "WP-HULL-STRUCTURE", title: "Hull Structure", range: [1, 25], owner: "J. Alvarez (Contracts)" },
  { workPackageId: "WP-PROPULSION", title: "Propulsion Systems", range: [26, 50], owner: "R. Chen (Contracts)" },
  { workPackageId: "WP-OUTFITTING", title: "Outfitting & Auxiliary Systems", range: [51, 75], owner: "M. Okafor (Contracts)" },
  { workPackageId: "WP-MISSION-SYSTEMS", title: "Mission Systems", range: [76, 100], owner: "S. Patel (Contracts)" },
];

const MILESTONES = [
  { milestoneId: "MS-HULL-COMPLETE", workPackageId: "WP-HULL-STRUCTURE", title: "Hull Structure Complete", requiredDate: "2027-03-15" },
  { milestoneId: "MS-PROPULSION-COMPLETE", workPackageId: "WP-PROPULSION", title: "Propulsion Systems Complete", requiredDate: "2027-08-01" },
  { milestoneId: "MS-OUTFITTING-COMPLETE", workPackageId: "WP-OUTFITTING", title: "Outfitting Complete", requiredDate: "2027-11-01" },
  { milestoneId: "MS-MISSION-SYSTEMS-COMPLETE", workPackageId: "WP-MISSION-SYSTEMS", title: "Mission Systems Complete", requiredDate: "2028-02-01" },
];

function pad(n) {
  return String(n).padStart(3, "0");
}

function mod(a, b) {
  return ((a % b) + b) % b;
}

function workPackageFor(i) {
  return WORK_PACKAGES.find((wp) => i >= wp.range[0] && i <= wp.range[1]);
}

function suffixOf(equipmentId) {
  const digits = String(equipmentId || "").replace(/[^0-9]/g, "");
  return digits ? parseInt(digits, 10) : 1;
}

// -- SAP domain -- mirrors mocks/sap-mock/seed.js recordForIndex() exactly.
function sapRecordForIndex(i) {
  const suffix = pad(i);
  const equipmentId = `EQP-${suffix}`;
  const projectId = `T-AO213-EQP-${suffix}`;
  const materialNumber = `TAO-${suffix}`;
  const plant = "1000";
  const description = i <= 10 ? `Pump ${suffix}` : `Equipment ${suffix}`;
  const installationId = INSTALLATIONS[(i - 1) % INSTALLATIONS.length];
  const shortage = i % 10 === 0;
  const tight = !shortage && i % 5 === 0;
  const availableQuantity = shortage ? 0 : tight ? 1 : 12 + (i % 20);
  const unitOfMeasure = "EA";
  const materialType = i <= 10 ? "HAWA" : "ROH";

  const aliases = [equipmentId, projectId];
  if (i === 1) aliases.push("EQ-1001");
  if (i === 2) aliases.push("EQ-1002");
  if (i === 3) aliases.push("EQ-1003");

  return {
    index: i,
    equipmentId,
    projectId,
    aliases,
    materialNumber,
    plant,
    description,
    installationId,
    availableQuantity,
    unitOfMeasure,
    materialType,
    plantStatus: shortage ? "SHORTAGE" : "UNRESTRICTED",
    checkRule: "A",
    fulfillmentStatus: shortage ? "SHORTAGE" : "DATA_RETURNED",
  };
}

function buildSapCatalog() {
  const byId = new Map();
  const records = [];
  for (let i = 1; i <= 100; i++) {
    const rec = sapRecordForIndex(i);
    records.push(rec);
    for (const alias of rec.aliases) byId.set(alias, rec);
  }
  return { byId, records };
}

// -- Contracts domain -- mirrors mocks/ironclad-mock/seed.js build() exactly.
function obligationForIndex(i) {
  const suffix = pad(i);
  const equipmentId = `EQP-${suffix}`;
  const wp = workPackageFor(i);
  const baseDate = new Date("2026-11-01T00:00:00Z");
  const requiredDate = new Date(baseDate.getTime() + i * 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    obligationId: `OBL-${suffix}`,
    contractId: CONTRACT_ID,
    workPackageId: wp.workPackageId,
    equipmentId,
    description: `Deliver and install ${equipmentId} per ${wp.title} scope`,
    requiredDate,
    owner: wp.owner,
  };
}

function buildContracts() {
  const obligations = [];
  for (let i = 1; i <= 100; i++) obligations.push(obligationForIndex(i));
  const byEquipment = new Map(obligations.map((o) => [o.equipmentId, o]));
  const byId = new Map(obligations.map((o) => [o.obligationId, o]));
  const byWorkPackage = new Map();
  for (const o of obligations) {
    const list = byWorkPackage.get(o.workPackageId) || [];
    list.push(o);
    byWorkPackage.set(o.workPackageId, list);
  }
  return { obligations, byEquipment, byId, byWorkPackage };
}

// -- Engineering domain -- ports EngineeringMockService.cls#getForEquipment verbatim.
function engineeringRecordFor(equipmentId) {
  const rec = { equipmentId, source: "Engineering Demo Adapter" };

  if (!equipmentId || NO_ENGINEERING_DATA.has(equipmentId)) {
    rec.hasData = false;
    return rec;
  }

  const suffix = suffixOf(equipmentId);
  const zone = ZONES[mod(suffix, ZONES.length)];

  rec.hasData = true;
  rec.engineeringObjectId = `AVEVA-OBJ-${1000 + suffix}`;
  rec.tag = `P-${pad(suffix)}`;
  rec.engineeringSystem = ENGINEERING_SYSTEMS[mod(suffix, ENGINEERING_SYSTEMS.length)];
  rec.installationId = `INSTALL-${zone}`;
  rec.drawingId = `P&ID-TAO213-${pad(suffix)}`;
  rec.schematicId = `SCH-TAO213-${zone}`;
  rec.revision = REVISIONS[mod(suffix, REVISIONS.length)];
  rec.status = mod(suffix, 7) === 0 ? "IN_REVIEW" : "RELEASED";
  rec.lastUpdated = new Date(Date.now() - mod(suffix, 30) * 24 * 60 * 60 * 1000).toISOString();
  rec.deepLink = `https://engineering-demo.local/objects/${rec.engineeringObjectId}`;
  rec.overlayX = 20 + mod(suffix * 7, 60);
  rec.overlayY = 20 + mod(suffix * 13, 60);
  rec.overlayZone = zone;

  // Pump 023 -- the north-star example -- gets specific, rich data (matches Apex).
  if (equipmentId === "EQP-023") {
    rec.engineeringObjectId = "AVEVA-OBJ-1023";
    rec.tag = "P-023";
    rec.engineeringSystem = "Fuel Transfer";
    rec.installationId = "INSTALL-C";
    rec.drawingId = "P&ID-TAO213-023";
    rec.schematicId = "SCH-TAO213-C";
    rec.revision = "D";
    rec.status = "RELEASED";
    rec.lastUpdated = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
    rec.deepLink = "https://engineering-demo.local/objects/AVEVA-OBJ-1023";
    rec.overlayX = 62;
    rec.overlayY = 38;
    rec.overlayZone = "C";
  }

  return rec;
}

function buildEngineering() {
  const byEquipment = new Map();
  for (let i = 1; i <= 100; i++) {
    const equipmentId = `EQP-${pad(i)}`;
    byEquipment.set(equipmentId, engineeringRecordFor(equipmentId));
  }
  return { byEquipment };
}

function buildFabric() {
  return { sap: buildSapCatalog(), contracts: buildContracts(), engineering: buildEngineering() };
}

module.exports = {
  buildFabric,
  sapRecordForIndex,
  obligationForIndex,
  engineeringRecordFor,
  suffixOf,
  pad,
  CONTRACT_ID,
  PROGRAM_ID,
  WORK_PACKAGES,
  MILESTONES,
  NO_ENGINEERING_DATA,
};
