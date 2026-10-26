# Alfred implementation checklist

## Phase A — secure, working Coworkers deployment

- [x] Work from `your-account/coworkers`; preserve upstream as a separate remote.
- [x] Validate tests, typecheck, and production build.
- [x] Keep the existing Durable Object identity for Account owner to preserve his bot data.
- [x] Fail closed in production if Cloudflare Access is missing; map authenticated emails to separate user hubs.
- [x] Put `app.example.invalid` behind email OTP for Account owner and Family member, plus Cloudflare One/Gateway device posture.
- [x] Restrict Cloudflare One device enrollment to Account owner and Family member by OTP.
- [x] Remove `/apps/*` from setup and installer bypass policies; only token-authenticated webhooks bypass Access.
- [x] Disable the public `workers.dev` hostname and preview URLs.
- [x] Keep token-authenticated webhooks available through a path-scoped Access bypass.
- [x] Disable persisted Worker invocation logs and AI Gateway prompt/response logs.
- [x] Remove the unused `web-vitals` dependency; no browser analytics SDK or beacon was present.
- [x] Disable anonymous Cloudflare CLI telemetry for the repo's commands and setup script.
- [x] Point the repo's install instructions and installer code link at the user's fork.
- [ ] Enroll Account owner's and Family member's devices in the `lnaccount-owner94` Cloudflare One organization and validate OTP + posture access.
- [ ] Add exact-device posture restrictions once Cloudflare has enrolled device records to select.
- [x] Deploy the secured Worker and verify the Access policy, custom domain mapping, and closed `workers.dev` hostname.
- [ ] Verify OTP, device posture, and WebSocket access from enrolled devices.
- [ ] Commit and push the implementation branch to the fork.

## Later phases

- [ ] Phase B: validate and improve browser, computer, durable execution, and team features.
- [ ] Phase C: separate Account owner and Family member workspaces and add the household shared space.
- [ ] Phase D: configure email and supported app integrations.
- [ ] Phase E: routines, push notifications, reviewable execution history, and operational polish.
