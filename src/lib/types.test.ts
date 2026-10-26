import { describe, expect, it } from "vitest"
import { DEFAULT_PROACTIVE } from "./types"

describe("DEFAULT_PROACTIVE", () => {
  it("uses Alfred's requested UTC timezone by default", () => {
    expect(DEFAULT_PROACTIVE.timezone).toBe("UTC")
  })
})
