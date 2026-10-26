import type { ActionClass, RulePolicy } from "@/lib/types"

/**
 * Real-browser scripts can submit external actions that app rules cannot
 * inspect. Require human review for the old permissive default, preserving
 * explicit "ask" and "block" settings.
 */
export function requireBrowserApproval(
  rules: Record<ActionClass, RulePolicy>
): Record<ActionClass, RulePolicy> {
  if (rules.browser !== "allow") return rules
  return { ...rules, browser: "ask" }
}
