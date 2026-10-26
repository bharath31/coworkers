
import { describe, expect, it } from "vitest"
import type { ThinkSubmissionInspection } from "@cloudflare/think"
import { backgroundTaskSummaries } from "./background-tasks"

function submission(
  overrides: Partial<ThinkSubmissionInspection> = {}
): ThinkSubmissionInspection {
  return {
    submissionId: "id",
    status: "pending",
    createdAt: 1,
    metadata: { origin: { kind: "task", name: "Example task" } },
    ...overrides,
  }
}

describe("backgroundTaskSummaries", () => {
  it("keeps only task submissions and sorts newest first", () => {
    const result = backgroundTaskSummaries([
      submission({ submissionId: "old", createdAt: 1 }),
      submission({
        submissionId: "routine",
        metadata: { origin: { kind: "routine", name: "Routine" } },
      }),
      submission({ submissionId: "new", createdAt: 4, status: "running" }),
    ])

    expect(
      result.map(({ id, title, status }) => ({ id, title, status }))
    ).toEqual([
      { id: "new", title: "Example task", status: "running" },
      { id: "old", title: "Example task", status: "pending" },
    ])
  })

  it("includes timing and errors when present", () => {
    expect(
      backgroundTaskSummaries([
        submission({
          startedAt: 2,
          completedAt: 3,
          status: "error",
          error: "Failed",
        }),
      ])
    ).toEqual([
      {
        id: "id",
        title: "Example task",
        status: "error",
        createdAt: 1,
        startedAt: 2,
        completedAt: 3,
        error: "Failed",
      },
    ])
  })
})
