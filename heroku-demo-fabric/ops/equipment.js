/**
 * Canonical cross-system Equipment 360 aggregator (spec sections 24-26, 44).
 * The browser calls one endpoint (/ops/equipment/:id); this module composes
 * it server-side from the in-process SAP/Contracts/Engineering/Costpoint
 * domains this dyno owns. Salesforce has no record-id map of its own here,
 * so that section stays honestly reported as unreachable unless
 * SALESFORCE_DEEP_LINK_BASE is configured.
 */

function pad(n) {
  return String(n).padStart(3, "0");
}

function resolveEquipmentId(query, fabricState) {
  if (!query) return null;
  const q = query.trim();
  const direct = q.toUpperCase().match(/^EQP-(\d{1,3})$/);
  if (direct) return `EQP-${pad(parseInt(direct[1], 10))}`;

  // Engineering tag, e.g. "P-023"
  const tagMatch = q.toUpperCase().match(/^P-(\d{1,3})$/);
  if (tagMatch) return `EQP-${pad(parseInt(tagMatch[1], 10))}`;

  // Any free text carrying a 1-3 digit number, e.g. "Pump 023", "pump023"
  const digits = q.match(/(\d{1,3})/);
  if (digits) {
    const id = `EQP-${pad(parseInt(digits[1], 10))}`;
    if (fabricState.sap.byId.has(id)) return id;
  }

  if (/^PO-/i.test(q)) return null; // no PO index in this fabric -- see note in getEquipment360

  return null;
}

function consistencyMark(present) {
  return present ? "OK" : "MISSING";
}

function fabricRiskIndicator({ hasContract, hasEngineering, sapShortage }) {
  if (!hasContract) return "RED";
  if (sapShortage) return "AMBER";
  if (!hasEngineering) return "AMBER";
  return "GREEN";
}

function getEquipment360(equipmentId, fabricState) {
  const sap = fabricState.sap.byId.get(equipmentId);
  const contract = fabricState.contracts.byEquipment.get(equipmentId);
  const engineering = fabricState.engineering.byEquipment.get(equipmentId);
  const costpointOrder = Array.from(fabricState.costpoint.orders.values()).find((o) => o.equipmentId === equipmentId) || null;

  if (!sap && !contract && !engineering) return null;

  const hasContract = !!contract;
  const hasEngineering = !!(engineering && engineering.hasData);
  const sapShortage = !!(sap && sap.availableQuantity <= 0);

  return {
    equipmentId,
    identity: {
      program: "T-AO-213",
      installation: engineering?.installationId || sap?.installationId || null,
    },
    contract: contract
      ? {
          contractId: contract.contractId,
          obligationId: contract.obligationId,
          workPackageId: contract.workPackageId,
          requiredDate: contract.requiredDate,
          owner: contract.owner,
        }
      : null,
    engineering: hasEngineering
      ? {
          engineeringObjectId: engineering.engineeringObjectId,
          tag: engineering.tag,
          revision: engineering.revision,
          status: engineering.status,
          drawingId: engineering.drawingId,
          schematicId: engineering.schematicId,
        }
      : null,
    sap: sap
      ? {
          materialNumber: sap.materialNumber,
          plant: sap.plant,
          availableQuantity: sap.availableQuantity,
          plantStatus: sap.plantStatus,
          fulfillmentStatus: sap.fulfillmentStatus,
        }
      : null,
    procurement: costpointOrder
      ? {
          note: `Costpoint PO ${costpointOrder.costpointOrderId} (in-process, /api/costpoint on this dyno).`,
          costpointOrderId: costpointOrder.costpointOrderId,
          erpStatus: costpointOrder.erpStatus,
          requestedDeliveryDate: costpointOrder.requestedDeliveryDate,
          expectedDeliveryDate: costpointOrder.expectedDeliveryDate,
          actualCost: costpointOrder.actualCost,
          configured: true,
        }
      : {
          note: "No Costpoint order exists yet for this equipment (in-process /api/costpoint has no matching order).",
          configured: true,
        },
    salesforce: {
      note: "This fabric has no Salesforce record-id map of its own. Configure SALESFORCE_DEEP_LINK_BASE to enable an 'Open in Salesforce' deep link.",
      deepLink: process.env.SALESFORCE_DEEP_LINK_BASE ? `${process.env.SALESFORCE_DEEP_LINK_BASE}${equipmentId}` : null,
    },
    consistency: {
      contract: consistencyMark(hasContract),
      engineering: consistencyMark(hasEngineering),
      sap: consistencyMark(!!sap),
      costpoint: consistencyMark(!!costpointOrder),
      salesforce: process.env.SALESFORCE_DEEP_LINK_BASE ? "OK" : "MISSING",
    },
    calculated: {
      fabricRiskIndicator: fabricRiskIndicator({ hasContract, hasEngineering, sapShortage }),
      fabricRiskIndicatorNote:
        "Derived from Contract + Engineering + SAP only (this dyno's own domains). NOT the PAPI risk engine's actual Program_Risk_Level__c -- that also weighs Costpoint schedule variance, which this console cannot see.",
      scheduleVarianceDays:
        costpointOrder && costpointOrder.expectedDeliveryDate !== costpointOrder.requestedDeliveryDate
          ? Math.round((new Date(costpointOrder.expectedDeliveryDate) - new Date(costpointOrder.requestedDeliveryDate)) / 86400000)
          : costpointOrder
          ? 0
          : null,
      scheduleVarianceNote: costpointOrder
        ? "expectedDeliveryDate - requestedDeliveryDate on the matched Costpoint order."
        : "Requires a Costpoint order for this equipment (see procurement.note above).",
    },
  };
}

module.exports = { resolveEquipmentId, getEquipment360 };
