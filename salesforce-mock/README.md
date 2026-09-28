# salesforce-mock

Stateful mock of Salesforce for the T-AO 213 equipment-order orchestration demo. Plays two roles:

1. A data store + REST API that the real MuleSoft "Salesforce System API" reads/writes.
2. A minimal server-rendered HTML+vanilla-JS UI standing in for the Salesforce program-manager experience, at `GET /`.

Seeds 100 equipment project records for program `T-AO-213` on boot and on `POST /demo/reset`.

## Run

```bash
npm install
SALESFORCE_MOCK_PORT=4002 EXPERIENCE_API_URL=http://localhost:8084/api npm start
```

Default port: `4002` (env var `SALESFORCE_MOCK_PORT`).
`EXPERIENCE_API_URL` (default `http://localhost:8084/api`) is the base URL of the MuleSoft Experience API the UI's submit proxy calls into.

## Curl cheat-sheet

```bash
# health
curl localhost:4002/health

# program
curl localhost:4002/programs/T-AO-213

# all equipment projects
curl "localhost:4002/equipment-projects?programId=T-AO-213"

# single record
curl localhost:4002/equipment-projects/T-AO213-EQP-001

# write results back (as Mule would after Costpoint sync)
curl -X PATCH localhost:4002/equipment-projects/T-AO213-EQP-001 -H 'Content-Type: application/json' \
  -d '{"integrationStatus":"SYNCHRONIZED","costpointProjectId":"CP-T-AO-213-001","costpointOrderId":"PO-TAO213-00001","expectedDeliveryDate":"2027-06-01","actualCost":21000,"lastSynchronized":"2026-09-09T00:00:00.000Z"}'

# UI-facing edit (only works while DRAFT)
curl -X PATCH localhost:4002/ui/equipment-projects/T-AO213-EQP-002 -H 'Content-Type: application/json' \
  -d '{"plannedCost":22000}'

# UI-facing submit (proxies to Mule Experience API; 502 if Mule isn't running)
curl -X POST localhost:4002/ui/equipment-projects/T-AO213-EQP-002/submit

# reset demo (reseed 100 fresh DRAFT records)
curl -X POST localhost:4002/demo/reset

# open UI
open http://localhost:4002/
```
