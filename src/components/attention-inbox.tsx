import { useCallback, useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { Button } from "@cloudflare/kumo/components/button"
import { BotAvatar } from "@/components/bot-avatar"
import { useHub } from "@/lib/hub-context"
import type { AttentionItem } from "@/lib/types"

function when(at: number) {
  return new Date(at).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function AttentionInbox() {
  const hub = useHub()
  const [items, setItems] = useState<AttentionItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!hub.attention) return
    setLoading(true)
    setError(null)
    try {
      setItems(await hub.attention())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [hub.attention])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <section className="mx-auto max-w-[760px] space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-kumo-default">Needs me</h2>
          <p className="mt-1 text-sm text-kumo-subtle">
            Approvals, finished background tasks, overdue follow-ups, and routine failures across your bots.
          </p>
        </div>
        <Button size="sm" variant="secondary" className="rounded-full" disabled={loading || !hub.attention} onClick={() => void refresh()}>
          Refresh
        </Button>
      </header>

      {error ? <p role="alert" className="text-sm text-kumo-warning">{error}</p> : null}
      {loading && !items.length ? <p className="py-8 text-center text-sm text-kumo-subtle">Checking your bots…</p> : null}
      {!loading && !error && !items.length ? (
        <div className="rounded-2xl bg-kumo-base px-5 py-10 text-center outline outline-1 -outline-offset-1 outline-black/[0.06]">
          <p className="text-sm font-medium text-kumo-default">You’re all caught up</p>
          <p className="mt-1 text-sm text-kumo-subtle">Your bots will show up here when they need your attention.</p>
        </div>
      ) : null}
      <div className="space-y-2">
        {items.map((item) => (
          <Link
            key={item.id}
            to="/bots/$botId"
            params={{ botId: item.botId }}
            search={true}
            className="flex items-start gap-3 rounded-2xl bg-kumo-base p-4 outline outline-1 -outline-offset-1 outline-black/[0.06] transition-colors hover:bg-(--fill-hover)"
          >
            <BotAvatar avatar={item.avatar} size={32} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-sm font-medium text-kumo-default">{item.title}</span>
                <span className="text-xs text-kumo-subtle">{when(item.at)}</span>
              </span>
              <span className="mt-1 block text-xs text-kumo-subtle">{item.botName} · {item.kind.replace("-", " ")}</span>
              <span className="mt-2 block whitespace-pre-wrap text-sm text-kumo-default">{item.detail}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
