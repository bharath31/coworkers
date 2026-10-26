# Deployment security checklist

## Architecture

Coworkers uses Cloudflare Access to authenticate users before the Worker
serves the application. Private workspaces are isolated by authenticated
identity; shared workspaces use an explicit membership allowlist. API routes
and agent WebSocket routes enforce the same workspace authorization.

## Deployment safeguards

- Require Access in production and fail closed when it is misconfigured.
- Use email OTP for the configured application audience.
- Keep bot-built apps behind Access and require each app link token.
- Scope webhook bypasses to the webhook route and verify each bot token in
  the Worker.
- Disable public preview hostnames unless a protected use case requires them.
- Disable persisted request logs and prompt/response collection by default.
- Store account-specific configuration in private secrets or ignored local
  config; do not commit identities, allowlists, hostnames, account IDs, or
  audit details.
- Verify both allowed and denied requests, including HTTP and WebSocket
  access, after each production deploy.
