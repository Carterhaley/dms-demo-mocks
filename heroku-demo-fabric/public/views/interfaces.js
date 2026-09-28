/* Interfaces: grouped cards, detail drawer with Test/Inspect/Copy Correlation ID. */
const InterfacesView = (() => {
  const GROUP_LABELS = {
    MULESOFT_XAPI: "MuleSoft — Experience API",
    MULESOFT_PAPI: "MuleSoft — Process API",
    MULESOFT_SAPI: "MuleSoft — System APIs",
    SOURCE_SYSTEMS: "Source / Demo Systems",
    AGENT_PLATFORM: "Agent Platform",
  };

  function groupOrder(list) {
    const order = ["MULESOFT_XAPI", "MULESOFT_PAPI", "MULESOFT_SAPI", "SOURCE_SYSTEMS", "AGENT_PLATFORM"];
    return order.filter((g) => list.some((i) => i.group === g));
  }

  async function openDetail(id, ctx) {
    const { Api, badge, openDrawer, toast, role } = ctx;
    const detail = await Api.interfaceDetail(id);
    render(detail);

    function render(d) {
      openDrawer(`
        <h2>${d.name}</h2>
        <div class="kv">
          <dt>Status</dt><dd>${badge(d.status)}</dd>
          <dt>Criticality</dt><dd>${badge(d.criticality)}</dd>
          <dt>Type</dt><dd>${d.type}</dd>
          <dt>URL</dt><dd>${d.url || "<span class=\"muted\">not configured</span>"}</dd>
          <dt>HTTP Status</dt><dd>${d.httpStatus ?? "—"}</dd>
          <dt>Latency</dt><dd>${d.latencyMs != null ? d.latencyMs + "ms" : "—"}</dd>
          <dt>Last Check</dt><dd>${d.lastCheck ? new Date(d.lastCheck).toLocaleTimeString() : "—"}</dd>
          <dt>Upstream</dt><dd>${d.upstream?.join(", ") || "—"}</dd>
          <dt>Downstream</dt><dd>${d.downstream?.join(", ") || "—"}</dd>
        </div>
        ${d.reason ? `<div class="panel" style="margin-top:12px;"><h3>Reason</h3><p class="muted">${d.reason}</p></div>` : ""}
        <div style="margin-top:12px; display:flex; gap:8px;">
          ${role === "operator" ? `<button id="detail-test-btn" class="btn-secondary">Run Test</button>` : ""}
        </div>
        <div class="panel" style="margin-top:16px;">
          <h3>Recent Events</h3>
          ${
            d.recentEvents?.length
              ? `<table><thead><tr><th>Time</th><th>Op</th><th>Status</th><th>Corr. ID</th></tr></thead><tbody>
                  ${d.recentEvents.map((e) => `<tr><td>${new Date(e.timestamp).toLocaleTimeString()}</td><td>${e.operation}</td><td>${e.status}</td><td><code class="copy-corr" data-corr="${e.correlationId}" style="cursor:pointer;">${e.correlationId}</code></td></tr>`).join("")}
                 </tbody></table>`
              : `<p class="muted">No recent events recorded through this console.</p>`
          }
        </div>
      `);

      const testBtn = document.getElementById("detail-test-btn");
      if (testBtn) {
        testBtn.addEventListener("click", async () => {
          testBtn.disabled = true;
          try {
            const result = await Api.testInterface(id);
            toast(`Test complete: ${result.status}`);
            const fresh = await Api.interfaceDetail(id);
            render(fresh);
          } catch (err) {
            toast(`Test failed: ${err.message}`, true);
          } finally {
            testBtn.disabled = false;
          }
        });
      }
      for (const el of document.querySelectorAll(".copy-corr")) {
        el.addEventListener("click", () => {
          navigator.clipboard?.writeText(el.dataset.corr);
          toast("Correlation ID copied.");
        });
      }
    }
  }

  async function render(container, ctx) {
    const { badge } = ctx;
    const { interfaces } = await ctx.Api.interfaces();
    const groups = groupOrder(interfaces);

    container.innerHTML = groups
      .map((g) => {
        const items = interfaces.filter((i) => i.group === g);
        return `
          <div class="group-heading">${GROUP_LABELS[g] || g}</div>
          <div class="grid grid-cards">
            ${items
              .map(
                (i) => `
              <div class="card" data-id="${i.id}">
                <div class="card-row"><span class="card-title">${i.name}</span>${badge(i.status)}</div>
                <div class="card-row"><span class="muted">${i.type}</span>${badge(i.criticality)}</div>
                <div class="muted">${i.url || "no endpoint configured"}</div>
              </div>`
              )
              .join("")}
          </div>
        `;
      })
      .join("");

    container.querySelectorAll(".card").forEach((card) => {
      card.addEventListener("click", () => openDetail(card.dataset.id, ctx));
    });
  }

  return { render };
})();
