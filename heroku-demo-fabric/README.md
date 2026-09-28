# heroku-demo-fabric

Externally-reachable T-AO 213 demo-system fabric, deployed to Heroku app
`digital-factory-demo-jch`. One Express process, one PORT (Heroku
constraint), three path-prefixed domain routers so the surface stays
distinct per domain instead of one generic `/mock` endpoint:

- `/api/sap/...` -- SAP material availability/fulfillment (mirrors `mocks/sap-mock`)
- `/api/contracts/...` -- mock Ironclad contract/obligation repository (mirrors `mocks/ironclad-mock`)
- `/api/engineering/...` -- ported from `EngineeringMockService.cls` (mock AVEVA/Engineering Demo Adapter)

Same deterministic `EQP-001..EQP-100` catalog and formulas as the local
mocks -- this fabric exists for cloud reachability (e.g. CloudHub-deployed
Mule apps that can't reach `localhost`), not to replace the local mocks.
The Pump 023 north-star schedule delay is still driven from
`mocks/costpoint-mock` + `scripts/pump023-delay.sh`, unchanged.

## Push, not pull, for contracts

This Heroku app's Private Space fronts every inbound request with Okta SSO
(org-wide change, not specific to this app) -- an unauthenticated request
gets a 302 to an `/authorize` endpoint instead of JSON, so Mule can't poll
this fabric over HTTP. Direction is flipped instead: on `no-contract`
apply/restore, this fabric pushes the obligation straight to
`tao213-sapi-contract`'s `PUT /api/equipment/{equipmentId}/obligations`
(outbound from this dyno isn't subject to its own inbound SSO wall). Target
URL is `MULE_CONTRACT_INGRESS_URL` (defaults to the ingress Omni Gateway's
public-suffix domain once that op is registered there). Push is
fire-and-forget -- never blocks or fails the scenario endpoint's own
response.

## Run locally

```bash
npm install
FABRIC_PORT=4010 npm start
```

## Demo scenarios

| Scenario | Equipment | Endpoint |
|---|---|---|
| Engineering Change (amber) | EQP-041 | `POST /demo/scenarios/engineering-change/apply` / `/restore` |
| SAP Shortage | EQP-057 | `POST /demo/scenarios/sap-shortage/apply` / `/restore` |
| No Contract | EQP-066 | `POST /demo/scenarios/no-contract/apply` / `/restore` |
| No Engineering (static) | EQP-095 | inherent -- `GET /api/engineering/equipment/EQP-095` always `hasData:false` |
| Healthy/Green comparison | EQP-002 | inherent -- no mutation needed |
| North Star (Pump 023 RED) | EQP-023 | driven by `mocks/costpoint-mock`, not this fabric |

`GET /demo/scenarios` lists current applied state. `POST /demo/reset` wipes
all mutations and rebuilds the full catalog from the deterministic seed.

## Curl cheat-sheet

```bash
curl localhost:4010/health

curl localhost:4010/api/sap/materials/EQP-023
curl localhost:4010/api/sap/materials/EQP-057/availability

curl localhost:4010/api/contracts/equipment/EQP-023/obligations
curl localhost:4010/api/contracts/equipment/EQP-066/obligations   # 404 after no-contract/apply

curl localhost:4010/api/engineering/equipment/EQP-023   # rich north-star record
curl localhost:4010/api/engineering/equipment/EQP-095   # hasData:false

curl -X POST localhost:4010/demo/scenarios/engineering-change/apply
curl -X POST localhost:4010/demo/scenarios/engineering-change/restore
curl -X POST localhost:4010/demo/reset
```

## Deploy

```bash
git init
git add -A
git commit -m "heroku-demo-fabric: initial deploy"
heroku git:remote -a digital-factory-demo-jch
git push heroku main
```
