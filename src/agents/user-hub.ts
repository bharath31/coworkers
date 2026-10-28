import { Agent, callable, getAgentByName } from "agents"
import type { Connection as AgentConnection, ConnectionContext } from "agents"
import { generateText } from "ai"
import webpush from "web-push"
import { DEFAULT_MODEL_SETTINGS, isModelId } from "@/lib/models"
import type { ModelSettings, ModelTestResult } from "@/lib/models"
import { BOT_AVATARS, NEW_BOT_NAME, botInstanceName } from "@/lib/types"
import type {
  AppCatalog,
  AppTool,
  AttentionItem,
  GroupChatMessage,
  GroupChatSummary,
  ProjectFileSummary,
  BotAttachment,
  BotSummary,
  Connection,
  HubState,
  PushSubscriptionData,
} from "@/lib/types"
import type { BotAgent } from "./bot-agent"
import { MAX_MEMORY_CHARS, appendFact } from "./memory"
import { deploymentModels, languageModel } from "./models"

const READ_VERBS =
  /(^|[_\-.])(get|list|search|read|fetch|find|query|lookup|describe|view|show|count)([_\-.]|$)/i
const WRITE_VERBS =
  /(^|[_\-.])(send|create|delete|remove|update|edit|post|write|set|move|archive|reply|forward|draft|cancel|pay|approve|invite|share|execute|run)([_\-.]|$)/i
const DAY_MS = 86_400_000
const PROJECT_FILE_MAX_BYTES = 5 * 1024 * 1024
const PROJECT_FILE_TOTAL_BYTES = 50 * 1024 * 1024

/**
 * Background turns may only use read-only app tools. Servers that do not
 * annotate their tools get a conservative guess from the name.
 */
function looksReadOnly(name: string) {
  return READ_VERBS.test(name) && !WRITE_VERBS.test(name)
}

/** MCP server id for a connection; it namespaces the connection's tools. */
function serverId(connectionId: string) {
  return `c${connectionId}`
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function safeProjectFileName(value: string) {
  const name = value.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, "").trim()
  if (!name || name === "." || name === "..") throw new Error("Choose a valid file name.")
  return name.slice(0, 180)
}

/**
 * One per user (instance name = user id). Owns the bot directory that powers
 * the sidebar, the user's connections, and routing between bots.
 *
 * Connections are MCP servers held here, once per user: one sign-in (OAuth
 * or headers) serves every bot. Bots read the tool catalog and call tools
 * through this hub over Durable Object RPC.
 *
 * `@callable()` methods are invoked by the browser over the agent
 * WebSocket. Plain public methods are Durable Object RPC, called by bots.
 */
export class UserHub extends Agent<Env, HubState> {
  initialState: HubState = { bots: [], connections: [] }

  async onStart() {
    // Push endpoints are capability URLs: keep them out of broadcast state.
    this.sql`CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`
    this.sql`CREATE TABLE IF NOT EXISTS group_chats (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      bot_ids TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      preview TEXT NOT NULL DEFAULT ''
    )`
    this.sql`CREATE TABLE IF NOT EXISTS group_chat_messages (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      role TEXT NOT NULL,
      bot_id TEXT,
      text TEXT NOT NULL,
      at INTEGER NOT NULL
    )`
    this.sql`CREATE INDEX IF NOT EXISTS group_messages_by_time
      ON group_chat_messages (group_id, at)`
    this.sql`CREATE TABLE IF NOT EXISTS project_files (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      shared_by TEXT NOT NULL,
      shared_at INTEGER NOT NULL,
      content BLOB NOT NULL
    )`
    // The deployment's MODEL or gateway may have changed since last start.
    this.setState({
      ...this.state,
      groups: this.groups(),
      workspace:
        this.name === this.env.HOUSEHOLD_WORKSPACE_ID
          ? { id: this.name, name: "Our Home", kind: "household" }
          : { id: this.name, name: "Private", kind: "private" },
      models: { ...DEFAULT_MODEL_SETTINGS, ...this.state.models },
      deployment: deploymentModels(this.env),
    })
    // Memory every bot of this user reads, with its edit history.
    this.sql`CREATE TABLE IF NOT EXISTS shared_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      source TEXT NOT NULL,
      content TEXT NOT NULL
    )`
    // After an MCP sign-in completes, send the user back to Connections.
    this.mcp.configureOAuthCallback({
      customHandler: (result) => {
        this.syncConnectionStatus()
        const query = result.authSuccess
          ? ""
          : `&error=${encodeURIComponent(result.authError)}`
        return new Response(null, {
          status: 302,
          headers: { Location: `/settings?tab=connections${query}` },
        })
      },
    })
    await this.restoreLegacyConnections()
  }

  private groups(): GroupChatSummary[] {
    return this.sql<{
      id: string
      name: string
      bot_ids: string
      updated_at: number
      preview: string
    }>`SELECT id, name, bot_ids, updated_at, preview FROM group_chats
      ORDER BY updated_at DESC`.map((row) => ({
      id: row.id,
      name: row.name,
      botIds: JSON.parse(row.bot_ids) as string[],
      updatedAt: row.updated_at,
      preview: row.preview,
    }))
  }

  private projectFiles(): ProjectFileSummary[] {
    return this.sql<ProjectFileSummary>`SELECT id, name, content_type AS contentType,
      size, shared_by AS sharedBy, shared_at AS sharedAt
      FROM project_files ORDER BY shared_at DESC LIMIT 100`
  }

  /** Bot-facing RPC: list shared file metadata for prompt context and tools. */
  async listProjectFiles(): Promise<ProjectFileSummary[]> {
    return this.projectFiles()
  }

  /** Remember the app's origin to build MCP OAuth callback URLs. */
  onConnect(_connection: AgentConnection, ctx: ConnectionContext) {
    this.ctx.storage.kv.put("origin", new URL(ctx.request.url).origin)
    this.syncConnectionStatus()
  }

  private get userId() {
    return this.name
  }

  private get origin() {
    return this.ctx.storage.kv.get<string>("origin")
  }

  private bot(botId: string) {
    // The binding is declared by Worker name in cloudflare.config.ts, so its
    // generated type does not carry the class.
    return getAgentByName(
      this.env.BotAgent as unknown as DurableObjectNamespace<BotAgent>,
      botInstanceName(this.userId, botId)
    )
  }

  private patchBot(botId: string, patch: Partial<BotSummary>) {
    this.setState({
      ...this.state,
      bots: this.state.bots.map((b) =>
        b.id === botId ? { ...b, ...patch } : b
      ),
    })
  }

  // ── Browser-facing ──────────────────────────────────────────────────

  @callable()
  async createBot(): Promise<BotSummary> {
    // Each bot gets its own shape until the roster runs out.
    const taken = new Set(this.state.bots.map((b) => b.avatar))
    const avatar =
      BOT_AVATARS.find((a) => !taken.has(a)) ??
      BOT_AVATARS[this.state.bots.length % BOT_AVATARS.length]
    const summary: BotSummary = {
      id: crypto.randomUUID().slice(0, 8),
      name: NEW_BOT_NAME,
      avatar,
      status: "idle",
      preview: "",
      updatedAt: Date.now(),
      unread: false,
    }
    this.setState({ ...this.state, bots: [summary, ...this.state.bots] })

    const bot = await this.bot(summary.id)
    await bot.setup(summary.avatar)
    return summary
  }

  @callable()
  async deleteBot(botId: string) {
    // Drop it from the directory first: `destroy()` aborts the bot's isolate,
    // so calls to it reject ("destroyed") even when the teardown went through.
    // That includes the lookup, which calls the bot too, so neither may fail
    // the delete.
    this.setState({
      ...this.state,
      bots: this.state.bots.filter((b) => b.id !== botId),
    })
    try {
      const bot = await this.bot(botId)
      await bot.destroy()
    } catch (err) {
      console.warn(`deleteBot ${botId}: teardown reported`, err)
    }
  }

  @callable()
  async createGroup(name: string, botIds: string[]): Promise<GroupChatSummary> {
    const selected = [...new Set(botIds)].filter((id) =>
      this.state.bots.some((bot) => bot.id === id)
    )
    if (selected.length < 2) throw new Error("Choose at least two bots.")
    if (selected.length > 6) throw new Error("A group can have up to six bots.")
    const label = name.trim().slice(0, 60) || "New group"
    const now = Date.now()
    const group: GroupChatSummary = {
      id: crypto.randomUUID().slice(0, 12),
      name: label,
      botIds: selected,
      updatedAt: now,
      preview: "Start a conversation with your bots",
    }
    this.sql`INSERT INTO group_chats
      (id, name, bot_ids, created_at, updated_at, preview)
      VALUES (${group.id}, ${group.name}, ${JSON.stringify(selected)}, ${now}, ${now}, ${group.preview})`
    this.setState({ ...this.state, groups: [group, ...(this.state.groups ?? [])] })
    return group
  }

  @callable()
  async getGroupMessages(groupId: string): Promise<GroupChatMessage[]> {
    if (!(this.state.groups ?? []).some((group) => group.id === groupId)) {
      throw new Error("Group not found.")
    }
    return this.sql<GroupChatMessage>`SELECT id, sender_id AS senderId,
      sender_name AS senderName, role, text, at, bot_id AS botId
      FROM group_chat_messages WHERE group_id = ${groupId}
      ORDER BY at ASC LIMIT 200`
  }

  @callable()
  async uploadProjectFile(input: {
    name: string
    contentType?: string
    bytes: Uint8Array
  }): Promise<ProjectFileSummary> {
    return this.saveProjectFile(input.name, input.contentType ?? "application/octet-stream", input.bytes, "You")
  }

  @callable()
  async getProjectFiles() {
    return this.projectFiles()
  }

  @callable()
  async removeProjectFile(id: string) {
    this.sql`DELETE FROM project_files WHERE id = ${id}`
    return this.projectFiles()
  }

  @callable()
  async downloadProjectFile(id: string) {
    return this.getProjectFile(id)
  }

  /** Bot-facing RPC: store a file that its owner approved for workspace sharing. */
  async saveProjectFile(
    name: string,
    contentType: string,
    bytes: Uint8Array,
    sharedBy: string
  ): Promise<ProjectFileSummary> {
    if (!(bytes instanceof Uint8Array)) throw new Error("File data must be binary.")
    if (bytes.byteLength < 1 || bytes.byteLength > PROJECT_FILE_MAX_BYTES) {
      throw new Error("Shared files must be smaller than 5 MB.")
    }
    const total = this.sql<{ bytes: number }>`SELECT COALESCE(SUM(size), 0) AS bytes
      FROM project_files`[0]?.bytes ?? 0
    if (total + bytes.byteLength > PROJECT_FILE_TOTAL_BYTES) {
      throw new Error("Shared project files are limited to 50 MB total. Remove an old file first.")
    }
    const fileName = safeProjectFileName(name)
    const id = crypto.randomUUID().slice(0, 12)
    const sharedAt = Date.now()
    const summary: ProjectFileSummary = {
      id,
      name: fileName,
      contentType: contentType.slice(0, 120) || "application/octet-stream",
      size: bytes.byteLength,
      sharedBy: sharedBy.slice(0, 60),
      sharedAt,
    }
    this.sql`INSERT INTO project_files
      (id, name, content_type, size, shared_by, shared_at, content)
      VALUES (${id}, ${fileName}, ${summary.contentType}, ${summary.size}, ${summary.sharedBy}, ${sharedAt}, ${bytes})`
    this.sql`DELETE FROM project_files WHERE id NOT IN
      (SELECT id FROM project_files ORDER BY shared_at DESC LIMIT 100)`
    return summary
  }

  /** Bot-facing RPC: read one explicitly shared workspace file. */
  async getProjectFile(id: string) {
    const row = this.sql<{
      id: string
      name: string
      contentType: string
      size: number
      sharedBy: string
      sharedAt: number
      bytes: Uint8Array
    }>`SELECT id, name, content_type AS contentType, size,
      shared_by AS sharedBy, shared_at AS sharedAt, content AS bytes
      FROM project_files WHERE id = ${id}`[0]
    if (!row) return null
    const { bytes, ...file } = row
    return { file, bytes }
  }

  @callable()
  async sendGroupMessage(groupId: string, text: string) {
    const body = text.trim().slice(0, 4000)
    if (!body) throw new Error("Message is empty.")
    const group = (this.state.groups ?? []).find((item) => item.id === groupId)
    if (!group) throw new Error("Group not found.")
    const id = crypto.randomUUID()
    const now = Date.now()
    this.storeGroupMessage({
      id,
      groupId,
      senderId: "user",
      senderName: "You",
      role: "user",
      text: body,
      at: now,
    })
    const nextGroup = { ...group, updatedAt: now, preview: body.slice(0, 140) }
    this.setState({
      ...this.state,
      groups: [nextGroup, ...this.groups().filter((item) => item.id !== groupId)],
    })
    const participants = group.botIds
      .map((botId) => this.state.bots.find((bot) => bot.id === botId))
      .filter((bot): bot is BotSummary => !!bot)
    const mentions = participants.filter((bot) =>
      new RegExp(`(^|\\s)@${escapeRegex(bot.name)}(?=$|\\s|[,.:!?])`, "i").test(body)
    )
    const recipients = mentions.length ? mentions : participants
    const history = this.sql<{ sender_name: string; text: string }>`SELECT sender_name, text
      FROM group_chat_messages WHERE group_id = ${groupId}
      ORDER BY at DESC LIMIT 20`.reverse()
    const context = history
      .map((message) => `${message.sender_name}: ${message.text}`)
      .join("\n")
    await Promise.all(
      recipients.map(async (recipient) => {
        const stamp = Date.now()
        try {
          const reply = await (await this.bot(recipient.id)).receiveGroupMessage(
            group.id,
            group.name,
            context,
            `@${recipient.name} respond to the latest message. If another bot should own a part, use message_bot to delegate it. Keep your response concise and include your findings here.`,
            { key: `group:${group.id}:${id}:${recipient.id}` }
          )
          if (reply.trim()) {
            this.storeGroupMessage({
              id: crypto.randomUUID(),
              groupId,
              senderId: recipient.id,
              senderName: recipient.name,
              role: "assistant",
              text: reply.slice(0, 8000),
              at: stamp,
              botId: recipient.id,
            })
          }
        } catch (err) {
          this.storeGroupMessage({
            id: crypto.randomUUID(),
            groupId,
            senderId: recipient.id,
            senderName: recipient.name,
            role: "system",
            text: `Could not reach ${recipient.name}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500),
            at: Date.now(),
            botId: recipient.id,
          })
        }
      })
    )
    const latest = this.sql<{ text: string }>`SELECT text FROM group_chat_messages
      WHERE group_id = ${groupId} ORDER BY at DESC LIMIT 1`[0]?.text
    const updated = this.groups().find((item) => item.id === groupId)
    if (updated) {
      this.setState({
        ...this.state,
        groups: [
          { ...updated, preview: (latest ?? body).slice(0, 140) },
          ...this.groups().filter((item) => item.id !== groupId),
        ],
      })
    }
    return this.getGroupMessages(groupId)
  }

  private storeGroupMessage(
    message: GroupChatMessage & { groupId: string }
  ) {
    this.sql`INSERT INTO group_chat_messages
      (id, group_id, sender_id, sender_name, role, bot_id, text, at)
      VALUES (${message.id}, ${message.groupId}, ${message.senderId}, ${message.senderName},
        ${message.role}, ${message.botId ?? null}, ${message.text}, ${message.at})`
    this.sql`UPDATE group_chats SET updated_at = ${message.at}, preview = ${message.text.slice(0, 140)}
      WHERE id = ${message.groupId}`
    this.sql`DELETE FROM group_chat_messages WHERE group_id = ${message.groupId}
      AND id NOT IN (SELECT id FROM group_chat_messages
        WHERE group_id = ${message.groupId} ORDER BY at DESC LIMIT 200)`
  }

  /** Route a bot-to-bot handoff through the same visible group transcript. */
  async relayGroupMessage(
    groupId: string,
    fromBotId: string,
    to: string,
    text: string,
    delivery: { key?: string; hops?: number; files?: BotAttachment[] } = {}
  ) {
    const group = (this.state.groups ?? []).find((item) => item.id === groupId)
    const from = this.state.bots.find((bot) => bot.id === fromBotId)
    const needle = to.trim().toLowerCase()
    const target = this.state.bots.find(
      (bot) =>
        group?.botIds.includes(bot.id) &&
        (bot.id === needle || bot.name.toLowerCase() === needle)
    )
    if (!group || !from || !group.botIds.includes(fromBotId)) {
      return { delivered: false, error: "This bot is not a member of that group." }
    }
    if (!target) return { delivered: false, error: "Choose a bot in this group." }
    if (target.id === fromBotId) return { delivered: false, error: "A bot cannot message itself." }
    const handoff = `${from.name} asked ${target.name} to take this step:\n${text}`
    this.storeGroupMessage({
      id: crypto.randomUUID(),
      groupId,
      senderId: from.id,
      senderName: from.name,
      role: "assistant",
      text: handoff.slice(0, 8000),
      at: Date.now(),
      botId: from.id,
    })
    const history = this.sql<{ sender_name: string; text: string }>`SELECT sender_name, text
      FROM group_chat_messages WHERE group_id = ${groupId}
      ORDER BY at DESC LIMIT 20`.reverse()
      .map((message) => `${message.sender_name}: ${message.text}`)
      .join("\n")
    const reply = await (await this.bot(target.id)).receiveGroupMessage(
      groupId,
      group.name,
      history,
      `Respond to ${from.name}'s group handoff. Return your result in this shared conversation.`,
      {
        key: delivery.key ?? `group-handoff:${groupId}:${crypto.randomUUID()}`,
        hops: delivery.hops,
        files: delivery.files,
      }
    )
    if (reply.trim()) {
      this.storeGroupMessage({
        id: crypto.randomUUID(),
        groupId,
        senderId: target.id,
        senderName: target.name,
        role: "assistant",
        text: reply.slice(0, 8000),
        at: Date.now(),
        botId: target.id,
      })
    }
    return { delivered: true, to: target.name, reply }
  }

  @callable()
  markRead(botId: string) {
    if (this.state.bots.find((b) => b.id === botId)?.unread) {
      this.patchBot(botId, { unread: false })
    }
  }

  /** A bot's unanswered cards, for answering them from the sidebar. */
  @callable()
  async waitingParts(botId: string) {
    if (!this.state.bots.some((b) => b.id === botId)) return null
    return (await this.bot(botId)).waitingParts()
  }

  @callable()
  async answerApproval(botId: string, approvalId: string, approved: boolean) {
    if (!this.state.bots.some((b) => b.id === botId)) {
      throw new Error("No such bot.")
    }
    await (await this.bot(botId)).answerApproval(approvalId, approved)
  }

  @callable()
  async getAttentionSnapshot(): Promise<AttentionItem[]> {
    const now = Date.now()
    const snapshots = await Promise.all(
      this.state.bots.map(async (summary) => {
        const items: AttentionItem[] = []
        let bot: BotAgent
        let waiting: Awaited<ReturnType<BotAgent["waitingParts"]>>
        let tasks: Awaited<ReturnType<BotAgent["getBackgroundTasks"]>>
        let openItems: Awaited<ReturnType<BotAgent["listOpenItems"]>>
        let routineRuns: Awaited<ReturnType<BotAgent["getRoutineRuns"]>>
        try {
          bot = await this.bot(summary.id)
          ;[waiting, tasks, openItems, routineRuns] = await Promise.all([
            bot.waitingParts(),
            bot.getBackgroundTasks(),
            bot.listOpenItems(),
            bot.getRoutineRuns(),
          ])
        } catch (err) {
          return [{
            id: `unavailable:${summary.id}`,
            botId: summary.id,
            botName: summary.name,
            avatar: summary.avatar,
            kind: "task" as const,
            title: `${summary.name} could not be checked`,
            detail: err instanceof Error ? err.message : "The bot is temporarily unavailable.",
            at: now,
          }]
        }
        if (waiting) {
          const text = waiting.parts
            .map((part) => (part.type === "text" ? part.text : ""))
            .join(" ")
            .trim()
          items.push({
            id: `approval:${summary.id}`,
            botId: summary.id,
            botName: summary.name,
            avatar: summary.avatar,
            kind: "approval",
            title: "Approval needed",
            detail: text || summary.preview || "A bot is waiting for your decision.",
            at: summary.updatedAt,
          })
        }
        for (const task of tasks) {
          const taskStatus = String(task.status)
          const failed = taskStatus === "error" || taskStatus === "failed"
          const recentlyFinished = taskStatus === "complete" || taskStatus === "completed"
          const happenedAt = task.completedAt ?? task.createdAt
          if (
            (failed && happenedAt <= now - 7 * DAY_MS) ||
            (!failed && !(recentlyFinished && happenedAt > now - DAY_MS))
          ) continue
          items.push({
            id: `task:${summary.id}:${task.id}`,
            botId: summary.id,
            botName: summary.name,
            avatar: summary.avatar,
            kind: "task",
            title: failed ? `Task failed: ${task.title}` : `Task finished: ${task.title}`,
            detail: task.error ?? "Open the bot to review the result.",
            at: happenedAt,
          })
        }
        for (const item of openItems) {
          if (item.status !== "open" || !item.checkAfter || item.checkAfter > now) continue
          items.push({
            id: `open:${summary.id}:${item.id}`,
            botId: summary.id,
            botName: summary.name,
            avatar: summary.avatar,
            kind: "open-item",
            title: item.title,
            detail: item.note,
            at: item.checkAfter,
          })
        }
        const seenRoutines = new Set<string>()
        for (const failedRun of routineRuns) {
          const at = failedRun.finishedAt ?? failedRun.startedAt
          if (
            (failedRun.status !== "failed" && failedRun.status !== "retrying") ||
            at < now - 7 * DAY_MS ||
            seenRoutines.has(failedRun.routineId)
          ) continue
          seenRoutines.add(failedRun.routineId)
          items.push({
            id: `routine:${summary.id}:${failedRun.id}`,
            botId: summary.id,
            botName: summary.name,
            avatar: summary.avatar,
            kind: "routine",
            title: `Routine needs attention: ${failedRun.name}`,
            detail: failedRun.note || `Last run ${failedRun.status}.`,
            at,
          })
        }
        return items
      })
    )
    return snapshots.flat().sort((a, b) => b.at - a.at)
  }

  @callable()
  async addConnection(input: {
    name: string
    url: string
    headers?: Record<string, string>
  }): Promise<Connection> {
    const url = new URL(input.url)
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      throw new Error("Connection URL must use https")
    }
    const headers = input.headers ?? {}
    const id = crypto.randomUUID().slice(0, 8)
    const name = input.name.trim() || url.hostname
    // The MCP client persists the URL and headers itself; only header names
    // go into `state`, which is broadcast to the browser.
    await this.addMcpServer(name, url.toString(), {
      id: serverId(id),
      callbackHost: this.origin,
      transport: { headers },
    })
    const connection: Connection = {
      id,
      name,
      url: url.toString(),
      headerNames: Object.keys(headers),
      status: "connecting",
      tools: 0,
    }
    this.setState({
      ...this.state,
      connections: [...this.state.connections, connection],
    })
    this.syncConnectionStatus()
    return this.state.connections.find((c) => c.id === id) ?? connection
  }

  @callable()
  async removeConnection(connectionId: string) {
    if (this.getMcpServers().servers[serverId(connectionId)]) {
      await this.removeMcpServer(serverId(connectionId))
    }
    this.setState({
      ...this.state,
      connections: this.state.connections.filter((c) => c.id !== connectionId),
    })
  }

  /**
   * Re-read connection state, e.g. when the Connections page opens. Right
   * after a sign-in the MCP client finishes connecting in the background, so
   * wait for it before reporting.
   */
  @callable()
  async refreshConnections() {
    this.syncConnectionStatus()
    await this.mcp.waitForConnections({ timeout: 10_000 })
    this.syncConnectionStatus()
  }

  /** Retry a connection: a fresh sign-in link, or a new handshake. */
  @callable()
  async reconnect(connectionId: string) {
    const id = serverId(connectionId)
    const result = await this.mcp.connectToServer(id)
    if (result.state === "connected") await this.mcp.discoverIfConnected(id)
    this.syncConnectionStatus()
  }

  // ── Push notifications ──────────────────────────────────────────────

  /** Null when the deployment has no VAPID keys, so push is unavailable. */
  @callable()
  pushPublicKey(): string | null {
    return this.env.VAPID_PUBLIC_KEY && this.env.VAPID_PRIVATE_KEY
      ? this.env.VAPID_PUBLIC_KEY
      : null
  }

  @callable()
  subscribePush(subscription: PushSubscriptionData) {
    const url = new URL(subscription.endpoint)
    if (url.protocol !== "https:") throw new Error("Invalid push endpoint")
    if (!subscription.keys?.p256dh || !subscription.keys?.auth) {
      throw new Error("Push subscription is missing its keys")
    }
    this
      .sql`INSERT OR REPLACE INTO push_subscriptions (endpoint, data, created_at)
      VALUES (${subscription.endpoint}, ${JSON.stringify(subscription)}, ${Date.now()})`
  }

  @callable()
  unsubscribePush(endpoint: string) {
    this.sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`
  }

  @callable()
  isPushSubscribed(endpoint: string): boolean {
    return (
      this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM push_subscriptions
        WHERE endpoint = ${endpoint}`[0]?.n > 0
    )
  }

  /** Send a test notification to every device this user subscribed. */
  @callable()
  async testPush() {
    return this.push({
      title: "Alfred",
      body: "Notifications are on. Your bots will reach you here.",
      tag: "test",
      url: "/",
    })
  }

  private async push(payload: {
    title: string
    body: string
    tag: string
    url: string
  }): Promise<{ sent: number }> {
    const publicKey = this.pushPublicKey()
    if (!publicKey) return { sent: 0 }
    const rows = this.sql<{ endpoint: string; data: string }>`
      SELECT endpoint, data FROM push_subscriptions`
    if (rows.length === 0) return { sent: 0 }
    webpush.setVapidDetails(
      this.env.VAPID_SUBJECT,
      publicKey,
      this.env.VAPID_PRIVATE_KEY
    )
    let sent = 0
    await Promise.all(
      rows.map(async (row) => {
        try {
          await webpush.sendNotification(
            JSON.parse(row.data) as PushSubscriptionData,
            JSON.stringify(payload),
            { TTL: 60 * 60 * 12 }
          )
          sent++
        } catch (err) {
          const status =
            err instanceof webpush.WebPushError ? err.statusCode : 0
          // The browser unsubscribed or the subscription expired.
          if (status === 404 || status === 410) {
            this
              .sql`DELETE FROM push_subscriptions WHERE endpoint = ${row.endpoint}`
          } else {
            console.error("Push failed", status, err)
          }
        }
      })
    )
    return { sent }
  }

  /** Copy live MCP client state (status, sign-in URL, tool count) into `state`. */
  private syncConnectionStatus() {
    const { servers, tools } = this.getMcpServers()
    const connections = this.state.connections.map((c) => {
      const server = servers[serverId(c.id)]
      const next: Connection = {
        id: c.id,
        name: c.name,
        url: c.url,
        headerNames: c.headerNames,
        status: server?.state ?? "failed",
        tools: tools.filter((t) => t.serverId === serverId(c.id)).length,
        ...(c.lastFailure ? { lastFailure: c.lastFailure } : {}),
        ...(server?.auth_url ? { authUrl: server.auth_url } : {}),
        ...(server?.error
          ? { error: server.error }
          : server
            ? {}
            : { error: "Not connected. Remove it and add it again." }),
      }
      return next
    })
    if (
      JSON.stringify(connections) !== JSON.stringify(this.state.connections)
    ) {
      this.setState({ ...this.state, connections })
    }
  }

  /**
   * Connections used to live on each bot, with header values in a table
   * here. Re-register any that the hub's MCP client does not know yet.
   */
  private async restoreLegacyConnections() {
    const legacy = this.sql<{ name: string }>`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'connection_headers'`
    const rows = legacy.length
      ? this.sql<{ connection_id: string; headers: string }>`
          SELECT connection_id, headers FROM connection_headers`
      : []
    const headers = new Map(
      rows.map((r) => [
        r.connection_id,
        JSON.parse(r.headers) as Record<string, string>,
      ])
    )
    const known = this.getMcpServers().servers
    for (const c of this.state.connections) {
      if (known[serverId(c.id)]) continue
      try {
        await this.addMcpServer(c.name, c.url, {
          id: serverId(c.id),
          callbackHost: this.origin,
          transport: { headers: headers.get(c.id) ?? {} },
        })
      } catch (err) {
        console.error(`Restoring connection "${c.name}" failed`, err)
      }
    }
    if (legacy.length) this.sql`DROP TABLE connection_headers`
    // Older states also carried a per-bot toolkit; every bot now gets all.
    if (this.state.bots.some((b) => "connectionIds" in b)) {
      this.setState({
        ...this.state,
        bots: this.state.bots.map(
          ({
            connectionIds: _unused,
            ...b
          }: BotSummary & {
            connectionIds?: string[]
          }) => b
        ),
      })
    }
    this.syncConnectionStatus()
  }

  // ── Server-facing (Durable Object RPC) ──────────────────────────────

  /** State for the first server render, before the WebSocket connects. */
  async snapshot(): Promise<HubState> {
    return this.state
  }

  /** The account's sidebar name, stored on its private UserHub. */
  async profileName(): Promise<string | null> {
    return (await this.ctx.storage.kv.get<string>("profile-name")) ?? null
  }

  /** Save a profile name on the authenticated account's private UserHub. */
  async setProfileName(name: string | null): Promise<void> {
    if (name === null) {
      await this.ctx.storage.kv.delete("profile-name")
      return
    }
    await this.ctx.storage.kv.put("profile-name", name)
  }

  // ── Bot-facing (Durable Object RPC) ─────────────────────────────────

  /** A bot reports its own status, preview, or new name. */
  async reportBot(
    botId: string,
    patch: Partial<Pick<BotSummary, "name" | "status" | "preview" | "unread">>
  ) {
    const touched = patch.preview !== undefined || patch.name !== undefined
    this.patchBot(botId, {
      ...patch,
      ...(touched ? { updatedAt: Date.now() } : {}),
    })
  }

  // ── Models ──────────────────────────────────────────────────────────

  /** Durable Object RPC: what a bot's next turn runs on. */
  async modelSettings(): Promise<ModelSettings> {
    return { ...DEFAULT_MODEL_SETTINGS, ...this.state.models }
  }

  @callable()
  setModels(patch: Partial<ModelSettings>) {
    const next = { ...DEFAULT_MODEL_SETTINGS, ...this.state.models }
    for (const key of ["chat", "background"] as const) {
      const value = patch[key]
      if (value === undefined) continue
      const id = value?.trim() || null
      if (id && !isModelId(id)) throw new Error(`"${id}" is not a model id.`)
      next[key] = id
    }
    if (patch.fallback !== undefined) next.fallback = !!patch.fallback
    this.setState({ ...this.state, models: next })
  }

  /**
   * One short call through the gateway, without the fallback, so the
   * Models page can say whether a model actually works before bots use it.
   */
  @callable()
  async testModel(modelId: string): Promise<ModelTestResult> {
    const started = Date.now()
    try {
      if (!isModelId(modelId)) throw new Error("That is not a model id.")
      const result = await generateText({
        model: languageModel(this.env, modelId, {
          settings: { ...DEFAULT_MODEL_SETTINGS, fallback: false },
        }),
        prompt:
          "Say hello to the person setting you up, in one short, warm sentence. No preamble.",
        maxOutputTokens: 400,
      })
      return {
        ok: true,
        ms: Date.now() - started,
        reply: result.text.trim().slice(0, 300) || "(empty reply)",
      }
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String(err.code)
          : "unknown"
      return {
        ok: false,
        ms: Date.now() - started,
        code,
        message: (err instanceof Error ? err.message : String(err)).slice(
          0,
          400
        ),
      }
    }
  }

  // ── Shared memory ───────────────────────────────────────────────────

  /** Durable Object RPC: what every bot reads in its prompt. */
  async sharedMemory(): Promise<string> {
    return (
      this.sql<{
        content: string
      }>`SELECT content FROM shared_memory ORDER BY id DESC LIMIT 1`[0]
        ?.content ?? ""
    )
  }

  /** Durable Object RPC: a bot saves a fact for all of the user's bots. */
  async rememberShared(fact: string, botName: string) {
    const result = appendFact(await this.sharedMemory(), fact)
    if ("content" in result) this.saveShared(result.content, botName)
    return "content" in result
      ? { saved: true }
      : "duplicate" in result
        ? { saved: false, reason: "Already remembered." }
        : { saved: false, error: result.error }
  }

  @callable()
  async getSharedMemory() {
    return {
      content: await this.sharedMemory(),
      revisions: this.sql<{
        id: number
        at: number
        source: string
      }>`SELECT id, at, source
        FROM shared_memory ORDER BY id DESC LIMIT 20`,
    }
  }

  @callable()
  async setSharedMemory(content: string) {
    if (content.length > MAX_MEMORY_CHARS) {
      throw new Error(
        `Shared memory is limited to ${MAX_MEMORY_CHARS} characters.`
      )
    }
    if (content !== (await this.sharedMemory())) this.saveShared(content, "You")
  }

  @callable()
  async restoreSharedMemory(revisionId: number) {
    const row = this.sql<{
      content: string
    }>`SELECT content FROM shared_memory WHERE id = ${revisionId}`[0]
    if (row) this.saveShared(row.content, "You (restored)")
  }

  private saveShared(content: string, source: string) {
    this
      .sql`INSERT INTO shared_memory (at, source, content) VALUES (${Date.now()}, ${source}, ${content})`
    this
      .sql`DELETE FROM shared_memory WHERE id <= (SELECT MAX(id) FROM shared_memory) - 50`
  }

  async listBots(): Promise<BotSummary[]> {
    return this.state.bots
  }

  /** Inbound email and webhooks check this before waking a bot. */
  async hasBot(botId: string): Promise<boolean> {
    return this.state.bots.some((b) => b.id === botId)
  }

  /** A bot has something for the user: push it to their devices. */
  async notifyUser(botId: string, body: string) {
    const bot = this.state.bots.find((b) => b.id === botId)
    if (!bot) return { sent: 0 }
    return this.push({
      title: bot.name,
      body,
      // One notification per bot: a newer one replaces the older.
      tag: `bot-${botId}`,
      url: `/bots/${botId}`,
    })
  }

  /** Every connected tool, for a bot's next turn. */
  async appCatalog(): Promise<AppCatalog> {
    await this.mcp.waitForConnections({ timeout: 5000 })
    this.syncConnectionStatus()
    const names = new Map(
      this.state.connections.map((c) => [serverId(c.id), c] as const)
    )
    const tools: AppTool[] = []
    for (const t of this.mcp.listTools()) {
      const connection = names.get(t.serverId)
      if (!connection) continue
      tools.push({
        connectionId: connection.id,
        connectionName: connection.name,
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema as Record<string, unknown>,
        readOnly: t.annotations?.readOnlyHint ?? looksReadOnly(t.name),
      })
    }
    return {
      apps: this.state.connections.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        tools: c.tools,
        ...(c.error ? { error: c.error } : {}),
      })),
      tools,
    }
  }

  /** Run a connection's tool on behalf of a bot. Credentials stay here. */
  async callAppTool(
    connectionId: string,
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.state.connections.some((c) => c.id === connectionId)) {
      throw new Error("That connection was removed.")
    }
    let result: unknown
    try {
      result = await this.mcp.callTool({
        serverId: serverId(connectionId),
        name,
        arguments: args,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const kind = classifyAppFailure(message)
      this.noteAppCall(connectionId, {
        at: Date.now(),
        message: message.slice(0, 300),
        kind,
      })
      const app =
        this.state.connections.find((c) => c.id === connectionId)?.name ??
        "This app"
      throw new Error(
        kind === "auth"
          ? `${app} rejected the request because its sign-in expired or was revoked. Tell the user to reconnect ${app} in Connections. Do not retry until they have.`
          : kind === "unreachable"
            ? `${app} could not be reached (${message.slice(0, 120)}). It may be down. Tell the user if it matters; do not retry more than once.`
            : message
      )
    }
    this.noteAppCall(connectionId, null)
    // Structured clone over RPC: keep the plain JSON parts of the result.
    return JSON.parse(JSON.stringify(result)) as unknown
  }

  /** Remember the latest failed call per connection, for the Connections page. */
  private noteAppCall(
    connectionId: string,
    failure: Connection["lastFailure"] | null
  ) {
    const current = this.state.connections.find((c) => c.id === connectionId)
    if (!current || (!failure && !current.lastFailure)) return
    this.setState({
      ...this.state,
      connections: this.state.connections.map((c) => {
        if (c.id !== connectionId) return c
        const { lastFailure: _, ...rest } = c
        return failure ? { ...rest, lastFailure: failure } : rest
      }),
    })
  }

  /** Where the user opens Coworkers, so bots can hand out full app links. */
  async appOrigin(): Promise<string | null> {
    return this.origin ?? null
  }

  /** Deliver a message from one bot to another, matched by name or id. */
  async relayMessage(
    fromBotId: string,
    to: string,
    text: string,
    delivery: { key?: string; hops?: number; files?: BotAttachment[] } = {}
  ): Promise<{
    delivered: boolean
    to?: string
    error?: string
    files?: string[]
  }> {
    const from = this.state.bots.find((b) => b.id === fromBotId)
    const needle = to.trim().toLowerCase()
    const target = this.state.bots.find(
      (b) => b.id === needle || b.name.toLowerCase() === needle
    )
    if (!from) return { delivered: false, error: "Unknown sender" }
    if (!target) {
      const names = this.state.bots
        .filter((b) => b.id !== fromBotId)
        .map((b) => b.name)
      return {
        delivered: false,
        error: `No bot named "${to}". Available: ${names.join(", ") || "none"}`,
      }
    }
    if (target.id === fromBotId) {
      return { delivered: false, error: "A bot cannot message itself" }
    }
    const bot = await this.bot(target.id)
    const saved = await bot.receiveBotMessage(
      { kind: "bot", name: from.name, avatar: from.avatar },
      text,
      delivery
    )
    return {
      delivered: true,
      to: target.name,
      ...(saved.length ? { files: saved } : {}),
    }
  }
}

/** Sorts a failed app call: an expired sign-in, a server that is down, or the tool itself. */
function classifyAppFailure(message: string): "auth" | "unreachable" | "tool" {
  if (
    /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid[_ ]token|token (has )?expired/i.test(
      message
    )
  ) {
    return "auth"
  }
  if (
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network|timed? ?out|\b(502|503|504)\b|not connected/i.test(
      message
    )
  ) {
    return "unreachable"
  }
  return "tool"
}
