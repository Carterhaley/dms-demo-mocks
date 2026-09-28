# dms-demo-mocks

Render-hosted mock backends for the T-AO 213 / Digital Factory MuleSoft demo.

- `heroku-demo-fabric/` — SAP + Contracts (Ironclad) + Engineering + Costpoint mock, plus its own operator-console frontend. One Express process.
- `salesforce-mock/` — standalone Salesforce mock.

Each subdir has its own Dockerfile; deployed as separate Render web services with rootDir set per service.
