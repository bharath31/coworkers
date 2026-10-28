import { createFileRoute } from "@tanstack/react-router"
import { getAgentByName } from "agents"
import { env } from "cloudflare:workers"
import { botInstanceName } from "@/lib/types"
import type { BotAgent } from "@/agents/bot-agent"
import type { UserHub } from "@/agents/user-hub"

const MAX_BODY_BYTES = 256 * 1024

async function readBodyWithinLimit(request: Request): Promise<string | null> {
  if (!request.body) return ""
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/**
 * POST /api/hooks/:userId/:botId/:token: an external service wakes a bot.
 * The token is per bot (Settings → Reach this bot) and can be rotated. The
 * body is handed to the bot as data for a background turn.
 *
 * If the app sits behind Cloudflare Access, add a bypass policy for
 * `/api/hooks/*` so services can reach it; the token is the auth.
 */
export const Route = createFileRoute("/api/hooks/$userId/$botId/$token")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const contentLength = request.headers.get("Content-Length")
        if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
          return Response.json({ error: "Payload too large" }, { status: 413 })
        }
        const hub = await getAgentByName(
          env.UserHub as unknown as DurableObjectNamespace<UserHub>,
          params.userId
        )
        // Looking up an unknown bot would create an empty Durable Object.
        if (!(await hub.hasBot(params.botId))) {
          return Response.json({ error: "Not found" }, { status: 404 })
        }
        const body = await readBodyWithinLimit(request)
        if (body === null) {
          return Response.json({ error: "Payload too large" }, { status: 413 })
        }
        const url = new URL(request.url)
        const source =
          url.searchParams.get("source") ??
          request.headers.get("User-Agent")?.split(/[/\s]/)[0] ??
          "webhook"
        const bot = await getAgentByName(
          env.BotAgent as unknown as DurableObjectNamespace<BotAgent>,
          botInstanceName(params.userId, params.botId)
        )
        const accepted = await bot.receiveWebhook(params.token, {
          source: source.slice(0, 60),
          contentType: request.headers.get("Content-Type") ?? "",
          body,
          eventId:
            request.headers.get("X-Event-ID") ??
            request.headers.get("Idempotency-Key") ??
            undefined,
        })
        if (!accepted) {
          return Response.json({ error: "Not found" }, { status: 404 })
        }
        return Response.json({ accepted: true }, { status: 202 })
      },
    },
  },
})
