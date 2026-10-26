import type { ThinkSubmissionInspection } from "@cloudflare/think"

export interface BackgroundTaskSummary {
  id: string
  title: string
  status: ThinkSubmissionInspection["status"]
  createdAt: number
  startedAt?: number
  completedAt?: number
  error?: string
}

/** Durable Think submissions that were explicitly started as user tasks. */
export function backgroundTaskSummaries(
  submissions: ThinkSubmissionInspection[]
): BackgroundTaskSummary[] {
  return submissions
    .filter((submission) => {
      const metadata = submission.metadata as
        { origin?: { kind?: string } } | undefined
      return metadata?.origin?.kind === "task"
    })
    .map((submission) => {
      const metadata = submission.metadata as
        { origin?: { name?: string } } | undefined
      return {
        id: submission.submissionId,
        title: metadata?.origin?.name || "Background task",
        status: submission.status,
        createdAt: submission.createdAt,
        ...(submission.startedAt !== undefined
          ? { startedAt: submission.startedAt }
          : {}),
        ...(submission.completedAt !== undefined
          ? { completedAt: submission.completedAt }
          : {}),
        ...(submission.error ? { error: submission.error } : {}),
      }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}