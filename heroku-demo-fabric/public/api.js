/* Thin fetch wrapper for /ops/* -- cookie session auth, CSRF header on writes. */
const Api = (() => {
  async function req(method, path, body) {
    const opts = {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
    };
    if (method !== "GET") opts.headers["X-Ops-Request"] = "1";
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (res.status === 401) {
      const err = new Error("UNAUTHENTICATED");
      err.status = 401;
      throw err;
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* no body */ }
    if (!res.ok) {
      const err = new Error(data?.message || data?.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  return {
    get: (path) => req("GET", path),
    post: (path, body) => req("POST", path, body ?? {}),

    session: () => req("GET", "/ops/auth/session"),
    login: (password) => req("POST", "/ops/auth/login", { password }),
    logout: () => req("POST", "/ops/auth/logout"),

    status: () => req("GET", "/ops/status"),
    interfaces: () => req("GET", "/ops/interfaces"),
    interfaceDetail: (id) => req("GET", `/ops/interfaces/${id}`),
    testInterface: (id) => req("POST", `/ops/interfaces/${id}/test`),

    scenarios: () => req("GET", "/ops/scenarios"),
    scenarioStatus: (id) => req("GET", `/ops/scenarios/${id}/status`),
    loadScenario: (id) => req("POST", `/ops/scenarios/${id}/load`),
    restoreScenario: (id) => req("POST", `/ops/scenarios/${id}/restore`),

    reset: () => req("POST", "/ops/reset", { confirm: "RESET" }),

    equipmentSearch: (q) => req("GET", `/ops/equipment?q=${encodeURIComponent(q)}`),
    equipment: (id) => req("GET", `/ops/equipment/${id}`),

    agentStatus: () => req("GET", "/ops/agents/status"),
    agentTasks: () => req("GET", "/ops/agents/tasks"),
    agentTask: (id) => req("GET", `/ops/agents/tasks/${id}`),
    mcpTools: () => req("GET", "/ops/agents/mcp-tools"),

    governance: () => req("GET", "/ops/governance"),
    testPii: (mode) => req("POST", "/ops/governance/test/pii", { mode }),

    traces: (params) => req("GET", `/ops/traces${params ? "?" + new URLSearchParams(params) : ""}`),
    traceByCorrelation: (id) => req("GET", `/ops/traces/${encodeURIComponent(id)}`),

    audit: () => req("GET", "/ops/audit"),

    events(onEvent) {
      const es = new EventSource("/ops/events");
      const types = ["activity", "scenario:started", "scenario:completed", "reset:completed"];
      for (const t of types) es.addEventListener(t, (e) => onEvent(t, JSON.parse(e.data)));
      return es;
    },
  };
})();
