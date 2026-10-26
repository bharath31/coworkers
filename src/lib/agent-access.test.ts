import { describe, expect, it, vi } from "vitest"
import { canRouteAgentInstance, parseAgentInstancePath } from "./agent-access"
import { HOUSEHOLD_WORKSPACE_ID, canAccessWorkspace } from "./workspaces"
import type { WorkspaceIdentity } from "./workspaces"

const members = ["bharath@example.test", "sahana@example.test"]
const bharath = { id: "bharath", email: "bharath@example.test" }
const sahana = { id: "sahana", email: "sahana@example.test" }
const accessWorkspace = (identity: WorkspaceIdentity, workspaceId: string) =>
  canAccessWorkspace(identity, workspaceId, members)

describe("agent instance authorization", () => {
  it("parses encoded agent names and rejects malformed paths", () => {
    expect(
      parseAgentInstancePath(
        "/agents/bot-agent/household%3Ahome%3Ashared-bot/mcp"
      )
    ).toEqual({ agent: "bot-agent", instance: "household:home:shared-bot" })
    expect(parseAgentInstancePath("/agents/bot-agent/%E0%A4%A")).toBeNull()
    expect(parseAgentInstancePath("/agents/bot-agent")).toBeNull()
  })

  it("allows a member's own hub and the shared household hub", async () => {
    const hasBot = vi.fn(async () => true)
    const access = {
      canAccessWorkspace: accessWorkspace,
      hasBot,
    }

    await expect(
      canRouteAgentInstance(bharath, "user-hub", "bharath", access)
    ).resolves.toBe(true)
    await expect(
      canRouteAgentInstance(sahana, "user-hub", HOUSEHOLD_WORKSPACE_ID, access)
    ).resolves.toBe(true)
    expect(hasBot).not.toHaveBeenCalled()
  })

  it("denies another person's private hub", async () => {
    const hasBot = vi.fn(async () => true)

    await expect(
      canRouteAgentInstance(sahana, "user-hub", "bharath", {
        canAccessWorkspace: accessWorkspace,
        hasBot,
      })
    ).resolves.toBe(false)
    expect(hasBot).not.toHaveBeenCalled()
  })

  it("checks bot membership after workspace authorization", async () => {
    const hasBot = vi.fn(
      async (workspaceId: string, botId: string) =>
        workspaceId === HOUSEHOLD_WORKSPACE_ID && botId === "shared-bot"
    )

    await expect(
      canRouteAgentInstance(
        sahana,
        "bot-agent",
        `${HOUSEHOLD_WORKSPACE_ID}:shared-bot`,
        {
          canAccessWorkspace: accessWorkspace,
          hasBot,
        }
      )
    ).resolves.toBe(true)
    await expect(
      canRouteAgentInstance(sahana, "bot-agent", "bharath:private-bot", {
        canAccessWorkspace: accessWorkspace,
        hasBot,
      })
    ).resolves.toBe(false)
    expect(hasBot).toHaveBeenCalledTimes(1)
    expect(hasBot).toHaveBeenCalledWith(HOUSEHOLD_WORKSPACE_ID, "shared-bot")
  })

  it("refuses unknown bots and malformed or unsupported agent names", async () => {
    const hasBot = vi.fn(async () => false)
    const access = {
      canAccessWorkspace: accessWorkspace,
      hasBot,
    }

    await expect(
      canRouteAgentInstance(bharath, "bot-agent", "bharath:missing", access)
    ).resolves.toBe(false)
    await expect(
      canRouteAgentInstance(bharath, "bot-agent", "missing-separator", access)
    ).resolves.toBe(false)
    await expect(
      canRouteAgentInstance(bharath, "user-hub", "", access)
    ).resolves.toBe(false)
    await expect(
      canRouteAgentInstance(bharath, "unregistered", "bharath", access)
    ).resolves.toBe(false)
  })
})
