/** Workspace IDs are Durable Object namespaces; private IDs stay user IDs. */
export const HOUSEHOLD_WORKSPACE_ID = "household:home"

export interface WorkspaceIdentity {
  id: string
  email: string | null
}

export interface WorkspaceInfo {
  id: string
  name: string
  kind: "private" | "household"
}

/** Parse the account's deployment-configured family allowlist, failing closed. */
export function parseHouseholdMembers(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return [
      ...new Set(
        value
          .filter((email): email is string => typeof email === "string")
          .map((email) => email.trim().toLowerCase())
          .filter((email) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      ),
    ]
  } catch {
    return []
  }
}

export function workspacesFor(
  identity: WorkspaceIdentity,
  householdMembers: readonly string[],
  householdId = HOUSEHOLD_WORKSPACE_ID,
  allowLocalDemo = false
): WorkspaceInfo[] {
  if (!isMember(identity, householdMembers, allowLocalDemo)) return []
  const workspaces: WorkspaceInfo[] = [
    { id: identity.id, name: "Private", kind: "private" },
  ]
  if (
    identity.email &&
    householdMembers.includes(identity.email.trim().toLowerCase())
  ) {
    workspaces.push({
      id: householdId,
      name: "Our Home",
      kind: "household",
    })
  }
  return workspaces
}

export function canAccessWorkspace(
  identity: WorkspaceIdentity,
  workspaceId: string,
  householdMembers: readonly string[],
  householdId = HOUSEHOLD_WORKSPACE_ID,
  allowLocalDemo = false
) {
  if (!isMember(identity, householdMembers, allowLocalDemo)) return false
  if (workspaceId === identity.id) return true
  return (
    workspaceId === householdId &&
    !!identity.email &&
    householdMembers.includes(identity.email.trim().toLowerCase())
  )
}

function isMember(
  identity: WorkspaceIdentity,
  householdMembers: readonly string[],
  allowLocalDemo: boolean
) {
  if (allowLocalDemo && identity.id === "demo") return true
  return (
    !!identity.email &&
    householdMembers.includes(identity.email.trim().toLowerCase())
  )
}
