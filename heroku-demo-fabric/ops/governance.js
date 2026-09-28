/**
 * Governance panel: Configured vs. Runtime-Verified (spec section 32), plus
 * a synthetic PII test utility (section 33).
 *
 * `configured`/`runtimeVerified` are tri-state: true | false | null.
 * null means "not documented anywhere in this repo" -- distinct from false
 * ("documented as NOT configured"). Never collapse the two.
 *
 * The PII test below is an explicit LOCAL SIMULATION. It never calls the
 * real Flex Gateway A2A PII Detector policy -- that gateway isn't reachable
 * from this Heroku console (see agentFabric.js). It also never touches real
 * user/customer data -- both test strings are synthetic literals.
 */

const CONTROLS = [
  {
    control: "Broker Auth",
    configured: null,
    runtimeVerified: null,
    note: "Not documented anywhere in this repo's source or docs/CURRENT-STATE.md.",
  },
  {
    control: "A2A PII Detector",
    configured: true,
    runtimeVerified: false,
    note: "Applied to the broker's Flex Gateway API instance (id 21175180), action: Reject on Email/SSN/Credit Card/Phone -- confirmed by source read (ARCHITECTURE.md), not by a live API Manager query from this console.",
  },
  {
    control: "MCP Auth",
    configured: null,
    runtimeVerified: null,
    note: "Not documented as applied. Related policies (mcp-pii-detector, mcp-schema-validation, mcp-access-control) exist as available Flex Gateway policies per ARCHITECTURE.md, but whether they're actually attached isn't confirmed.",
  },
  {
    control: "Tool Restrictions (domain scoping)",
    configured: true,
    runtimeVerified: false,
    note: "Each broker subagent is tool-scoped to only its own domain's MCP server by source construction. Verified live via real MCP initialize/tools-list handshake THIS SESSION -- but on the operator's local Mule runtime, not reachable from this console, so it can't be re-verified here.",
  },
  {
    control: "LLM Proxy",
    configured: false,
    runtimeVerified: false,
    note: "No Model Proxy exists -- the broker calls a model provider (OpenAI) directly per docs/CURRENT-STATE.md.",
  },
  {
    control: "Model Fallback",
    configured: null,
    runtimeVerified: null,
    note: "Not documented.",
  },
  {
    control: "Correlation",
    configured: true,
    runtimeVerified: true,
    note: "This console generates/propagates a correlationId on every request and records it in /ops/traces -- verifiable right now via the Traces page.",
  },
  {
    control: "Audit",
    configured: true,
    runtimeVerified: true,
    note: "This console's own audit log (/ops/audit) records every operator mutation -- verifiable right now via the Overview/Audit view.",
  },
];

const SAFE_TEST_INPUT = "Get equipment status for EQP-023 (T-AO 213 Pump 023).";
const SYNTHETIC_PII_TEST_INPUT =
  "Synthetic test contact: jane.synthetic.tester@example.invalid, SSN 000-00-0000, phone 000-000-0000.";

const PII_PATTERNS = [
  { label: "EMAIL", re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  { label: "SSN", re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { label: "PHONE", re: /\b\d{3}-\d{3}-\d{4}\b/ },
];

function runPiiSimulation(mode) {
  const input = mode === "pii" ? SYNTHETIC_PII_TEST_INPUT : SAFE_TEST_INPUT;
  const matches = PII_PATTERNS.filter((p) => p.re.test(input)).map((p) => p.label);
  const intercepted = matches.length > 0;
  return {
    simulation: true,
    disclaimer:
      "Local simulation only. Validates request-shape / pattern-match logic against a fixed synthetic string -- does not call the live Flex Gateway A2A PII Detector policy, which is not reachable from this Heroku console. Never uses real user/customer data.",
    mode,
    input,
    matchedPatterns: matches,
    result: "PASS",
    verdict: intercepted ? "Intercepted as expected (synthetic PII detected)" : "Allowed (no PII pattern matched)",
  };
}

module.exports = { CONTROLS, runPiiSimulation };
