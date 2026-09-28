/* App shell: login gate, tab router, topbar status, drawer/modal/toast plumbing. */
const App = (() => {
  let role = null;
  let currentTab = "overview";
  let statusPoll = null;

  const els = {
    loginScreen: document.getElementById("login-screen"),
    loginForm: document.getElementById("login-form"),
    loginPassword: document.getElementById("login-password"),
    loginError: document.getElementById("login-error"),
    app: document.getElementById("app"),
    topbarStatus: document.getElementById("topbar-status"),
    tabs: document.getElementById("tabs"),
    view: document.getElementById("view"),
    drawerBackdrop: document.getElementById("drawer-backdrop"),
    drawer: document.getElementById("drawer"),
    modalBackdrop: document.getElementById("modal-backdrop"),
    modal: document.getElementById("modal"),
    toast: document.getElementById("toast"),
    btnHealthCheck: document.getElementById("btn-health-check"),
    btnReset: document.getElementById("btn-reset"),
    btnLogout: document.getElementById("btn-logout"),
  };

  function badge(status) {
    return `<span class="badge badge-${status}">${status}</span>`;
  }

  function toast(msg, isError) {
    els.toast.textContent = msg;
    els.toast.classList.remove("hidden");
    els.toast.style.borderColor = isError ? "var(--red)" : "var(--border)";
    clearTimeout(els.toast._t);
    els.toast._t = setTimeout(() => els.toast.classList.add("hidden"), 3500);
  }

  function closeDrawer() {
    els.drawer.classList.add("hidden");
    els.drawerBackdrop.classList.add("hidden");
  }
  function openDrawer(html) {
    els.drawer.innerHTML = `<button class="drawer-close btn-ghost" data-close-drawer>close</button>${html}`;
    els.drawer.classList.remove("hidden");
    els.drawerBackdrop.classList.remove("hidden");
  }
  function closeModal() {
    els.modal.classList.add("hidden");
    els.modalBackdrop.classList.add("hidden");
  }
  function openModal(html) {
    els.modal.innerHTML = `<button class="modal-close btn-ghost" data-close-modal>close</button>${html}`;
    els.modal.classList.remove("hidden");
    els.modalBackdrop.classList.remove("hidden");
  }

  els.drawerBackdrop.addEventListener("click", closeDrawer);
  els.modalBackdrop.addEventListener("click", closeModal);
  els.drawer.addEventListener("click", (e) => { if (e.target.dataset.closeDrawer !== undefined) closeDrawer(); });
  els.modal.addEventListener("click", (e) => { if (e.target.dataset.closeModal !== undefined) closeModal(); });

  const VIEWS = {
    overview: OverviewView,
    interfaces: InterfacesView,
    scenarios: ScenariosView,
    equipment: EquipmentView,
    agentfabric: AgentFabricView,
    traces: TracesView,
  };

  async function renderTab(name) {
    currentTab = name;
    for (const btn of els.tabs.querySelectorAll(".tab")) btn.classList.toggle("active", btn.dataset.tab === name);
    els.view.innerHTML = `<p class="muted">Loading...</p>`;
    try {
      await VIEWS[name].render(els.view, { App, Api, badge, openDrawer, closeDrawer, openModal, closeModal, toast, role });
    } catch (err) {
      els.view.innerHTML = `<p class="error">Failed to load: ${err.message}</p>`;
    }
  }

  els.tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (btn) renderTab(btn.dataset.tab);
  });

  async function refreshTopbar() {
    try {
      const s = await Api.status();
      els.topbarStatus.innerHTML = `
        <span class="stat">Core: ${badge(s.coreDemo)}</span>
        <span class="stat">Env: ${s.environment}</span>
        <span class="stat">Last reset: ${new Date(s.lastReset).toLocaleTimeString()}</span>
        ${s.activeScenario ? `<span class="stat">Active scenario: ${s.activeScenario.scenarioId}</span>` : ""}
      `;
    } catch (err) {
      if (err.status === 401) return showLogin();
      els.topbarStatus.innerHTML = `<span class="error">status unavailable: ${err.message}</span>`;
    }
  }

  function wireSSE() {
    Api.events((type, payload) => {
      if (type === "activity" || type === "reset:completed" || type === "scenario:completed") refreshTopbar();
      if (currentTab === "overview" && VIEWS.overview.onEvent) VIEWS.overview.onEvent(type, payload);
    });
  }

  function showLogin() {
    if (statusPoll) clearInterval(statusPoll);
    els.app.classList.add("hidden");
    els.loginScreen.classList.remove("hidden");
  }

  async function showApp() {
    els.loginScreen.classList.add("hidden");
    els.app.classList.remove("hidden");
    await refreshTopbar();
    await renderTab(currentTab);
    wireSSE();
    statusPoll = setInterval(refreshTopbar, 15000);
  }

  els.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    els.loginError.classList.add("hidden");
    try {
      const res = await Api.login(els.loginPassword.value);
      role = res.role;
      els.loginPassword.value = "";
      await showApp();
    } catch (err) {
      els.loginError.textContent = err.data?.message || err.message;
      els.loginError.classList.remove("hidden");
    }
  });

  els.btnLogout.addEventListener("click", async () => {
    await Api.logout();
    role = null;
    showLogin();
  });

  els.btnHealthCheck.addEventListener("click", async () => {
    els.btnHealthCheck.disabled = true;
    try {
      await Api.interfaces();
      toast("Health check complete.");
      refreshTopbar();
      if (currentTab === "interfaces") renderTab("interfaces");
    } catch (err) {
      toast(`Health check failed: ${err.message}`, true);
    } finally {
      els.btnHealthCheck.disabled = false;
    }
  });

  els.btnReset.addEventListener("click", () => {
    openModal(`
      <h2>Reset Demo</h2>
      <p class="muted">Rebuilds the deterministic seed and clears all applied scenarios. Type <strong>RESET</strong> to confirm.</p>
      <input id="reset-confirm-input" class="confirm-input" placeholder="RESET" />
      <button id="reset-confirm-btn" class="btn-danger">Reset Demo</button>
    `);
    document.getElementById("reset-confirm-btn").addEventListener("click", async () => {
      const val = document.getElementById("reset-confirm-input").value;
      if (val !== "RESET") return toast('Type "RESET" exactly to confirm.', true);
      try {
        await Api.reset();
        closeModal();
        toast("Demo reset.");
        refreshTopbar();
        renderTab(currentTab);
      } catch (err) {
        toast(`Reset failed: ${err.message}`, true);
      }
    });
  });

  async function init() {
    try {
      const s = await Api.session();
      if (s.authenticated) {
        role = s.role;
        await showApp();
      } else {
        showLogin();
      }
    } catch (_) {
      showLogin();
    }
  }

  return { init, renderTab, badge, toast, openDrawer, closeDrawer, openModal, closeModal, getRole: () => role };
})();

App.init();
