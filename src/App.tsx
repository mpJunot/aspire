import { useEffect, useRef, useState } from "react"
import { ArrowDownToLine, ClipboardPaste, Music, Video, X } from "lucide-react"
import { siInstagram, siSoundcloud, siTiktok, siTwitch, siVimeo, siX, siYoutube } from "simple-icons"
import { toast } from "sonner"
import { BorderBeam } from "@/components/ui/border-beam"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Toaster } from "@/components/ui/sonner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

type Format = "mp4" | "mp3"
type Info = { title: string; thumbnail?: string; duration?: number; uploader?: string; extractor_key?: string }
type Preview = { state: "idle" } | { state: "loading" } | { state: "ready"; info: Info } | { state: "error"; msg: string }

const QUALITIES = ["2160", "1440", "1080", "720", "480", "360"]
const qLabel = (q: string) => (q === "2160" ? "4K" : `${q}p`)
const PLATFORMS = [siYoutube, siTiktok, siInstagram, siX, siSoundcloud, siVimeo, siTwitch]

const segList = "h-12 group-data-horizontal/tabs:h-12 rounded-full bg-secondary p-1"
const segTab = "h-full rounded-full px-4 text-[0.95rem] data-active:bg-foreground data-active:text-background data-active:shadow-none"

function isUrl(s: string) {
  try { return /^https?:$/.test(new URL(s).protocol) } catch { return false }
}

function fmtDuration(s?: number) {
  if (!s) return null
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60)
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(sec).padStart(2, "0")}`
}

export default function App() {
  const [url, setUrl] = useState("")
  const [format, setFormat] = useState<Format>("mp4")
  const [quality, setQuality] = useState("1080")
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [preview, setPreview] = useState<Preview>({ state: "idle" })
  const es = useRef<EventSource | null>(null)

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

  function start(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim() || busy) return
    setBusy(true); setProgress(0)
    const source = new EventSource(`/api/job?${new URLSearchParams({ url: url.trim(), format, quality })}`)
    es.current = source
    source.addEventListener("progress", (ev) => setProgress(JSON.parse(ev.data)))
    source.addEventListener("done", (ev) => {
      stop()
      location.assign(`/api/file/${JSON.parse(ev.data)}`) // attachment header → browser saves it
      toast.success("Fichier téléchargé")
    })
    source.addEventListener("error", (ev) => {
      const msg = (ev as MessageEvent).data
      stop()
      toast.error(msg ? JSON.parse(msg) : "Le serveur ne répond plus. Vérifie qu’il tourne, puis réessaie.")
    })
  }

  async function paste() {
    try { setUrl((await navigator.clipboard.readText()).trim()) }
    catch { toast.error("Le navigateur bloque le presse-papier. Colle le lien avec ⌘V.") }
  }

  const status = !busy ? null : progress >= 100 ? "Conversion en cours…" : progress > 0 ? `${progress.toFixed(0)} %` : "Démarrage…"

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-8 sm:px-8 sm:py-12">
      {/* The word is the progress bar: it fills with tangerine and inhales (tightens) while working. */}
      <h1
        aria-label="aspire"
        className="relative select-none font-heading text-[clamp(5.5rem,24vw,17rem)] leading-[0.85] font-extrabold tracking-[-0.02em] [font-stretch:80%] [font-variation-settings:'opsz'_96] motion-safe:transition-[letter-spacing] motion-safe:duration-700 data-[busy=true]:tracking-[-0.05em]"
        data-busy={busy}
      >
        <span aria-hidden className={busy ? "text-[var(--ghost)]" : ""}>aspire</span>
        <span
          aria-hidden
          className="absolute inset-0 text-primary motion-safe:transition-[clip-path] motion-safe:duration-300"
          style={{ clipPath: `inset(0 ${busy ? 100 - progress : 100}% 0 0)` }}
        >
          aspire
        </span>
      </h1>

      <p className="mt-8 max-w-md text-lg text-muted-foreground sm:text-xl">
        Colle un lien, garde le fichier. Vidéo en MP4 jusqu’à la 4K, ou juste le son en MP3.
      </p>

      <form onSubmit={start} className="mt-10 space-y-5">
        <div className="relative flex items-center gap-2 overflow-hidden rounded-[1.75rem] border-2 border-foreground bg-card p-2 focus-within:ring-4 focus-within:ring-primary/40">
          <Input
            type="url"
            required
            autoFocus
            aria-label="Lien de la vidéo"
            placeholder="https://youtube.com/watch?v=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
            className="h-14 border-0 bg-transparent px-4 text-lg shadow-none focus-visible:ring-0 disabled:bg-transparent md:text-xl dark:bg-transparent"
          />
          {url && !busy ? (
            <Button type="button" variant="ghost" size="icon" className="size-12 shrink-0 rounded-full" onClick={() => setUrl("")} aria-label="Effacer le lien">
              <X />
            </Button>
          ) : (
            <Button type="button" variant="ghost" className="h-12 shrink-0 rounded-full px-4" onClick={paste} disabled={busy}>
              <ClipboardPaste /> <span className="max-sm:sr-only">Coller</span>
            </Button>
          )}
          {busy && <BorderBeam size={160} duration={4} colorFrom="#FF5A1F" colorTo="#FFB38F" borderWidth={2} />}
        </div>

        {preview.state === "idle" ? (
          <ul aria-label="Sites compatibles" className="flex flex-wrap items-center gap-x-5 gap-y-2 px-2 text-muted-foreground">
            {PLATFORMS.map((p) => (
              <li key={p.slug}>
                <svg viewBox="0 0 24 24" role="img" aria-label={p.title} className="size-5 fill-current"><title>{p.title}</title><path d={p.path} /></svg>
              </li>
            ))}
            <li className="text-sm">et plus de mille autres sites</li>
          </ul>
        ) : (
          <div aria-live="polite" className="flex items-center gap-4 rounded-2xl bg-secondary p-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1">
            {preview.state !== "error" && <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-xl bg-[var(--ghost)] sm:w-44">
              {preview.state === "ready" && preview.info.thumbnail && (
                <img src={preview.info.thumbnail} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
              )}
              {preview.state === "ready" && fmtDuration(preview.info.duration) && (
                <span className="absolute right-1.5 bottom-1.5 rounded-md bg-foreground/85 px-1.5 py-0.5 text-xs font-medium text-background tabular-nums">
                  {fmtDuration(preview.info.duration)}
                </span>
              )}
            </div>}
            <div className="min-w-0 flex-1 px-1">
              {preview.state === "loading" && (
                <div className="space-y-2 motion-safe:animate-pulse">
                  <div className="h-4 w-3/4 rounded bg-[var(--ghost)]" />
                  <div className="h-3 w-1/3 rounded bg-[var(--ghost)]" />
                </div>
              )}
              {preview.state === "ready" && (
                <>
                  <p className="line-clamp-2 font-medium leading-snug">{preview.info.title}</p>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {[preview.info.uploader, preview.info.extractor_key].filter(Boolean).join(", ")}
                  </p>
                  {status && <p className="mt-1 text-sm font-medium text-primary tabular-nums">{status}</p>}
                </>
              )}
              {preview.state === "error" && (
                <>
                  <p className="font-medium">Aucune vidéo trouvée à ce lien.</p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{preview.msg}</p>
                </>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={format} onValueChange={(v) => setFormat(v as Format)}>
            <TabsList className={segList}>
              <TabsTrigger value="mp4" disabled={busy} className={segTab}><Video /> Vidéo</TabsTrigger>
              <TabsTrigger value="mp3" disabled={busy} className={segTab}><Music /> Audio</TabsTrigger>
            </TabsList>
          </Tabs>

          {format === "mp4" && (
            <Tabs value={quality} onValueChange={(v) => setQuality(v as string)} aria-label="Qualité maximale" className="max-w-full">
              <TabsList className={`${segList} max-w-full justify-start overflow-x-auto`}>
                {QUALITIES.map((q) => (
                  <TabsTrigger key={q} value={q} disabled={busy} className={`${segTab} px-3 tabular-nums`}>{qLabel(q)}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          <div className="w-full sm:ml-auto sm:w-auto">
            {busy ? (
              <Button type="button" variant="secondary" onClick={stop} className="h-14 w-full rounded-full px-7 text-base sm:w-auto">
                <X /> Annuler
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={preview.state === "error"}
                className="h-14 w-full rounded-full px-8 text-base font-semibold hover:bg-primary/90 active:scale-[0.97] sm:w-auto"
              >
                <ArrowDownToLine className="size-5" /> Télécharger
              </Button>
            )}
          </div>
        </div>
      </form>

      <footer className="mt-auto pt-16 text-sm text-muted-foreground">
        <p className="max-w-xl">Pour un usage personnel : respecte les droits des auteurs et les conditions des plateformes.</p>
      </footer>
      <Toaster position="bottom-center" />
    </main>
  )
}
