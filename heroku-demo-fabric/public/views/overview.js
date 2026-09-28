/* Overview: readiness banner, scenario status, active scenario, activity feed. */
const OverviewView = (() => {
  let feedEl = null;

  function row(at, message) {
    return `<div class="activity-row"><span class="ts">${new Date(at).toLocaleTimeString()}</span><span>${message}</span></div>`;
  }

  async function render(container, { badge, Api }) {
    const [status, audit] = await Promise.all([Api.status(), Api.audit()]);

    container.innerHTML = `
      <div class="panel">
        <h2>Demo Readiness</h2>
        <div class="kv">
          <dt>Core Demo</dt><dd>${badge(status.coreDemo)}</dd>
          <dt>Environment</dt><dd>${status.environment}</dd>
          <dt>Heroku Status</dt><dd>${badge(status.herokuStatus)}</dd>
          <dt>Last Reset</dt><dd>${new Date(status.lastReset).toLocaleString()}</dd>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="panel">
          <h2>Scenario Domain Status</h2>
          <div class="kv">
            <dt>Contract</dt><dd>${badge(status.scenarios.contract)}</dd>
            <dt>Engineering</dt><dd>${badge(status.scenarios.engineering)}</dd>
            <dt>SAP</dt><dd>${badge(status.scenarios.sap)}</dd>
            <dt>Agent</dt><dd>${badge(status.scenarios.agent)}</dd>
          </div>
        </div>
        <div class="panel">
          <h2>Active Scenario</h2>
          ${
            status.activeScenario
              ? `<div class="kv">
                  <dt>Scenario</dt><dd>${status.activeScenario.scenarioId}</dd>
                  <dt>Equipment</dt><dd>${status.activeScenario.equipmentId}</dd>
                  <dt>Loaded</dt><dd>${new Date(status.activeScenario.loadedAt).toLocaleTimeString()}</dd>
                  <dt>Expected Risk</dt><dd>${status.activeScenario.expectedRisk}</dd>
                </div>`
              : `<p class="muted">No scenario currently loaded. Go to Scenarios to load one.</p>`
          }
        </div>
      </div>

      <div class="panel">
        <h2>Recent Activity (live)</h2>
        <div class="activity-feed" id="activity-feed">
          ${audit.entries.slice(0, 15).reverse().map((e) => row(e.at, `${e.operator || "system"} ${e.action} ${e.equipmentId || ""} -> ${e.result}`)).join("") || `<p class="muted">No activity yet.</p>`}
        </div>
      </div>
    `;
    feedEl = container.querySelector("#activity-feed");
  }

  function onEvent(type, payload) {
    if (!feedEl) return;
    const label =
      type === "activity" ? payload.message :
      type === "scenario:started" ? `scenario ${payload.scenarioId} started (${payload.equipmentId})` :
      type === "scenario:completed" ? `scenario ${payload.scenarioId} completed` :
      type === "reset:completed" ? `demo reset` : type;
    feedEl.insertAdjacentHTML("afterbegin", row(payload.at || new Date().toISOString(), label));
  }

  return { render, onEvent };
})();
