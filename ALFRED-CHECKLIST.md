# Alfred implementation checklist

## Phase A — secure, working Coworkers deployment

- [x] Work from `bharath31/coworkers`; preserve upstream as a separate remote.
- [x] Validate tests, typecheck, and production build.
- [x] Keep the existing Durable Object identity for Bharath to preserve his bot data.
- [x] Fail closed in production if Cloudflare Access is missing; map authenticated emails to separate user hubs.
- [x] Put `alfred.bharath.sh` behind email OTP for Bharath and Sahana.
- [x] Use email OTP as the only sign-in requirement; WARP enrollment is not required.
- [x] Remove `/apps/*` from setup and installer bypass policies; only token-authenticated webhooks bypass Access.
- [x] Disable the public `workers.dev` hostname and preview URLs.
- [x] Keep token-authenticated webhooks available through a path-scoped Access bypass.
- [x] Disable persisted Worker invocation logs and AI Gateway prompt/response logs.
- [x] Remove the unused `web-vitals` dependency; no browser analytics SDK or beacon was present.
- [x] Disable anonymous Cloudflare CLI telemetry for the repo's commands and setup script.
- [x] Point the repo's install instructions and installer code link at the user's fork.
- [x] Remove the Cloudflare One/WARP posture gate after the user chose email OTP for a simpler login.
- [x] Deploy the secured Worker and verify the Access policy, custom domain mapping, and closed `workers.dev` hostname.
- [ ] Verify email OTP and WebSocket access from the browser.
- [x] Commit and push the implementation branch to the fork.

## Later phases

- [ ] Phase B: validate and improve browser, computer, durable execution, and team features.
- [x] Set Alfred's default timezone to Asia/Kolkata.
- [ ] Phase C: separate Bharath and Sahana workspaces and add the household shared space.
- [ ] Phase D: configure email and supported app integrations.
- [ ] Phase E: routines, push notifications, reviewable execution history, and operational polish.
