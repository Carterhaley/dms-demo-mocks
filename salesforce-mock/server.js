const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const PORT = process.env.PORT || process.env.SALESFORCE_MOCK_PORT || 4002;
const EXPERIENCE_API_URL = process.env.EXPERIENCE_API_URL || "http://localhost:8084/api";

const PROGRAM_ID = "T-AO-213";
const INSTALLATIONS = ["INSTALL-A", "INSTALL-B", "INSTALL-C", "INSTALL-D", "INSTALL-E"];

const app = express();
app.use(cors());
app.use(express.json());

let program = {
  programId: PROGRAM_ID,
  programName: "T-AO 213",
  vessel: { name: "Future USNS Harriet Tubman", hullDesignation: "T-AO 213" },
};

let equipmentProjects = new Map(); // equipmentProjectId -> record

function pad3(n) {
  return String(n).padStart(3, "0");
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDateIn2027() {
  const start = new Date("2027-01-01T00:00:00.000Z").getTime();
  const end = new Date("2027-12-31T00:00:00.000Z").getTime();
  const d = new Date(randomInt(start, end));
  return d.toISOString().slice(0, 10);
}

function seed() {
  equipmentProjects = new Map();
  for (let i = 1; i <= 100; i += 1) {
    const suffix = pad3(i);
    const id = `T-AO213-EQP-${suffix}`;
    const record = {
      equipmentProjectId: id,
      programId: PROGRAM_ID,
      equipment: {
        equipmentId: `EQP-${suffix}`,
        description: i <= 10 ? `Pump ${suffix}` : `Equipment ${suffix}`,
        quantity: 1,
      },
      installationId: INSTALLATIONS[(i - 1) % INSTALLATIONS.length],
      plannedCost: randomInt(15000, 30000),
      requestedDeliveryDate: randomDateIn2027(),
      integrationStatus: "DRAFT",
      costpointProjectId: null,
      costpointOrderId: null,
      expectedDeliveryDate: null,
      actualCost: null,
      lastSynchronized: null,
      errorDetail: null,
    };
    equipmentProjects.set(id, record);
  }
}
seed();

app.use((req, res, next) => {
  res.on("finish", () => {
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode}`);
  });
  next();
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/programs/:programId", (req, res) => {
  if (req.params.programId !== program.programId) {
    return res.status(404).json({ errorCategory: "NOT_FOUND", retryable: false });
  }
  res.json({ ...program, equipmentProjectCount: equipmentProjects.size });
});

app.get("/equipment-projects", (req, res) => {
  const { programId } = req.query;
  let list = Array.from(equipmentProjects.values());
  if (programId) {
    list = list.filter((r) => r.programId === programId);
  }
  res.json(list);
});

app.get("/equipment-projects/:id", (req, res) => {
  const record = equipmentProjects.get(req.params.id);
  if (!record) {
    return res.status(404).json({ errorCategory: "NOT_FOUND", retryable: false });
  }
  res.json(record);
});

const MUTABLE_FIELDS = [
  "installationId",
  "plannedCost",
  "requestedDeliveryDate",
  "integrationStatus",
  "costpointProjectId",
  "costpointOrderId",
  "expectedDeliveryDate",
  "actualCost",
  "lastSynchronized",
  "errorDetail",
];

app.patch("/equipment-projects/:id", (req, res) => {
  const record = equipmentProjects.get(req.params.id);
  if (!record) {
    return res.status(404).json({ errorCategory: "NOT_FOUND", retryable: false });
  }
  const body = req.body || {};
  for (const field of MUTABLE_FIELDS) {
    if (body[field] !== undefined) {
      record[field] = body[field];
    }
  }
  equipmentProjects.set(record.equipmentProjectId, record);
  res.json(record);
});

app.post("/demo/reset", (req, res) => {
  seed();
  res.json({ reset: true });
});

app.post("/ui/equipment-projects/:id/submit", async (req, res) => {
  const record = equipmentProjects.get(req.params.id);
  if (!record) {
    return res.status(404).json({ errorCategory: "NOT_FOUND", retryable: false });
  }

  const payload = {
    program: record.programId,
    equipmentProjectId: record.equipmentProjectId,
    sourceId: record.equipmentProjectId,
    equipment: record.equipment,
    installationId: record.installationId,
    plannedCost: record.plannedCost,
    requestedDeliveryDate: record.requestedDeliveryDate,
  };

  record.integrationStatus = "SUBMITTING";
  equipmentProjects.set(record.equipmentProjectId, record);

  const correlationId = uuidv4();
  const url = `${EXPERIENCE_API_URL}/programs/${record.programId}/equipment-projects/${record.equipmentProjectId}/submit`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Correlation-Id": correlationId,
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    res.status(response.status).json(body);
  } catch (err) {
    res.status(502).json({ error: "experience_api_unreachable", detail: err.message });
  }
});

app.patch("/ui/equipment-projects/:id", (req, res) => {
  const record = equipmentProjects.get(req.params.id);
  if (!record) {
    return res.status(404).json({ errorCategory: "NOT_FOUND", retryable: false });
  }
  if (record.integrationStatus !== "DRAFT") {
    return res.status(409).json({ error: "not_draft", integrationStatus: record.integrationStatus });
  }
  const { installationId, plannedCost, requestedDeliveryDate } = req.body || {};
  if (installationId !== undefined) record.installationId = installationId;
  if (plannedCost !== undefined) record.plannedCost = plannedCost;
  if (requestedDeliveryDate !== undefined) record.requestedDeliveryDate = requestedDeliveryDate;
  equipmentProjects.set(record.equipmentProjectId, record);
  res.json(record);
});

app.get("/", (req, res) => {
  res.type("html").send(renderPage());
});

function renderPage() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>T-AO 213 Program Manager</title>
<style>
  body { font-family: -apple-system, Arial, sans-serif; margin: 2rem; color: #222; }
  h1 { font-size: 1.4rem; }
  .bar { display: flex; gap: 1.5rem; align-items: center; margin-bottom: 1rem; }
  .badge { padding: 0.25rem 0.6rem; border-radius: 4px; font-size: 0.85rem; background: #eee; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
  th, td { border: 1px solid #ddd; padding: 0.4rem 0.5rem; text-align: left; }
  th { background: #f5f5f5; }
  button { cursor: pointer; }
  .status-DRAFT { color: #555; }
  .status-SUBMITTING { color: #b8860b; }
  .status-SYNCHRONIZED { color: #1a7f37; }
  .status-ACTION_REQUIRED { color: #c00; }
</style>
</head>
<body>
  <h1>T-AO 213 &mdash; Future USNS Harriet Tubman &mdash; Equipment Orders</h1>
  <div class="bar">
    <span class="badge">DRAFT: <span id="count-DRAFT">-</span></span>
    <span class="badge">SUBMITTING: <span id="count-SUBMITTING">-</span></span>
    <span class="badge">SYNCHRONIZED: <span id="count-SYNCHRONIZED">-</span></span>
    <span class="badge">ACTION_REQUIRED: <span id="count-ACTION_REQUIRED">-</span></span>
    <span>/ 100</span>
    <button onclick="refresh()">Refresh</button>
    <button onclick="resetDemo()">Reset Demo</button>
  </div>
  <table>
    <thead>
      <tr>
        <th>ID</th><th>Equipment</th><th>Installation</th><th>Planned Cost</th>
        <th>Requested Delivery</th><th>Costpoint Order</th><th>Status</th><th>Actual Cost / Variance</th><th></th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>

<script>
async function loadData() {
  const res = await fetch('/equipment-projects?programId=T-AO-213');
  const all = await res.json();
  const counts = { DRAFT: 0, SUBMITTING: 0, SYNCHRONIZED: 0, ACTION_REQUIRED: 0 };
  all.forEach(r => { counts[r.integrationStatus] = (counts[r.integrationStatus] || 0) + 1; });
  Object.keys(counts).forEach(k => {
    const el = document.getElementById('count-' + k);
    if (el) el.textContent = counts[k];
  });
  renderRows(all.slice(0, 15));
}

function variance(r) {
  if (r.actualCost == null) return '';
  const diff = r.actualCost - r.plannedCost;
  const sign = diff > 0 ? '+' : '';
  return r.actualCost + ' (' + sign + diff + ')';
}

function renderRows(rows) {
  const tbody = document.getElementById('rows');
  tbody.innerHTML = rows.map(r => \`
    <tr id="row-\${r.equipmentProjectId}">
      <td>\${r.equipmentProjectId}</td>
      <td>\${r.equipment.description}</td>
      <td>\${r.installationId}</td>
      <td>\${r.plannedCost}</td>
      <td>\${r.requestedDeliveryDate}</td>
      <td>\${r.costpointOrderId || ''}</td>
      <td class="status-\${r.integrationStatus}">\${r.integrationStatus}</td>
      <td>\${variance(r)}</td>
      <td>
        \${r.integrationStatus === 'DRAFT' ? \`
          <button onclick="editRow('\${r.equipmentProjectId}')">Edit</button>
          <button onclick="submitRow('\${r.equipmentProjectId}')">Submit to Costpoint</button>
        \` : ''}
      </td>
    </tr>
  \`).join('');
}

async function editRow(id) {
  const installationId = prompt('Installation ID:');
  if (installationId === null) return;
  const plannedCost = prompt('Planned Cost:');
  if (plannedCost === null) return;
  const requestedDeliveryDate = prompt('Requested Delivery Date (YYYY-MM-DD):');
  if (requestedDeliveryDate === null) return;
  await fetch('/ui/equipment-projects/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ installationId, plannedCost: Number(plannedCost), requestedDeliveryDate })
  });
  loadData();
}

async function submitRow(id) {
  await fetch('/ui/equipment-projects/' + id + '/submit', { method: 'POST' });
  loadData();
}

async function refresh() { loadData(); }

async function resetDemo() {
  await fetch('/demo/reset', { method: 'POST' });
  location.reload();
}

loadData();
</script>
</body>
</html>`;
}

app.listen(PORT, () => {
  console.log(`salesforce-mock listening on ${PORT}, Experience API at ${EXPERIENCE_API_URL}`);
});
