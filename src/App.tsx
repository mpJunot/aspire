import { useEffect, useRef, useState } from "react"
import { ArrowDownToLine, ClipboardPaste, Link2, Loader2, Music, RotateCw, Trash2, Video, X } from "lucide-react"
import { siInstagram, siSoundcloud, siTiktok, siTwitch, siVimeo, siX, siYoutube } from "simple-icons"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Toaster } from "@/components/ui/sonner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

type Format = "mp4" | "mp3"
type Info = { title: string; thumbnail?: string; duration?: number; uploader?: string; extractor_key?: string }
type Preview = { state: "idle" } | { state: "loading" } | { state: "ready"; info: Info } | { state: "error"; msg: string }

const QUALITIES = ["2160", "1440", "1080", "720", "480", "360"].map((v) => ({ value: v, label: v === "2160" ? "4K" : `${v}p` }))
const qLabel = (q: string) => QUALITIES.find((x) => x.value === q)?.label ?? q
const PLATFORMS = [siYoutube, siTiktok, siInstagram, siX, siSoundcloud, siVimeo, siTwitch]

function isUrl(s: string) {
  try { return /^https?:$/.test(new URL(s).protocol) } catch { return false }
}

function fmtDuration(s?: number) {
  if (!s) return null
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60)
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(sec).padStart(2, "0")}`
}

// History lives in this browser only (files themselves are deleted from the server after download).
type Entry = { url: string; format: Format; quality: string; title: string; thumbnail?: string; site?: string; at: number }
const HISTORY_KEY = "aspire:history"
const HISTORY_MAX = 50

function loadHistory(): Entry[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") } catch { return [] }
}
function saveHistory(h: Entry[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)) } catch { /* private mode: history just won't persist */ }
}

const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" })
function ago(t: number) {
  const s = (t - Date.now()) / 1000
  for (const [unit, sec] of [["day", 86400], ["hour", 3600], ["minute", 60]] as const) {
    if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), unit)
  }
  return "à l’instant"
}

function Thumb({ src, className = "" }: { src?: string; className?: string }) {
  return (
    <div className={`relative aspect-video shrink-0 overflow-hidden rounded-lg bg-muted ${className}`}>
      {src && <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />}
    </div>
  )
}

export default function App() {
  const [url, setUrl] = useState("")
  const [format, setFormat] = useState<Format>("mp4")
  const [quality, setQuality] = useState("1080")
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [preview, setPreview] = useState<Preview>({ state: "idle" })
  const [history, setHistory] = useState<Entry[]>(loadHistory)
  const es = useRef<EventSource | null>(null)

  function updateHistory(next: Entry[]) {
    setHistory(next)
    saveHistory(next)
  }

  // Fetch title + thumbnail as soon as a link is pasted, so people see they have the right video.
  useEffect(() => {
    const link = url.trim()
    if (!isUrl(link)) return setPreview({ state: "idle" })
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setPreview({ state: "loading" })
      try {
        const res = await fetch(`/api/info?${new URLSearchParams({ url: link })}`, { signal: ctrl.signal })
        if (!res.ok) {
          const msg = await res.text()
          return setPreview({ state: "error", msg: msg.startsWith("Unsupported URL") ? "Ce site n’est pas pris en charge." : msg })
        }
        setPreview({ state: "ready", info: await res.json() })
      } catch {
        if (!ctrl.signal.aborted) setPreview({ state: "error", msg: "Le serveur ne répond pas." })
      }
    }, 350)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [url])

  function stop() {
    es.current?.close()
    es.current = null
    setBusy(false)
  }

  function run(link: string, fmt: Format, q: string, known?: Info) {
    if (!link || busy) return
    setBusy(true); setProgress(0)
    let title = known?.title ?? link
    const source = new EventSource(`/api/job?${new URLSearchParams({ url: link, format: fmt, quality: q })}`)
    es.current = source
    source.addEventListener("title", (ev) => { title = JSON.parse(ev.data) })
    source.addEventListener("progress", (ev) => setProgress(JSON.parse(ev.data)))
    source.addEventListener("done", (ev) => {
      stop()
      location.assign(`/api/file/${JSON.parse(ev.data)}`) // attachment header → browser saves it
      toast.success("Fichier téléchargé", { description: title })
      const entry: Entry = { url: link, format: fmt, quality: q, title, thumbnail: known?.thumbnail, site: known?.extractor_key, at: Date.now() }
      updateHistory([entry, ...loadHistory().filter((h) => !(h.url === link && h.format === fmt))].slice(0, HISTORY_MAX))
    })
    source.addEventListener("error", (ev) => {
      const msg = (ev as MessageEvent).data
      stop()
      toast.error(msg ? JSON.parse(msg) : "Le serveur ne répond plus. Vérifie qu’il tourne, puis réessaie.")
    })
  }

  function start(e: React.FormEvent) {
    e.preventDefault()
    run(url.trim(), format, quality, preview.state === "ready" ? preview.info : undefined)
  }

  function again(h: Entry) {
    setUrl(h.url); setFormat(h.format); setQuality(h.quality)
    run(h.url, h.format, h.quality, { title: h.title, thumbnail: h.thumbnail, extractor_key: h.site })
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  async function paste() {
    try { setUrl((await navigator.clipboard.readText()).trim()) }
    catch { toast.error("Le navigateur bloque le presse-papier. Colle le lien avec ⌘V.") }
  }

  const cta = format === "mp3" ? "Télécharger le MP3" : `Télécharger en ${qLabel(quality)}`
  const status = progress >= 100 ? "Conversion…" : progress > 0 ? `${progress.toFixed(0)} %` : "Préparation…"

  return (
    <div className="relative min-h-dvh overflow-x-clip">

      <header className="relative mx-auto flex max-w-2xl items-center gap-2 px-4 pt-6">
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <ArrowDownToLine className="size-4" strokeWidth={2.5} />
        </span>
        <span className="text-lg font-semibold tracking-tight">aspire</span>
      </header>

      <main className="relative mx-auto max-w-2xl px-4 pt-16 pb-16 sm:pt-24">
        <div className="text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Télécharge n’importe quelle vidéo</h1>
          <p className="mx-auto mt-4 max-w-md text-base text-muted-foreground text-pretty sm:text-lg">
            Colle un lien, choisis vidéo ou audio, c’est tout. Pas de pub, pas de compte.
          </p>
        </div>

        <form onSubmit={start} className="mt-10 flex flex-col gap-2 rounded-2xl border bg-card p-2 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_32px_-8px_rgb(0_0_0/0.12)]">
          {/* Step 1: the link */}
          <div className="max-sm:contents sm:flex sm:gap-2">
            <label className="flex h-12 min-w-0 items-center sm:flex-1 gap-2 rounded-xl bg-muted px-3 focus-within:ring-2 focus-within:ring-ring">
              <Link2 className="size-4 shrink-0 text-muted-foreground" />
              <input
                type="url"
                required
                autoFocus
                aria-label="Lien de la vidéo"
                placeholder="Colle un lien YouTube, TikTok, Instagram…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={busy}
                className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground disabled:opacity-60"
              />
              {url && !busy ? (
                <button type="button" onClick={() => setUrl("")} aria-label="Effacer le lien" className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground">
                  <X className="size-4" />
                </button>
              ) : (
                <button type="button" onClick={paste} disabled={busy} className="flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50">
                  <ClipboardPaste className="size-4" /> Coller
                </button>
              )}
            </label>
            {!busy && (
              <Button type="submit" disabled={preview.state === "error" || preview.state === "loading"} className="h-12 rounded-xl px-5 text-base font-semibold max-sm:order-last">
                {preview.state === "loading" ? <Loader2 className="animate-spin" /> : <ArrowDownToLine />}
                {preview.state === "ready" ? cta : "Télécharger"}
              </Button>
            )}
          </div>

          {/* Step 2: what you're getting, and how */}
          {preview.state !== "idle" && (
            <div className="rounded-xl border p-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1">
              {preview.state === "error" ? (
                <div className="flex items-start gap-3 px-1">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-destructive" />
                  <div>
                    <p className="font-medium">Aucune vidéo trouvée à ce lien</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{preview.msg}</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Thumb src={preview.state === "ready" ? preview.info.thumbnail : undefined} className={`w-28 sm:w-32 ${preview.state === "loading" ? "motion-safe:animate-pulse" : ""}`} />
                      {preview.state === "ready" && fmtDuration(preview.info.duration) && (
                        <span className="absolute right-1 bottom-1 rounded bg-black/75 px-1 text-[11px] font-medium text-white tabular-nums">
                          {fmtDuration(preview.info.duration)}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      {preview.state === "loading" ? (
                        <div className="space-y-2 motion-safe:animate-pulse">
                          <div className="h-4 w-4/5 rounded bg-muted" />
                          <div className="h-3 w-2/5 rounded bg-muted" />
                        </div>
                      ) : (
                        <>
                          <p className="line-clamp-2 leading-snug font-medium">{preview.info.title}</p>
                          <p className="mt-1 truncate text-sm text-muted-foreground">
                            {[preview.info.uploader, preview.info.extractor_key].filter(Boolean).join(", ")}
                          </p>
                        </>
                      )}
                    </div>
                  </div>

                  {busy ? (
                    <div className="mt-3" aria-live="polite">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium tabular-nums">{status}</span>
                        <Button type="button" variant="ghost" size="sm" onClick={stop} className="text-muted-foreground">
                          <X /> Annuler
                        </Button>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-300 ${progress >= 100 ? "motion-safe:animate-pulse" : ""}`}
                          style={{ width: `${Math.max(progress, 3)}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Tabs value={format} onValueChange={(v) => setFormat(v as Format)}>
                        <TabsList className="h-9 group-data-horizontal/tabs:h-9">
                          <TabsTrigger value="mp4" className="px-3"><Video /> Vidéo</TabsTrigger>
                          <TabsTrigger value="mp3" className="px-3"><Music /> Audio</TabsTrigger>
                        </TabsList>
                      </Tabs>
                      {format === "mp4" ? (
                        <Select items={QUALITIES} value={quality} onValueChange={(v) => v && setQuality(v)}>
                          <SelectTrigger className="h-9 data-[size=default]:h-9" aria-label="Qualité maximale">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {QUALITIES.map((q) => <SelectItem key={q.value} value={q.value}>{q.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-sm text-muted-foreground">MP3, meilleure qualité disponible</span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </form>

        {/* Supported sites */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-muted-foreground">
          {PLATFORMS.map((p) => (
            <svg key={p.slug} viewBox="0 0 24 24" role="img" aria-label={p.title} className="size-4 fill-current opacity-70">
              <title>{p.title}</title>
              <path d={p.path} />
            </svg>
          ))}
          <span className="text-xs">et 1000+ autres sites</span>
        </div>

        {/* History */}
        {history.length > 0 && (
          <section aria-labelledby="history-title" className="mt-16">
            <div className="flex items-center justify-between">
              <h2 id="history-title" className="text-sm font-semibold">Récents</h2>
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => updateHistory([])}>Tout effacer</Button>
            </div>
            <ul className="mt-2 overflow-hidden rounded-2xl border bg-card">
              {history.map((h) => (
                <li key={`${h.url}-${h.format}`} className="group flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0">
                  <Thumb src={h.thumbnail} className="w-16" />
                  <div className="min-w-0 flex-1">
                    <a href={h.url} target="_blank" rel="noreferrer" className="line-clamp-1 text-sm font-medium hover:underline">{h.title}</a>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {h.format === "mp3" ? "MP3" : `MP4 ${qLabel(h.quality)}`}, {ago(h.at)}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => again(h)} disabled={busy} aria-label={`Retélécharger ${h.title}`} title="Retélécharger">
                    <RotateCw />
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="text-muted-foreground sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                    onClick={() => updateHistory(history.filter((x) => x !== h))}
                    aria-label={`Retirer ${h.title} de l’historique`} title="Retirer"
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <footer className="relative mx-auto max-w-2xl px-4 pb-8 text-center text-xs text-muted-foreground">
        Pour un usage personnel. Respecte les droits des auteurs et les conditions des plateformes.
      </footer>
      <Toaster position="bottom-center" />
    </div>
  )
}
