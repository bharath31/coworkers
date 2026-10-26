import handler from "@tanstack/react-start/server-entry"
import { getAgentByName, routeAgentEmail, routeAgentRequest } from "agents"
import { canAccessWorkspace, Unauthorized, identify } from "@/lib/auth"
import { botInstanceName } from "@/lib/types"
import { handleAppRequest } from "./agents/apps-runtime"
import type { UserHub } from "./agents/user-hub"

// Durable Objects and the classes their runtimes load by name.
export { BotAgent, WorkspaceServiceProxy } from "./agents/bot-agent"
export { UserHub } from "./agents/user-hub"
// Apps bots build: live fan-out, and `env.BOT` inside an app's server.js.
export { AppBinding, AppLive } from "./agents/apps-runtime"
// Backs `browser_execute`: a durable Code Mode runtime in a DO facet.
export { CodemodeRuntime } from "agents/browser"

/** `/agents/<agent>/<instance>/...` → the instance name, URL-decoded. */
function agentInstance(pathname: string) {
  const [, prefix, agent, instance] = pathname.split("/")
  if (prefix !== "agents" || !agent || !instance) return null
  return { agent, instance: decodeURIComponent(instance) }
}

/** A user may reach their own workspace and shared workspaces they belong to. */
async function ownsInstance(
  identity: Awaited<ReturnType<typeof identify>>,
  agent: string,
  instance: string,
  env: Env
) {
  if (agent === "user-hub") {
    return canAccessWorkspace(identity, instance)
  }
  if (agent === "bot-agent") {
    const split = instance.lastIndexOf(":")
    if (split <= 0 || split === instance.length - 1) return false
    const workspaceId = instance.slice(0, split)
    const botId = instance.slice(split + 1)
    if (!canAccessWorkspace(identity, workspaceId)) return false
    const hub = await getAgentByName(
      env.UserHub as unknown as DurableObjectNamespace<UserHub>,
      workspaceId
    )
    return hub.hasBot(botId)
  }
  return false
}

export default {
  async fetch(request, env) {
    // Apps require the outer Access policy and their link token.
    const app = await handleAppRequest(request, env)
    if (app) return app

    const target = agentInstance(new URL(request.url).pathname)
    if (target) {
      let identity: Awaited<ReturnType<typeof identify>>
      try {
        identity = await identify(request)
      } catch (err) {
        if (err instanceof Unauthorized) {
          return new Response("Unauthorized", { status: 401 })
        }
        throw err
      }
      if (!(await ownsInstance(identity, target.agent, target.instance, env))) {
        return new Response("Forbidden", { status: 403 })
      }
      // Agent WebSockets and agent HTTP (MCP OAuth callbacks).
      const response = await routeAgentRequest(request, env)
      if (response) return response
    }
    return handler.fetch(request)
  },

  /**
   * Email Routing delivers mail for EMAIL_DOMAIN here. A bot's address is
   * `<userId>.<botId>@EMAIL_DOMAIN`; anything else is rejected, and so is
   * mail for a bot that does not exist (looking it up would create it).
   */
  async email(message, env) {
    const domain = env.EMAIL_DOMAIN?.trim().toLowerCase()
    const [local, host] = message.to.toLowerCase().split("@")
    const dot = local?.lastIndexOf(".") ?? -1
    if (!domain || host !== domain || dot <= 0) {
      message.setReject("Unknown address")
      return
    }
    const userId = local.slice(0, dot)
    const botId = local.slice(dot + 1)
    const hub = await getAgentByName(
      env.UserHub as unknown as DurableObjectNamespace<UserHub>,
      userId
    )
    if (!(await hub.hasBot(botId))) {
      message.setReject("Unknown address")
      return
    }
    await routeAgentEmail(message, env, {
      resolver: async () => ({
        agentName: "BotAgent",
        agentId: botInstanceName(userId, botId),
      }),
    })
  },
} satisfies ExportedHandler<Env>
