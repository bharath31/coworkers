import { describe, expect, it } from "vitest"
import {
  HOUSEHOLD_WORKSPACE_ID,
  canAccessWorkspace,
  parseHouseholdMembers,
  workspacesFor,
} from "./workspaces"

const members = ["owner@example.test", "member@example.test"]

describe("workspace access", () => {
  it("keeps private workspaces owner-only and exposes Our Home to members", () => {
    const account-owner = { id: "account-owner", email: "owner@example.test" }
    const family-member = { id: "family-member", email: "member@example.test" }

    expect(canAccessWorkspace(account-owner, "account-owner", members)).toBe(true)
    expect(canAccessWorkspace(family-member, "account-owner", members)).toBe(false)
    expect(canAccessWorkspace(family-member, HOUSEHOLD_WORKSPACE_ID, members)).toBe(
      true
    )
    expect(workspacesFor(account-owner, members).map((space) => space.name)).toEqual([
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
        '["Account owner@example.test", "owner@example.test", "bad"]'
      )
    ).toEqual(["owner@example.test"])
  })
})
