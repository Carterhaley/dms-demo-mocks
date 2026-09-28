/* Scenarios: gallery, confirm-before-load modal, pipeline step viz, restore. */
const ScenariosView = (() => {
  function pipelineHtml(steps, badge) {
    return steps
      .map((s) => `<div class="pipeline-step">${badge(s.status)}<strong>${s.name}</strong><span class="muted">${s.detail || ""}</span></div>`)
      .join("");
  }

  function confirmLoad(def, ctx) {
    const { openModal, closeModal, toast, Api, App, role } = ctx;
    openModal(`
      <h2>${def.label}</h2>
      <p class="muted">Tag: ${def.tag} · Equipment: ${def.equipmentId} · Expected Risk: ${def.expectedRisk}</p>
      <h3>Mutations this will apply</h3>
      ${
        def.mutations.length
          ? def.mutations.map((m) => `<div class="diff-block"><span class="sys">${m.system}</span><div>${m.field}: <strong>${m.value}</strong></div></div>`).join("")
          : `<p class="muted">No mutation -- this scenario is inherent to the deterministic seed data.</p>`
      }
      <p class="muted">Systems affected: ${def.systemsAffected.join(", ") || "none"}</p>
      ${role === "operator" ? `<button id="confirm-load-btn" class="btn-primary">Load Scenario</button>` : `<p class="muted">Sign in as operator to load scenarios.</p>`}
    `);
    const btn = document.getElementById("confirm-load-btn");
    if (btn) {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          const result = await Api.loadScenario(def.id);
          closeModal();
          toast(`Scenario loaded: ${def.label}`);
          App.renderTab("scenarios");
        } catch (err) {
          toast(`Load failed: ${err.message}`, true);
          btn.disabled = false;
        }
      });
    }
  }

  async function render(container, ctx) {
    const { badge, Api, role } = ctx;
    const { scenarios, active } = await Api.scenarios();

    container.innerHTML = `
      ${
        active
          ? `<div class="panel">
              <h2>Active Scenario Pipeline — ${active.scenarioId}</h2>
              <div class="kv"><dt>Equipment</dt><dd>${active.equipmentId}</dd><dt>Loaded</dt><dd>${new Date(active.loadedAt).toLocaleTimeString()}</dd><dt>Correlation ID</dt><dd><code>${active.correlationId}</code></dd></div>
              <div style="margin-top:10px;">${pipelineHtml(active.steps, badge)}</div>
            </div>`
          : ""
      }
      <div class="group-heading">Scenario Gallery</div>
      <div class="grid grid-cards">
        ${scenarios
          .map(
            (s) => `
          <div class="card" data-id="${s.id}">
            <div class="card-row"><span class="card-title">${s.label}</span><span class="badge badge-SCENARIO">${s.tag}</span></div>
            <div class="card-row"><span class="muted">${s.equipmentId}</span><span class="muted">Risk: ${s.expectedRisk}</span></div>
            <div class="muted">${s.systemsAffected.join(", ") || "no mutation"}</div>
            ${s.currentlyApplied ? `<div style="margin-top:8px;">${badge("READY")} applied</div>` : ""}
          </div>`
          )
          .join("")}
      </div>
    `;

    container.querySelectorAll(".card").forEach((card) => {
      card.addEventListener("click", () => {
        const def = scenarios.find((s) => s.id === card.dataset.id);
        if (def.executor === "fabric" && def.currentlyApplied && role === "operator") {
          ctx.openModal(`
            <h2>${def.label}</h2>
            <p class="muted">Currently applied.</p>
            <button id="restore-btn" class="btn-secondary">Restore</button>
          `);
          document.getElementById("restore-btn").addEventListener("click", async () => {
            try {
              await Api.restoreScenario(def.id);
              ctx.closeModal();
              ctx.toast("Scenario restored.");
              ctx.App.renderTab("scenarios");
            } catch (err) {
              ctx.toast(`Restore failed: ${err.message}`, true);
            }
          });
        } else {
          confirmLoad(def, ctx);
        }
      });
    });
  }

  return { render };
})();
