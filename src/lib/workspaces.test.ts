import { describe, expect, it } from "vitest"
import {
  HOUSEHOLD_WORKSPACE_ID,
  canAccessWorkspace,
  parseHouseholdMembers,
  workspacesFor,
} from "./workspaces"

const members = ["bharath@example.test", "sahana@example.test"]

describe("workspace access", () => {
  it("keeps private workspaces owner-only and exposes Our Home to members", () => {
    const bharath = { id: "bharath", email: "bharath@example.test" }
    const sahana = { id: "sahana", email: "sahana@example.test" }

    expect(canAccessWorkspace(bharath, "bharath", members)).toBe(true)
    expect(canAccessWorkspace(sahana, "bharath", members)).toBe(false)
    expect(canAccessWorkspace(sahana, HOUSEHOLD_WORKSPACE_ID, members)).toBe(
      true
    )
    expect(workspacesFor(bharath, members).map((space) => space.name)).toEqual([
      "Private",
      "Our Home",
    ])
  })

  it("denies household access to unknown or unauthenticated identities", () => {
    expect(
      canAccessWorkspace(
        { id: "unknown", email: "unknown@example.test" },
        "unknown",
        members
      )
    ).toBe(false)
    expect(
      canAccessWorkspace(
        { id: "unknown", email: "unknown@example.test" },
        HOUSEHOLD_WORKSPACE_ID,
        members
      )
    ).toBe(false)
    expect(
      canAccessWorkspace(
        { id: "unknown", email: null },
        HOUSEHOLD_WORKSPACE_ID,
        members
      )
    ).toBe(false)
    expect(workspacesFor({ id: "unknown", email: null }, members)).toHaveLength(
      0
    )
  })

  it("allows the local demo identity only when explicitly enabled", () => {
    expect(
      canAccessWorkspace(
        { id: "demo", email: null },
        "demo",
        [],
        undefined,
        true
      )
    ).toBe(true)
    expect(canAccessWorkspace({ id: "demo", email: null }, "demo", [])).toBe(
      false
    )
  })

  it("fails closed on invalid deployment membership JSON", () => {
    expect(parseHouseholdMembers("not-json")).toEqual([])
    expect(parseHouseholdMembers('{"email":"someone@example.test"}')).toEqual(
      []
    )
    expect(
      parseHouseholdMembers(
        '["Bharath@example.test", "bharath@example.test", "bad"]'
      )
    ).toEqual(["bharath@example.test"])
  })
})
