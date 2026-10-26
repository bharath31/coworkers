import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { getAgentByName } from "agents"
import { env } from "cloudflare:workers"
import {
  accessibleWorkspaces,
  canAccessWorkspace,
  DEMO_USER_ID,
  identify,
} from "@/lib/auth"
import { SIDEBAR_COOKIE, parseWidths } from "@/lib/layout-context"
import type { PanelWidths } from "@/lib/layout-context"
import { botInstanceName } from "@/lib/types"
import type { BotState, HubState } from "@/lib/types"
import type { BotAgent } from "@/agents/bot-agent"
import type { UserHub } from "@/agents/user-hub"

export interface Viewer {
  id: string
  label: string
  avatarUrl?: string
}

// This is the local demo identity used until Cloudflare Access is configured.
const DEMO_VIEWER = {
  label: "Bharath",
}

function viewerFromIdentity(
  identity: Awaited<ReturnType<typeof identify>>
): Viewer {
  const { id, email } = identity
  if (id === DEMO_USER_ID) return { id, ...DEMO_VIEWER }
  return { id, label: email ?? id }
}

/**
 * Sidebar state for the first paint. After hydration the browser takes over
 * with a WebSocket to the same UserHub.
 */
export const getHubSnapshot = createServerFn()
  .validator((workspaceId: string | undefined) => workspaceId)
  .handler(
    async ({
      data: requestedWorkspaceId,
    }): Promise<{
      viewer: Viewer
      hub: HubState
      workspaceId: string
      workspaces: ReturnType<typeof accessibleWorkspaces>
      sidebarOpen: boolean
      widths: PanelWidths
    }> => {
      const request = getRequest()
      const identity = await identify(request)
      const viewer = viewerFromIdentity(identity)
      const workspaceId = requestedWorkspaceId ?? identity.id
      if (!canAccessWorkspace(identity, workspaceId)) {
        throw new Response("Forbidden", { status: 403 })
      }
      const cookie = request.headers.get("Cookie") ?? ""
      const sidebarOpen = !cookie.includes(`${SIDEBAR_COOKIE}=closed`)
      const hub = await getAgentByName(
        env.UserHub as unknown as DurableObjectNamespace<UserHub>,
        workspaceId
      )
      return {
        viewer,
        hub: await hub.snapshot(),
        workspaceId,
        workspaces: accessibleWorkspaces(identity),
        sidebarOpen,
        widths: parseWidths(cookie),
      }
    }
  )

export interface BotSnapshot {
  state: BotState
  /** `UIMessage[]` as JSON: message parts hold `unknown` tool payloads. */
  messagesJson: string
}

/** A bot's state and chat history for the first paint. */
export const getBotSnapshot = createServerFn()
  .validator((input: { botId: string; workspaceId?: string }) => input)
  .handler(async ({ data }): Promise<BotSnapshot | null> => {
    const request = getRequest()
    const identity = await identify(request)
    const workspaceId = data.workspaceId ?? identity.id
    if (!canAccessWorkspace(identity, workspaceId)) {
      throw new Response("Forbidden", { status: 403 })
    }
    const hub = await getAgentByName(
      env.UserHub as unknown as DurableObjectNamespace<UserHub>,
      workspaceId
    )
    const { bots } = await hub.snapshot()
    // Looking up an unknown name would create an empty Durable Object.
    if (!bots.some((b) => b.id === data.botId)) return null
    const bot = await getAgentByName(
      env.BotAgent as unknown as DurableObjectNamespace<BotAgent>,
      botInstanceName(workspaceId, data.botId)
    )
    const { state, messages } = await bot.snapshot()
    return { state, messagesJson: JSON.stringify(messages) }
  })
