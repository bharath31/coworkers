import type { WorkspaceIdentity } from "./workspaces"

export type HasBot = (workspaceId: string, botId: string) => Promise<boolean>
export type CanAccessWorkspace = (
  identity: WorkspaceIdentity,
  workspaceId: string
) => boolean

/** Parse an agent URL without allowing malformed escapes to crash the Worker. */
export function parseAgentInstancePath(pathname: string) {
  const [, prefix, agent, encodedInstance] = pathname.split("/")
  if (prefix !== "agents" || !agent || !encodedInstance) return null
  try {
    return { agent, instance: decodeURIComponent(encodedInstance) }
  } catch {
    return null
  }
}

/**
 * Check an agent URL before routing it to a Durable Object. Bot names are
 * never enough on their own: the caller must belong to the workspace and the
 * bot must already exist in that workspace's directory.
 */
export async function canRouteAgentInstance(
  identity: WorkspaceIdentity,
  agent: string,
  instance: string,
  access: {
    canAccessWorkspace: CanAccessWorkspace
    hasBot: HasBot
  }
) {
  if (agent === "user-hub") {
    return access.canAccessWorkspace(identity, instance)
  }

  if (agent !== "bot-agent") return false
  const split = instance.lastIndexOf(":")
  if (split <= 0 || split === instance.length - 1) return false

  const workspaceId = instance.slice(0, split)
  const botId = instance.slice(split + 1)
  if (!access.canAccessWorkspace(identity, workspaceId)) {
    return false
  }
  return access.hasBot(workspaceId, botId)
}
