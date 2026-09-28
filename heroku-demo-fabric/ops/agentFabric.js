/**
 * Agent Fabric monitor. This console cannot reach the broker/MCP gateway at
 * runtime (they run on the operator's local Mule instance, no public URL is
 * known/configured here) -- so this module reports what's genuinely
 * documented/verified-by-source-read in docs/CURRENT-STATE.md and
 * ARCHITECTURE.md, distinguishing CONFIGURED from RUNTIME_VERIFIED rather
 * than inventing green checks (spec section 28: "Do not mark an agent green
 * merely because configuration exists").
 *
 * Tool names/descriptions below are copied verbatim from
 * mule/tao213-agent-mcp-gateway/src/main/mule/tao213-agent-mcp-gateway.xml --
 * not guessed.
 */

const STATUS = {
  agentBroker: {
    name: "Agent Broker",
    configured: true,
    runtimeVerified: false,
    reachableFromConsole: false,
    note: "tao213-program-operations-broker: AgentScript published to Exchange and deployed to CloudHub per repo docs. Live cloud reachability was NOT tested this session (docs/CURRENT-STATE.md) and this console has no configured public URL for it.",
  },
  mcpGateway: {
    name: "MCP Gateway",
    configured: true,
    runtimeVerified: false,
    reachableFromConsole: false,
    note: "5 domain-scoped MCP server instances (SAP/Factory/Costpoint/Salesforce/PAPI), verified live via real MCP initialize/tools-list handshake on the operator's local Mule runtime this session -- but only from that machine. Not reachable from this Heroku dyno.",
  },
  llmProxy: {
    name: "LLM Proxy",
    configured: false,
    runtimeVerified: false,
    reachableFromConsole: false,
    note: "No Model Proxy / LLM Proxy configuration found in this repo. The broker calls a model directly (OpenAI GPT-5 Mini per docs/CURRENT-STATE.md), not through a governed Model Proxy. Not fabricated here.",
  },
  a2aEndpoint: {
    name: "A2A Endpoint",
    configured: true,
    runtimeVerified: false,
    reachableFromConsole: false,
    note: "Broker traffic is A2A protocol (agent-to-agent) per ARCHITECTURE.md. Endpoint reachability not verified from this console.",
  },
  piiPolicy: {
    name: "PII Policy",
    configured: true,
    runtimeVerified: false,
    reachableFromConsole: false,
    note: "A2A v1 PII Detector policy (action: Reject on Email/SSN/Credit Card/Phone) is applied to the broker's Flex Gateway API instance (id 21175180) per ARCHITECTURE.md. Confirmed by source read, NOT by a live API Manager query -- see docs/CURRENT-STATE.md's own 'CURRENT/UNVERIFIED' finding on this exact claim.",
  },
};

// Real domain agents that exist in brokers/tao213-program-operations.agent,
// plus the spec's target roles that do NOT exist yet -- listed explicitly so
// the gap is visible instead of silently omitted.
const CAPABILITIES = [
  { name: "SAP Agent", defined: true, deployed: true, reachable: false, runtimeVerified: false, note: "Tool-scoped to SAP MCP server only (materialAvailability, materialFulfillment)." },
  { name: "Factory Agent", defined: true, deployed: true, reachable: false, runtimeVerified: false, note: "Tool-scoped to Factory MCP server only (equipmentStatus, installationReadiness)." },
  { name: "Costpoint Agent", defined: true, deployed: true, reachable: false, runtimeVerified: false, note: "Tool-scoped to Costpoint MCP server only (orderStatus, projectActuals)." },
  { name: "Salesforce Agent", defined: true, deployed: true, reachable: false, runtimeVerified: false, note: "Tool-scoped to Salesforce MCP server only (getEquipmentProject, getEngineeringContext)." },
  { name: "Contract Agent", defined: false, deployed: false, reachable: false, runtimeVerified: false, note: "NOT BUILT. No Contract domain subagent exists in the broker yet, despite a Contract MCP server + getContractContext tool already existing." },
  { name: "Engineering Agent", defined: false, deployed: false, reachable: false, runtimeVerified: false, note: "NOT BUILT. getEngineeringContext exists as a tool but no dedicated Engineering domain subagent routes to it." },
  { name: "Program Risk Agent", defined: false, deployed: false, reachable: false, runtimeVerified: false, note: "NOT BUILT. Today each domain agent answers independently -- nothing synthesizes Contract + Engineering + Procurement signals into one cross-domain risk explanation." },
];

const MCP_TOOLS = [
  { name: "materialAvailability", server: "SAP MCP", classification: "READ", description: "Get SAP material availability status for a T-AO 213 equipment item." },
  { name: "materialFulfillment", server: "SAP MCP", classification: "READ", description: "Get SAP material fulfillment/delivery detail for a T-AO 213 equipment item." },
  { name: "equipmentStatus", server: "Factory MCP", classification: "READ", description: "Get Digital Factory production/QA status for a T-AO 213 equipment item." },
  { name: "installationReadiness", server: "Factory MCP", classification: "READ", description: "Get Digital Factory installation-readiness status for a T-AO 213 installation." },
  { name: "orderStatus", server: "Costpoint MCP", classification: "READ", description: "Get Costpoint purchase order status for a T-AO 213 equipment order." },
  { name: "projectActuals", server: "Costpoint MCP", classification: "READ", description: "Get Costpoint actual cost detail for a T-AO 213 project." },
  { name: "getEquipmentProject", server: "Salesforce MCP", classification: "READ", description: "Get the Salesforce Equipment_Project__c record (status, dates, risk fields)." },
  { name: "getEngineeringContext", server: "Salesforce MCP", classification: "READ", description: "Get engineering context (drawing, schematic, installation, revision, status). MOCK Engineering Demo Adapter." },
  { name: "getContractContext", server: "Contract MCP", classification: "READ", description: "Get contract obligation context (required date, owner, work package, milestone). MOCK Ironclad backend." },
  { name: "resolveEquipmentId", server: "PAPI MCP", classification: "READ", description: "Deterministically resolve free-text equipment references to a canonical equipmentId. Pure lookup, no LLM judgment." },
  { name: "getEquipment360", server: "PAPI MCP", classification: "READ", description: "Get the Equipment 360 view: contract obligation, latest Salesforce snapshot, deterministic risk level, schedule variance." },
  { name: "submitEquipmentProject", server: "PAPI MCP", classification: "CONSEQUENTIAL_WRITE", description: "Submit a T-AO 213 equipment project for cross-system processing. Idempotent per equipmentProjectId. The broker's only irreversible action, gated by a deterministic submitGate with no LLM step in between." },
];

function referenceTask() {
  return {
    isLive: false,
    source: "mule/tao213-program-operations-broker/brokers/tao213-program-operations.agent (static source read, not a captured live execution -- this console cannot reach the broker's runtime)",
    taskId: null,
    userRequest: "(reference graph, not a live task)",
    nodes: [
      { id: "classifyDomain", type: "generator", dp: "P", label: "Classify request domain", detail: "LLM classifies into sap | factory | costpoint | salesforce | submit | unknown" },
      { id: "domainRouter", type: "router", dp: "D", label: "Route to domain", parent: "classifyDomain" },
      { id: "sapAgent", type: "subagent", dp: "P", label: "SAP Agent", parent: "domainRouter", tools: ["materialAvailability", "materialFulfillment"] },
      { id: "factoryAgent", type: "subagent", dp: "P", label: "Factory Agent", parent: "domainRouter", tools: ["equipmentStatus", "installationReadiness"] },
      { id: "costpointAgent", type: "subagent", dp: "P", label: "Costpoint Agent", parent: "domainRouter", tools: ["orderStatus", "projectActuals"] },
      { id: "salesforceAgent", type: "subagent", dp: "P", label: "Salesforce Agent", parent: "domainRouter", tools: ["getEquipmentProject", "getEngineeringContext"] },
      { id: "extractSubmitId", type: "generator", dp: "P", label: "Extract submit id", parent: "domainRouter", detail: "Pulls an equipmentProjectId out of free text" },
      { id: "submitGate", type: "router", dp: "D", label: "Submit gate", parent: "extractSubmitId", detail: "Only proceeds if a non-empty id was extracted -- no LLM step between gate and the irreversible action" },
      { id: "submitProject", type: "executor", dp: "D", label: "Submit equipment project", parent: "submitGate", tools: ["submitEquipmentProject"], detail: "The broker's one irreversible action" },
      { id: "clarifyResponse", type: "fallback", dp: "D", label: "Clarify / unknown", parent: "domainRouter" },
    ],
    gaps: [
      "No Contract or Engineering domain subagent exists yet, despite the underlying MCP tools (getContractContext, getEngineeringContext) already existing.",
      "No Program Risk Agent synthesizes cross-domain (Contract + Engineering + Procurement) risk -- each domain agent answers independently today.",
    ],
  };
}

module.exports = { STATUS, CAPABILITIES, MCP_TOOLS, referenceTask };
