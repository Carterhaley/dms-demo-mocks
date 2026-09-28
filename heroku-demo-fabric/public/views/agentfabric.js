/* Agent Fabric: status, capabilities, guided-determinism graph, MCP tools, governance. */
const AgentFabricView = (() => {
  function triBadge(v) {
    if (v === true) return `<span class="badge badge-READY">TRUE</span>`;
    if (v === false) return `<span class="badge badge-BLOCKING">FALSE</span>`;
    return `<span class="badge badge-UNVERIFIED">UNDOCUMENTED</span>`;
  }

  function graphHtml(nodes) {
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const roots = nodes.filter((n) => !n.parent);
    function renderNode(n, depth) {
      const children = nodes.filter((c) => c.parent === n.id);
      return `
        <div class="graph-node${depth > 0 ? " child" : ""}">
          <span class="badge badge-${n.dp}">${n.dp}</span>
          <strong>${n.label}</strong>
          <span class="muted">${n.detail || (n.tools ? "tools: " + n.tools.join(", ") : "")}</span>
        </div>
        ${children.map((c) => renderNode(c, depth + 1)).join("")}
      `;
    }
    return roots.map((n) => renderNode(n, 0)).join("");
  }

  async function render(container, ctx) {
    const { badge, Api, role, toast } = ctx;
    const [{ status, capabilities }, { tasks }, { tools }, { controls }] = await Promise.all([
      Api.agentStatus(),
      Api.agentTasks(),
      Api.mcpTools(),
      Api.governance(),
    ]);
    const task = tasks[0];

    container.innerHTML = `
      <div class="panel">
        <h2>Component Status</h2>
        <table>
          <thead><tr><th>Component</th><th>Configured</th><th>Runtime Verified</th><th>Reachable</th><th>Note</th></tr></thead>
          <tbody>
            ${Object.values(status)
              .map(
                (c) => `<tr><td>${c.name}</td><td>${triBadge(c.configured)}</td><td>${triBadge(c.runtimeVerified)}</td><td>${triBadge(c.reachableFromConsole)}</td><td class="muted">${c.note}</td></tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>

      <div class="panel">
        <h2>Domain Agent Capabilities</h2>
        <table>
          <thead><tr><th>Agent</th><th>Defined</th><th>Deployed</th><th>Reachable</th><th>Note</th></tr></thead>
          <tbody>
            ${capabilities
              .map(
                (c) => `<tr><td>${c.name}</td><td>${triBadge(c.defined)}</td><td>${triBadge(c.deployed)}</td><td>${triBadge(c.reachable)}</td><td class="muted">${c.note}</td></tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>

      <div class="panel">
        <h2>Guided Determinism — Reference Graph</h2>
        <p class="muted">${task.isLive ? "Live task." : "Static reference graph (not a live execution)."} Source: ${task.source}</p>
        <div>${graphHtml(task.nodes)}</div>
        ${
          task.gaps?.length
            ? `<div style="margin-top:12px;"><h3>Gaps</h3>${task.gaps.map((g) => `<p class="muted">- ${g}</p>`).join("")}</div>`
            : ""
        }
      </div>

      <div class="panel">
        <h2>MCP Tool Explorer</h2>
        <table>
          <thead><tr><th>Tool</th><th>Server</th><th>Classification</th><th>Description</th></tr></thead>
          <tbody>
            ${tools
              .map(
                (t) => `<tr><td>${t.name}</td><td>${t.server}</td><td>${badge(t.classification === "READ" ? "READY" : "BLOCKING")} <span class="muted">${t.classification}</span></td><td class="muted">${t.description}</td></tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>

      <div class="panel">
        <h2>Governance</h2>
        <table>
          <thead><tr><th>Control</th><th>Configured</th><th>Runtime Verified</th><th>Note</th></tr></thead>
          <tbody>
            ${controls
              .map(
                (c) => `<tr><td>${c.control}</td><td>${triBadge(c.configured)}</td><td>${triBadge(c.runtimeVerified)}</td><td class="muted">${c.note}</td></tr>`
              )
              .join("")}
          </tbody>
        </table>
        ${
          role === "operator"
            ? `<div style="margin-top:12px; display:flex; gap:8px;">
                <button id="pii-safe-btn" class="btn-secondary">Run Safe Test</button>
                <button id="pii-test-btn" class="btn-secondary">Run Synthetic PII Test</button>
              </div>
              <div id="pii-result" style="margin-top:12px;"></div>`
            : ""
        }
      </div>
    `;

    const resultEl = container.querySelector("#pii-result");
    async function runTest(mode) {
      try {
        const r = await Api.testPii(mode);
        resultEl.innerHTML = `
          <div class="diff-block">
            <div class="sys">SIMULATION</div>
            <p class="muted">${r.disclaimer}</p>
            <div class="kv"><dt>Input</dt><dd>${r.input}</dd><dt>Matched</dt><dd>${r.matchedPatterns.join(", ") || "none"}</dd><dt>Verdict</dt><dd>${r.verdict}</dd></div>
          </div>
        `;
      } catch (err) {
        toast(`Test failed: ${err.message}`, true);
      }
    }
    container.querySelector("#pii-safe-btn")?.addEventListener("click", () => runTest("safe"));
    container.querySelector("#pii-test-btn")?.addEventListener("click", () => runTest("pii"));
  }

  return { render };
})();
