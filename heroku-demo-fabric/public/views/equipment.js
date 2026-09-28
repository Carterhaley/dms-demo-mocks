/* Equipment 360: search, canonical identity, per-domain sections, consistency marks. */
const EquipmentView = (() => {
  function mark(status) {
    return status === "OK" ? `<span class="badge badge-OK">OK</span>` : `<span class="badge badge-BLOCKING">MISSING</span>`;
  }

  function render360(record) {
    if (!record) return `<p class="error">Not resolvable from this console.</p>`;
    return `
      <div class="panel">
        <h2>${record.equipmentId}</h2>
        <div class="kv">
          <dt>Program</dt><dd>${record.identity.program}</dd>
          <dt>Installation</dt><dd>${record.identity.installation || "—"}</dd>
          <dt>Fabric Risk</dt><dd><span class="badge badge-${record.calculated.fabricRiskIndicator === "GREEN" ? "READY" : record.calculated.fabricRiskIndicator === "RED" ? "BLOCKING" : "DEGRADED"}">${record.calculated.fabricRiskIndicator}</span></dd>
        </div>
        <p class="muted">${record.calculated.fabricRiskIndicatorNote}</p>
      </div>

      <div class="grid grid-3">
        <div class="panel">
          <h3>Contract ${mark(record.consistency.contract)}</h3>
          ${
            record.contract
              ? `<div class="kv"><dt>Obligation</dt><dd>${record.contract.obligationId}</dd><dt>Work Pkg</dt><dd>${record.contract.workPackageId}</dd><dt>Required Date</dt><dd>${record.contract.requiredDate}</dd><dt>Owner</dt><dd>${record.contract.owner}</dd></div>`
              : `<p class="muted">No contract obligation mapped.</p>`
          }
        </div>
        <div class="panel">
          <h3>Engineering ${mark(record.consistency.engineering)}</h3>
          ${
            record.engineering
              ? `<div class="kv"><dt>Tag</dt><dd>${record.engineering.tag}</dd><dt>Revision</dt><dd>${record.engineering.revision}</dd><dt>Status</dt><dd>${record.engineering.status}</dd><dt>Drawing</dt><dd>${record.engineering.drawingId}</dd></div>`
              : `<p class="muted">No engineering record.</p>`
          }
        </div>
        <div class="panel">
          <h3>SAP ${mark(record.consistency.sap)}</h3>
          ${
            record.sap
              ? `<div class="kv"><dt>Material</dt><dd>${record.sap.materialNumber}</dd><dt>Plant</dt><dd>${record.sap.plant}</dd><dt>Avail. Qty</dt><dd>${record.sap.availableQuantity}</dd><dt>Status</dt><dd>${record.sap.plantStatus}</dd></div>`
              : `<p class="muted">No SAP record.</p>`
          }
        </div>
      </div>

      <div class="grid grid-2">
        <div class="panel">
          <h3>Procurement (Costpoint) ${mark(record.consistency.costpoint)}</h3>
          <p class="muted">${record.procurement.note}</p>
        </div>
        <div class="panel">
          <h3>Salesforce ${mark(record.consistency.salesforce)}</h3>
          <p class="muted">${record.salesforce.note}</p>
          ${record.salesforce.deepLink ? `<a href="${record.salesforce.deepLink}" target="_blank" rel="noopener">Open in Salesforce</a>` : ""}
        </div>
      </div>
    `;
  }

  async function render(container, ctx) {
    container.innerHTML = `
      <div class="panel">
        <h2>Equipment Search</h2>
        <p class="muted">Try EQP-023, Pump 023, P-023.</p>
        <div style="display:flex; gap:8px;">
          <input id="eqp-search-input" placeholder="EQP-023 / Pump 023 / P-023" style="flex:1;" />
          <button id="eqp-search-btn" class="btn-primary">Search</button>
        </div>
        <p id="eqp-search-error" class="error hidden" style="margin-top:8px;"></p>
      </div>
      <div id="eqp-result"></div>
    `;

    const input = container.querySelector("#eqp-search-input");
    const errEl = container.querySelector("#eqp-search-error");
    const resultEl = container.querySelector("#eqp-result");

    async function doSearch() {
      const q = input.value.trim();
      if (!q) return;
      errEl.classList.add("hidden");
      resultEl.innerHTML = `<p class="muted">Searching...</p>`;
      try {
        const record = await ctx.Api.equipmentSearch(q);
        resultEl.innerHTML = render360(record);
      } catch (err) {
        resultEl.innerHTML = "";
        errEl.textContent = err.data?.message || err.message;
        errEl.classList.remove("hidden");
      }
    }

    container.querySelector("#eqp-search-btn").addEventListener("click", doSearch);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
  }

  return { render };
})();
