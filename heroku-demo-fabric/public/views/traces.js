/* Traces: search by correlationId/equipmentId, timeline display. Scope note up top. */
const TracesView = (() => {
  function timelineHtml(events) {
    if (!events.length) return `<p class="muted">No events found.</p>`;
    return `
      <table>
        <thead><tr><th>Time</th><th>Component</th><th>Domain</th><th>Operation</th><th>Status</th><th>HTTP</th><th>ms</th><th>Equipment</th><th>Correlation ID</th></tr></thead>
        <tbody>
          ${events
            .map(
              (e) => `<tr>
                <td>${new Date(e.timestamp).toLocaleTimeString()}</td>
                <td>${e.component}</td>
                <td class="muted">${e.domain}</td>
                <td>${e.operation}</td>
                <td>${e.status}</td>
                <td>${e.httpStatus}</td>
                <td>${e.durationMs}</td>
                <td>${e.equipmentId || "—"}</td>
                <td><code class="copy-corr" data-corr="${e.correlationId}" style="cursor:pointer;">${e.correlationId}</code></td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  async function render(container, ctx) {
    const { Api, toast } = ctx;
    const initial = await Api.traces();

    container.innerHTML = `
      <div class="panel">
        <h2>Trace Search</h2>
        <p class="muted">Scope: only hops through this Heroku dyno (its own /api, /demo, /ops routes). XAPI/PAPI/Broker hops on the operator's local Mule runtime are not visible here.</p>
        <div style="display:flex; gap:8px;">
          <input id="trace-corr-input" placeholder="Correlation ID" style="flex:1;" />
          <input id="trace-eqp-input" placeholder="Equipment ID (e.g. EQP-023)" style="flex:1;" />
          <button id="trace-search-btn" class="btn-primary">Search</button>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="panel">
          <h3>Recent Correlation IDs</h3>
          <div id="corr-list">
            ${initial.correlationIds
              .map((c) => `<div class="card-row"><code class="copy-corr" data-corr="${c.correlationId}" style="cursor:pointer;">${c.correlationId}</code><span class="muted">${new Date(c.timestamp).toLocaleTimeString()}</span></div>`)
              .join("") || `<p class="muted">None yet.</p>`}
          </div>
        </div>
        <div class="panel">
          <h3>Timeline</h3>
          <div id="trace-timeline">${timelineHtml(initial.events)}</div>
        </div>
      </div>
    `;

    async function search() {
      const correlationId = container.querySelector("#trace-corr-input").value.trim();
      const equipmentId = container.querySelector("#trace-eqp-input").value.trim();
      const params = {};
      if (correlationId) params.correlationId = correlationId;
      if (equipmentId) params.equipmentId = equipmentId;
      const result = await Api.traces(params);
      container.querySelector("#trace-timeline").innerHTML = timelineHtml(result.events);
    }

    container.querySelector("#trace-search-btn").addEventListener("click", search);
    container.querySelectorAll(".copy-corr").forEach((el) => {
      el.addEventListener("click", () => {
        navigator.clipboard?.writeText(el.dataset.corr);
        container.querySelector("#trace-corr-input").value = el.dataset.corr;
        toast("Correlation ID copied and applied to search.");
        search();
      });
    });
  }

  return { render };
})();
