# CRM Features — Task List

Status: complete (2026-10-22). All implementation items built and verified.

## Contract
- [x] JobStage type + Workspace.stage/customerId
- [x] src/crm/types.ts
- [x] tasks/crm-plan.md

## Subagent A — Backend
- [x] Code.gs: Customers/Activities/Tasks sheets + endpoints + workspace stage/customerId
- [x] scripts/workspace-dev-api.ts + vite.config.ts local API routing
- [x] tests/crm-backend.test.ts green

## Subagent B — Data layer
- [x] src/crm/api.ts, store.ts, sync.ts, index.ts
- [x] setWorkspaceStage / linkWorkspaceToCustomer helpers
- [x] tests/crm-service.test.ts green

## Subagent C — UI
- [x] CustomerList, CustomerDetail, CustomerForm, ActivityTimeline, TaskList
- [x] navigation.ts + App.tsx + AppHeader.tsx wiring (#/customers routes)
- [x] tests/crm.spec.ts

## Integration (orchestrator)
- [x] npm run typecheck clean
- [x] npm test green (124 passed, incl. 12 new CRM tests)
- [x] npm run build clean
- [x] Playwright CRM spec green

## Outstanding (deployment only)
- [ ] Manual redeploy of `apps-script/Code.gs` to the live Apps Script web app (no CI deploy)
