import { useCallback, useEffect, useState } from "react"
import { Group, Row } from "@/components/group"
import { useHub } from "@/lib/hub-context"
import type { ProjectFileSummary } from "@/lib/types"

const MAX_BYTES = 5 * 1024 * 1024

function sizeLabel(size: number) {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function ProjectFilesSettings() {
  const hub = useHub()
  const [files, setFiles] = useState<ProjectFileSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!hub.projectFiles) return
    setLoading(true)
    setError(null)
    try {
      setFiles(await hub.projectFiles.list())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [hub.projectFiles])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function upload(file: File) {
    if (!hub.projectFiles) return
    if (file.size > MAX_BYTES) {
      setError("Each shared file must be 5 MB or smaller.")
      return
    }
    setBusyId(file.name)
    setError(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      await hub.projectFiles.upload({
        name: file.name,
        contentType: file.type || "application/octet-stream",
        bytes,
      })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  async function uploadSelected(selected: File[]) {
    for (const file of selected) await upload(file)
  }

  async function download(id: string) {
    if (!hub.projectFiles) return
    setBusyId(id)
    setError(null)
    try {
      const result = await hub.projectFiles.download(id)
      if (!result) throw new Error("That file is no longer shared.")
      const blob = new Blob([result.bytes as unknown as BlobPart], {
        type: result.file.contentType,
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = result.file.name
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  async function remove(id: string) {
    if (!hub.projectFiles) return
    setBusyId(id)
    setError(null)
    try {
      setFiles(await hub.projectFiles.remove(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <Group
        title="Shared project files"
        hint="Every bot in this workspace can discover and read these files. Upload only material that belongs in the shared workspace."
        action={
          <label className="cursor-pointer rounded-full bg-kumo-contrast px-3 py-1.5 text-xs font-medium text-kumo-canvas hover:opacity-90">
            {busyId && !files.some((file) => file.id === busyId) ? "Uploading…" : "Add files"}
            <input
              type="file"
              multiple
              className="sr-only"
              disabled={!hub.projectFiles || !!busyId}
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? [])
                event.currentTarget.value = ""
                void uploadSelected(selected)
              }}
            />
          </label>
        }
      >
        {loading && files.length === 0 ? (
          <Row label="Loading shared files…" />
        ) : files.length === 0 ? (
          <Row label="No project files shared yet" />
        ) : (
          files.map((file) => (
            <Row
              key={file.id}
              label={file.name}
              detail={`${sizeLabel(file.size)} · shared by ${file.sharedBy} · ${new Date(file.sharedAt).toLocaleDateString()}`}
            >
              <button
                type="button"
                disabled={!!busyId}
                onClick={() => void download(file.id)}
                className="rounded-full bg-(--fill-hover) px-3 py-1.5 text-xs text-kumo-default hover:bg-(--fill-active) disabled:opacity-50"
              >
                {busyId === file.id ? "Working…" : "Download"}
              </button>
              <button
                type="button"
                disabled={!!busyId}
                onClick={() => void remove(file.id)}
                className="rounded-full px-3 py-1.5 text-xs text-kumo-danger hover:bg-(--fill-hover) disabled:opacity-50"
              >
                Remove
              </button>
            </Row>
          ))
        )}
      </Group>
      {error ? <p role="alert" className="text-sm text-kumo-warning">{error}</p> : null}
    </div>
  )
}
