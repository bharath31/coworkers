# Alfred implementation checklist

This checklist tracks the full Alfred mission. “Implemented” means code is
present; it does not mean the feature passed its real end-to-end acceptance
test.

## Architecture

```mermaid
flowchart LR
  Account owner["Account owner's browser"] --> Access["Cloudflare Access<br/>email OTP allowlist"]
  Family member["Family member's browser"] --> Access
  Access --> Worker["Coworkers Worker"]
  Worker --> PrivateB["Account owner Private<br/>UserHub + bots"]
  Worker --> PrivateS["Family member Private<br/>UserHub + bots"]
  Worker --> Home["Our Home<br/>shared UserHub + bots"]
  PrivateB --> Services["AI Gateway · Browser Run<br/>Dynamic Workers"]
  PrivateS --> Services
  Home --> Services
  Worker --> Webhook["/api/hooks/*<br/>per-bot capability token"]
```

Private and shared workspaces use distinct Durable Object names. Server
functions and the `/agents/*` router authorize the email identity before
reading snapshots or opening an agent connection. Bot-built app links remain
behind Access and require their link token; inbound webhooks have a scoped
Access bypass and verify a per-bot token in the Worker.

## Milestones

| Milestone                       | Status                                                   | Evidence / next acceptance work                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — Secure working deployment   | **Partly verified; latest code pending deploy**          | The `coworkers` Worker is deployed and Access uses an email OTP allowlist. Latest observed live Worker version is 5. `cf auth whoami` reports `Not logged in`, so the merged family-workspace code has not been deployed. After `cf auth login`, deploy and verify Account owner/Family member login, unauthenticated HTTP and WebSocket rejection, model response, browser navigation, and browser handoff. |
| B — Family collaboration        | **Implemented, not yet deployed or end-to-end verified** | PR [#4](https://github.com/your-account/coworkers/pull/4) is merged. Unit coverage checks private ownership, household membership, unknown identities, local demo mode, and allowlist parsing. Deploy, then verify both private contexts, shared `Our Home`, bot history, connections, files, memory, push permissions, and cross-workspace denial with both accounts.                             |
| C — Autonomous execution        | **In progress / acceptance unverified**                  | The repo includes durable agent turns, routines, check-ins, bot-to-bot messages, browser and Dynamic Worker tools. Validate persistent task progress, three parallel tasks, routine wake-up, safe interruption/resume, and sandboxed app creation with synthetic data.                                                                                                                          |
| D — Full assistant experience   | **In progress / acceptance unverified**                  | Browser takeover, teaching by demonstration, live apps, open items, and approvals exist in source. Demonstrate each end to end, including progress visibility, generated artifacts, and human handoff.                                                                                                                                                                                          |
| E — Integrations and operations | **In progress / acceptance unverified**                  | Webhooks and push exist; `EMAIL_DOMAIN` is empty in the current config. Verify scoped integration permissions, duplicate-notification prevention, email/webhook wake-ups, cost controls, monitoring, recovery, and data export.                                                                                                                                                                 |

## Security and repository checks

- [x] Cloudflare Access email OTP allowlist; removed WARP/device posture from
      the setup flow.
- [x] No web analytics/tracking beacons; Worker invocation logs and AI Gateway
      prompt/response collection are disabled by default.
- [x] Workspace membership checks cover server snapshots and agent routing.
- [x] Agent-instance routing tests cover private denial, shared-bot access,
      unknown bot names, and malformed encoded paths.
- [x] Preserve `origin` for `your-account/coworkers` and `upstream` for
      `fayazara/coworkers`.
- [x] PR #4 merged to the fork.
- [x] Family-workspace authorization tests: 31 total repo tests passed;
      root and installer TypeScript checks passed; `cf build` and
      `cf deploy --dry-run` passed.
- [ ] Deploy latest merged code (requires `cf auth login` in an interactive
      terminal).
- [ ] Run the two-account, cross-workspace, browser, routine, integration, and
      recovery acceptance tests described in the mission.
- [ ] Record actual model usage and measured monthly cost after representative
      tasks run.

## Next action

Run `cf auth login` from the repository checkout, then deploy with the
repository's `cf` workflow. Do not paste API tokens into chat or commit
`coworkers.deploy.json` or `.dev.vars.production`.
