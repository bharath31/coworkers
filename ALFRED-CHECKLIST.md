# Deployment and security checklist

## Deployment

- [x] Use the project fork while preserving the upstream remote.
- [x] Validate tests, typecheck, and production build.
- [x] Preserve the existing Durable Object identity when migrating an established deployment.
- [x] Fail closed in production when Cloudflare Access is not configured.
- [x] Require email OTP for the configured application audience.
- [x] Keep setup and installer paths protected; only token-authenticated webhooks bypass Access.
- [x] Disable public `workers.dev` hostnames and preview URLs.
- [x] Disable persisted Worker invocation logs and AI Gateway prompt/response logs.
- [x] Remove unused analytics dependencies and disable CLI telemetry.
- [x] Keep deployment-specific values and secrets outside version control.
- [x] Deploy the secured Worker and verify Access, custom-domain routing, and disabled preview hosts.
- [ ] Verify email OTP and WebSocket access from the browser.

## Follow-up

- [ ] Continue validating browser, computer, durable execution, and team features.
- [ ] Separate private workspaces and add a shared workspace.
- [ ] Configure email and supported app integrations.
- [ ] Add routines, push notifications, reviewable execution history, and operational polish.
