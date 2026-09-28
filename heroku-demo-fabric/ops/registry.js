/**
 * Central interface + scenario + equipment-domain registry for the T-AO 213
 * Integration Control Center. UI renders from this, nothing is hardcoded in
 * frontend markup (spec section 42).
 *
 * `mode` distinguishes how health is actually determined:
 *  - "self"  -- this dyno's own in-process domain (sap/contracts/engineering).
 *              Always checkable with zero network hop.
 *  - "http"  -- an HTTP health check against `url`. If `url` resolves to a
 *              localhost/127.0.0.1/private host, the health aggregator will
 *              NOT attempt the call -- a Heroku dyno can never reach a
 *              laptop's localhost, so pretending to "try and fail" would
 *              misreport a routing impossibility as an outage. Those report
 *              UNVERIFIED with an explicit reason instead.
 *  - "none"  -- no HTTP surface (e.g. the Agent Broker is AgentScript, not a
 *              listener). Status is config-derived only.
 */

function isLocalOnly(url) {
  if (!url) return true;
  try {
    const u = new URL(url);
    const h = u.hostname;
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "::1" ||
      h.endsWith(".local")
    );
  } catch {
    return true;
  }
}

function envUrl(name, fallback) {
  return process.env[name] || fallback;
}

const INTERFACES = [
  // --- MuleSoft: Experience + Process API -----------------------------------
  {
    id: "xapi-equipment",
    name: "XAPI Equipment",
    group: "MULESOFT_XAPI",
    type: "EXPERIENCE_API",
    criticality: "CORE",
    mode: "http",
    url: envUrl("XAPI_URL", "http://localhost:8084/api"),
    healthPath: "/health",
    upstream: ["Salesforce"],
    downstream: ["papi-equipment"],
  },
  {
    id: "papi-equipment",
    name: "PAPI Equipment",
    group: "MULESOFT_PAPI",
    type: "PROCESS_API",
    criticality: "CORE",
    mode: "http",
    url: envUrl("PAPI_URL", "http://localhost:8083/api"),
    healthPath: "/health",
    upstream: ["xapi-equipment"],
    downstream: ["costpoint-sapi", "salesforce-sapi", "sap-sapi", "digital-factory-sapi", "contract-sapi"],
  },
  // --- MuleSoft: System APIs -------------------------------------------------
  {
    id: "costpoint-sapi",
    name: "Costpoint SAPI",
    group: "MULESOFT_SAPI",
    type: "SYSTEM_API",
    criticality: "CORE",
    mode: "http",
    url: envUrl("COSTPOINT_SAPI_URL", "http://localhost:8081/api"),
    healthPath: "/health",
    upstream: ["papi-equipment"],
    downstream: ["costpoint-demo"],
  },
  {
    id: "salesforce-sapi",
    name: "Salesforce SAPI",
    group: "MULESOFT_SAPI",
    type: "SYSTEM_API",
    criticality: "CORE",
    mode: "http",
    url: envUrl("SALESFORCE_SAPI_URL", "http://localhost:8082/api"),
    healthPath: "/health",
    upstream: ["papi-equipment"],
    downstream: ["salesforce"],
  },
  {
    id: "sap-sapi",
    name: "SAP SAPI",
    group: "MULESOFT_SAPI",
    type: "SYSTEM_API",
    criticality: "OPTIONAL",
    mode: "http",
    url: envUrl("SAP_SAPI_URL", "http://localhost:8085/api"),
    healthPath: "/health",
    upstream: ["papi-equipment"],
    downstream: ["sap-demo"],
    sapSpecial: true,
  },
  {
    id: "digital-factory-sapi",
    name: "Digital Factory SAPI",
    group: "MULESOFT_SAPI",
    type: "SYSTEM_API",
    criticality: "OPTIONAL",
    mode: "http",
    url: envUrl("DIGITAL_FACTORY_SAPI_URL", "http://localhost:8086/api"),
    healthPath: "/health",
    upstream: ["papi-equipment"],
    downstream: ["digital-factory-demo"],
  },
  {
    id: "contract-sapi",
    name: "Contract SAPI",
    group: "MULESOFT_SAPI",
    type: "SYSTEM_API",
    criticality: "SCENARIO",
    mode: "http",
    url: envUrl("CONTRACT_SAPI_URL", "http://localhost:8087/api"),
    healthPath: "/health",
    upstream: ["papi-equipment"],
    downstream: ["contract-demo"],
  },
  // --- Source / Demo systems --------------------------------------------------
  {
    id: "salesforce",
    name: "Salesforce",
    group: "SOURCE_SYSTEMS",
    type: "SOURCE_SYSTEM",
    criticality: "CORE",
    mode: "http",
    url: envUrl("SALESFORCE_ORG_URL", ""),
    healthPath: "",
    upstream: [],
    downstream: [],
  },
  {
    id: "costpoint-demo",
    name: "Costpoint Demo",
    group: "SOURCE_SYSTEMS",
    type: "DEMO_MOCK",
    criticality: "CORE",
    mode: "self",
    selfDomain: "costpoint",
    upstream: ["costpoint-sapi"],
    downstream: [],
  },
  {
    id: "contract-demo",
    name: "Contract / Ironclad Demo",
    group: "SOURCE_SYSTEMS",
    type: "DEMO_MOCK",
    criticality: "SCENARIO",
    mode: "self",
    selfDomain: "contracts",
    upstream: ["contract-sapi"],
    downstream: [],
  },
  {
    id: "engineering-demo",
    name: "Engineering / AVEVA Demo",
    group: "SOURCE_SYSTEMS",
    type: "DEMO_MOCK",
    criticality: "SCENARIO",
    mode: "self",
    selfDomain: "engineering",
    upstream: [],
    downstream: [],
  },
  {
    id: "sap-demo",
    name: "SAP Demo",
    group: "SOURCE_SYSTEMS",
    type: "DEMO_MOCK",
    criticality: "OPTIONAL",
    mode: "self",
    selfDomain: "sap",
    upstream: ["sap-sapi"],
    downstream: [],
    sapSpecial: true,
  },
  {
    id: "digital-factory-demo",
    name: "Digital Factory",
    group: "SOURCE_SYSTEMS",
    type: "DEMO_SYSTEM",
    criticality: "OPTIONAL",
    mode: "http",
    url: envUrl("DIGITAL_FACTORY_DB_HEALTH_URL", ""),
    healthPath: "",
    upstream: ["digital-factory-sapi"],
    downstream: [],
  },
  // --- Agent platform ----------------------------------------------------------
  {
    id: "agent-broker",
    name: "Agent Broker",
    group: "AGENT_PLATFORM",
    type: "AGENT_NETWORK",
    criticality: "SCENARIO",
    mode: "none",
    upstream: [],
    downstream: ["mcp-sap", "mcp-factory", "mcp-costpoint", "mcp-salesforce", "mcp-papi"],
  },
  {
    id: "mcp-gateway",
    name: "MCP Gateway",
    group: "AGENT_PLATFORM",
    type: "MCP_GATEWAY",
    criticality: "SCENARIO",
    mode: "http",
    url: envUrl("MCP_GATEWAY_URL", "http://localhost:8090/mcp"),
    healthPath: "",
    upstream: ["agent-broker"],
    downstream: ["sap-sapi", "digital-factory-sapi", "costpoint-sapi", "salesforce-sapi", "papi-equipment"],
  },
  {
    id: "llm-proxy",
    name: "LLM Proxy",
    group: "AGENT_PLATFORM",
    type: "MODEL_PROXY",
    criticality: "OPTIONAL",
    mode: "http",
    url: envUrl("LLM_PROXY_URL", ""),
    healthPath: "",
    upstream: ["agent-broker"],
    downstream: [],
  },
  {
    id: "a2a-endpoint",
    name: "A2A Endpoint",
    group: "AGENT_PLATFORM",
    type: "A2A",
    criticality: "OPTIONAL",
    mode: "none",
    upstream: ["agent-broker"],
    downstream: [],
  },
];

const SCENARIOS = [
  {
    id: "pump023-contract-delivery-risk",
    label: "Pump 023 — Contract Delivery Risk",
    tag: "NORTH_STAR",
    equipmentId: "EQP-023",
    expectedRisk: "RED",
    systemsAffected: ["Contract", "Engineering", "Costpoint", "Mule Sync", "Salesforce"],
    mutations: [
      { system: "CONTRACT", field: "Required Date", value: "2027-03-19 (seed)" },
      { system: "ENGINEERING", field: "Status / Revision", value: "RELEASED / Rev D (seed)" },
      { system: "COSTPOINT", field: "Forecast Delivery", value: "+21 days via pump023-delay.sh" },
    ],
    executor: "pump023",
  },
  {
    id: "engineering-change-eqp041",
    label: "Engineering Change — EQP-041",
    tag: "ENGINEERING_CHANGE",
    equipmentId: "EQP-041",
    expectedRisk: "AMBER",
    systemsAffected: ["Engineering"],
    mutations: [{ system: "ENGINEERING", field: "Status", value: "PENDING_CHANGE (was RELEASED)" }],
    executor: "fabric",
    fabricKey: "engineering-change",
  },
  {
    id: "sap-shortage-eqp057",
    label: "SAP Shortage — EQP-057",
    tag: "SAP_SHORTAGE",
    equipmentId: "EQP-057",
    expectedRisk: "AMBER/RED",
    systemsAffected: ["SAP"],
    mutations: [{ system: "SAP", field: "Available Quantity / Status", value: "0 / SHORTAGE" }],
    executor: "fabric",
    fabricKey: "sap-shortage",
  },
  {
    id: "no-contract-eqp066",
    label: "No Contract — EQP-066",
    tag: "NO_CONTRACT",
    equipmentId: "EQP-066",
    expectedRisk: "UNVERIFIED",
    systemsAffected: ["Contract"],
    mutations: [{ system: "CONTRACT", field: "Obligation", value: "removed" }],
    executor: "fabric",
    fabricKey: "no-contract",
  },
  {
    id: "no-engineering-eqp095",
    label: "No Engineering — EQP-095",
    tag: "NO_ENGINEERING",
    equipmentId: "EQP-095",
    expectedRisk: "AMBER",
    systemsAffected: ["Engineering"],
    mutations: [],
    executor: "inherent",
  },
  {
    id: "healthy-control-eqp002",
    label: "Healthy Control — EQP-002",
    tag: "HEALTHY",
    equipmentId: "EQP-002",
    expectedRisk: "GREEN",
    systemsAffected: [],
    mutations: [],
    executor: "inherent",
  },
];

module.exports = { INTERFACES, SCENARIOS, isLocalOnly };
