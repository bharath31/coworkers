import { useEffect, useState } from "react"
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router"
import { Button } from "@cloudflare/kumo/components/button"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import { ConnectionsSettings } from "@/components/connections-settings"
import { Group, Row } from "@/components/group"
import { SidebarSimpleIcon } from "@/components/icons"
import { ModelsSettings } from "@/components/models-settings"
import { SlidingTabs } from "@/components/sliding-tabs"
import { useHub } from "@/lib/hub-context"
import { setProfileName } from "@/lib/server-fns"
import { useLayout } from "@/lib/layout-context"

const TABS = [
  { value: "profile", label: "Profile" },
  { value: "models", label: "Models" },
  { value: "connections", label: "Connections" },
] as const

type Tab = (typeof TABS)[number]["value"]

function ProfileSettings() {
  const { viewer } = useHub()
  const router = useRouter()
  const [name, setName] = useState(viewer.label)
  const [saving, setSaving] = useState(false)

  useEffect(() => setName(viewer.label), [viewer.label])

  async function save(value: string) {
    setSaving(true)
    try {
      await setProfileName({ data: value })
      await router.invalidate()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <Group
        title="Your profile"
        hint="This name appears in the sidebar. It is saved to your account, including when you use a shared workspace."
      >
        <Row label="Display name">
          <input
            aria-label="Display name"
            autoComplete="name"
            maxLength={40}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full max-w-[60%] bg-transparent text-right text-sm text-kumo-default outline-none"
          />
        </Row>
      </Group>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={saving || name === viewer.label}
          onClick={() => void save("")}
        >
          Reset
        </Button>
        <Button
          size="sm"
          loading={saving}
          disabled={saving || !name.trim() || name.trim() === viewer.label}
          onClick={() => void save(name.trim())}
        >
          Save
        </Button>
      </div>
    </div>
  )
}

export const Route = createFileRoute("/_app/settings")({
  validateSearch: (
    search: Record<string, unknown>
  ): { tab?: Tab; error?: string; space?: string } => ({
    ...(typeof search.space === "string" ? { space: search.space } : {}),
    ...(search.tab === "profile" || search.tab === "connections"
      ? { tab: search.tab }
      : {}),
    // Set by the sign-in callback when an app's OAuth flow fails.
    ...(typeof search.error === "string" ? { error: search.error } : {}),
  }),
  component: Settings,
})

function Settings() {
  const { tab = "models", error } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { sidebarOpen, toggleSidebar } = useLayout()

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="col-header relative">
        <Tooltip
          content={sidebarOpen ? "Hide bots" : "Show bots"}
          render={
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label={sidebarOpen ? "Hide bots" : "Show bots"}
              aria-pressed={!sidebarOpen}
              className="icon-btn"
            >
              <SidebarSimpleIcon size={20} />
            </button>
          }
        />
        <h1 className="absolute left-1/2 -translate-x-1/2 text-[15px] font-medium text-kumo-default">
          Settings
        </h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[640px] space-y-8 px-6 pt-4 pb-16">
          <div className="flex justify-center">
            <SlidingTabs
              tabs={[...TABS]}
              value={tab}
              onValueChange={(next) =>
                void navigate({
                  search: (previous) => ({
                    ...previous,
                    ...(next === "models" ? { tab: undefined } : { tab: next }),
                  }),
                  replace: true,
                })
              }
            />
          </div>
          {tab === "profile" ? (
            <ProfileSettings />
          ) : tab === "models" ? (
            <ModelsSettings />
          ) : (
            <ConnectionsSettings error={error} />
          )}
        </div>
      </div>
    </section>
  )
}
