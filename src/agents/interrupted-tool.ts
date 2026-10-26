import type { UIMessage } from "ai"

/**
 * Turn an incomplete tool part into an explicit recovery instruction.
 * Read-only calls can be repeated; side-effecting calls need inspection first.
 */
export function repairInterruptedToolPart(
  part: UIMessage["parts"][number],
  readOnly: boolean
): UIMessage["parts"][number] {
  const record = part as { type: string; toolName?: string; state?: string }
  const name =
    record.type === "dynamic-tool"
      ? (record.toolName ?? "")
      : record.type.replace(/^tool-/, "")

  // A card the user moved past by sending a new message. Nothing ran.
  if (record.state === "approval-requested") {
    return {
      ...part,
      state: "output-error",
      errorText:
        name === "ask_user"
          ? "The user did not pick an option. They replied in the chat instead: their newest message is the answer."
          : "Not done: the user sent a new message instead of approving this. If it still matters, ask again.",
    } as UIMessage["parts"][number]
  }

  return {
    ...part,
    state: "output-error",
    errorText: readOnly
      ? "This call was interrupted before it returned. It only reads, so it is safe to run again."
      : "This call was interrupted before a result was recorded, so it may or may not have taken effect. Check the destination (the app, page, file or bot) before doing it again, and never repeat it blindly.",
  } as UIMessage["parts"][number]
}
