import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"
import { repairInterruptedToolPart } from "./interrupted-tool"

function part(fields: Record<string, unknown>) {
  return fields as UIMessage["parts"][number]
}

describe("repairInterruptedToolPart", () => {
  it("marks an interrupted read as safe to retry", () => {
    const repaired = repairInterruptedToolPart(
      part({
        type: "tool-read",
        state: "input-available",
        input: { path: "notes.txt" },
      }),
      true
    )

    expect(repaired).toMatchObject({
      type: "tool-read",
      state: "output-error",
      errorText: expect.stringMatching(
        /only reads, so it is safe to run again/
      ),
    })
  })

  it("warns that an interrupted side effect may already have happened", () => {
    const repaired = repairInterruptedToolPart(
      part({
        type: "tool-write",
        state: "input-available",
        input: { path: "notes.txt" },
      }),
      false
    )

    expect(repaired).toMatchObject({
      type: "tool-write",
      state: "output-error",
      errorText: expect.stringMatching(/may or may not have taken effect/),
    })
    expect((repaired as { errorText: string }).errorText).toMatch(
      /never repeat it blindly/
    )
  })

  it("closes an abandoned approval without claiming the action ran", () => {
    const repaired = repairInterruptedToolPart(
      part({ type: "tool-delete", state: "approval-requested" }),
      false
    )

    expect(repaired).toMatchObject({
      type: "tool-delete",
      state: "output-error",
      errorText: expect.stringMatching(/instead of approving this/),
    })
  })

  it("uses the user's latest reply when an ask_user card was interrupted", () => {
    const repaired = repairInterruptedToolPart(
      part({
        type: "dynamic-tool",
        toolName: "ask_user",
        state: "approval-requested",
      }),
      true
    )

    expect(repaired).toMatchObject({
      type: "dynamic-tool",
      state: "output-error",
      errorText: expect.stringMatching(/their newest message is the answer/),
    })
  })
})
