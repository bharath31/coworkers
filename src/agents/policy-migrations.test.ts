import { describe, expect, it } from "vitest"
import { DEFAULT_RULES } from "@/lib/types"
import { requireBrowserApproval } from "./policy-migrations"

describe("requireBrowserApproval", () => {
  it("requires review for bots with the old browser default", () => {
    expect(
      requireBrowserApproval({ ...DEFAULT_RULES, browser: "allow" })
    ).toEqual({
      ...DEFAULT_RULES,
      browser: "ask",
    })
  })

  it("preserves existing ask and block choices", () => {
    expect(
      requireBrowserApproval({ ...DEFAULT_RULES, browser: "ask" })
    ).toEqual({
      ...DEFAULT_RULES,
      browser: "ask",
    })
    expect(
      requireBrowserApproval({ ...DEFAULT_RULES, browser: "block" })
    ).toEqual({
      ...DEFAULT_RULES,
      browser: "block",
    })
  })
})
