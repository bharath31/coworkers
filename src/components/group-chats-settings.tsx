import { useEffect, useMemo, useState } from "react"
import { Button } from "@cloudflare/kumo/components/button"
import { BotAvatar } from "@/components/bot-avatar"
import { useHub } from "@/lib/hub-context"
import type { GroupChatMessage } from "@/lib/types"

export function GroupChatsSettings() {
  const hub = useHub()
  const groups = hub.state.groups ?? []
  const [activeId, setActiveId] = useState<string | null>(groups[0]?.id ?? null)
  const [name, setName] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const [messages, setMessages] = useState<GroupChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = groups.find((group) => group.id === activeId) ?? null
  const members = useMemo(
    () =>
      (active?.botIds ?? [])
        .map((id) => hub.state.bots.find((bot) => bot.id === id))
        .filter((bot) => bot !== undefined),
    [active?.botIds, hub.state.bots]
  )

  useEffect(() => {
    if (!activeId && groups[0]) setActiveId(groups[0].id)
    if (activeId && !groups.some((group) => group.id === activeId)) {
      setActiveId(groups[0]?.id ?? null)
    }
  }, [activeId, groups])

  useEffect(() => {
    let current = true
    if (!activeId || !hub.groupChats) {
      setMessages([])
      return
    }
    void hub.groupChats.messages(activeId).then((rows) => {
      if (current) setMessages(rows)
    }).catch((err: unknown) => {
      if (current) setError(err instanceof Error ? err.message : String(err))
    })
    return () => {
      current = false
    }
  }, [activeId, hub.groupChats, groups])

  async function create() {
    if (!hub.groupChats || selected.length < 2) return
    setCreating(true)
    setError(null)
    try {
      const group = await hub.groupChats.create(name, selected)
      setActiveId(group.id)
      setSelected([])
      setName("")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  async function send() {
    const text = draft.trim()
    if (!active || !hub.groupChats || !text || loading) return
    setDraft("")
    setLoading(true)
    setError(null)
    try {
      setMessages(await hub.groupChats.send(active.id, text))
    } catch (err) {
      setDraft(text)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.4fr)]">
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-kumo-default">Group chats</h2>
          <p className="mt-1 text-sm text-kumo-subtle">
            Bring two to six bots into one shared conversation. Mention one bot to direct a turn; otherwise every member responds.
          </p>
        </div>
        <div className="space-y-1">
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => setActiveId(group.id)}
              className={`w-full rounded-xl px-3 py-2 text-left ${activeId === group.id ? "bg-(--fill-active)" : "hover:bg-(--fill-hover)"}`}
            >
              <span className="block truncate text-sm font-medium text-kumo-default">{group.name}</span>
              <span className="block truncate text-xs text-kumo-subtle">{group.preview}</span>
            </button>
          ))}
        </div>
        <div className="space-y-3 rounded-2xl bg-kumo-base p-4 outline outline-1 -outline-offset-1 outline-black/[0.06]">
          <h3 className="text-sm font-medium text-kumo-default">Create a group</h3>
          <input
            aria-label="Group name"
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Project room"
            className="w-full rounded-xl bg-(--fill-hover) px-3 py-2 text-sm text-kumo-default outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus"
          />
          <div className="space-y-1">
            {hub.state.bots.map((bot) => (
              <label key={bot.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-kumo-default hover:bg-(--fill-hover)">
                <input
                  type="checkbox"
                  checked={selected.includes(bot.id)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, bot.id]
                        : current.filter((id) => id !== bot.id)
                    )
                  }
                />
                <BotAvatar avatar={bot.avatar} size={24} />
                <span className="truncate">{bot.name}</span>
              </label>
            ))}
          </div>
          <Button
            size="sm"
            variant="primary"
            className="btn-ink rounded-full"
            disabled={!hub.groupChats || selected.length < 2 || creating}
            loading={creating}
            onClick={() => void create()}
          >
            Create group
          </Button>
        </div>
      </section>

      <section className="flex min-h-[480px] flex-col overflow-hidden rounded-2xl bg-kumo-base outline outline-1 -outline-offset-1 outline-black/[0.06]">
        <header className="border-b border-kumo-line px-4 py-3">
          <h2 className="text-sm font-medium text-kumo-default">{active?.name ?? "Choose a group"}</h2>
          <p className="mt-1 text-xs text-kumo-subtle">{members.map((bot) => bot.name).join(" · ")}</p>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
          {messages.map((message) => (
            <article key={message.id} className={`max-w-[90%] rounded-2xl px-3 py-2 ${message.role === "user" ? "ml-auto bg-(--fill-active)" : "bg-kumo-tint"}`}>
              <p className="mb-1 text-xs font-medium text-kumo-subtle">{message.senderName}</p>
              <p className="whitespace-pre-wrap break-words text-sm text-kumo-default">{message.text}</p>
            </article>
          ))}
          {!messages.length ? <p className="py-10 text-center text-sm text-kumo-subtle">Send a message to start the group thread.</p> : null}
          {loading ? <p className="text-sm text-kumo-subtle">The group is working…</p> : null}
        </div>
        <form
          className="border-t border-kumo-line p-3"
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <textarea
            aria-label="Message group"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void send()
              }
            }}
            disabled={!active || loading}
            maxLength={4000}
            rows={3}
            placeholder={active ? "Message the group… (⌘/Ctrl+Enter to send)" : "Create or choose a group"}
            className="w-full resize-y bg-transparent px-2 py-1 text-sm text-kumo-default outline-none placeholder:text-kumo-placeholder"
          />
          <div className="flex items-center justify-between px-2 pt-2">
            <p role="status" className="text-xs text-kumo-warning">{error}</p>
            <Button size="sm" variant="primary" className="btn-ink rounded-full" disabled={!active || !draft.trim() || loading} loading={loading} type="submit">Send</Button>
          </div>
        </form>
      </section>
    </div>
  )
}
