import { useRef, useState } from "react"
import { ArrowDownToLine, ClipboardPaste, Music, Video, X } from "lucide-react"
import { toast } from "sonner"
import { BorderBeam } from "@/components/ui/border-beam"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Toaster } from "@/components/ui/sonner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

type Format = "mp4" | "mp3"
const QUALITIES = ["2160", "1440", "1080", "720", "480", "360"]
const qLabel = (q: string) => (q === "2160" ? "4K" : `${q}p`)

const segList = "h-12 group-data-horizontal/tabs:h-12 rounded-full bg-secondary p-1"
const segTab = "h-full rounded-full px-4 text-[0.95rem] data-active:bg-foreground data-active:text-background data-active:shadow-none"

export default function App() {
  const [url, setUrl] = useState("")
  const [format, setFormat] = useState<Format>("mp4")
  const [quality, setQuality] = useState("1080")
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [title, setTitle] = useState("")
  const es = useRef<EventSource | null>(null)

  function stop() {
    es.current?.close()
    es.current = null
    setBusy(false)
  }

  function start(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim() || busy) return
    setBusy(true); setProgress(0); setTitle("")
    const source = new EventSource(`/api/job?${new URLSearchParams({ url: url.trim(), format, quality })}`)
    es.current = source
    source.addEventListener("title", (ev) => setTitle(JSON.parse(ev.data)))
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
          <Button type="button" variant="ghost" className="h-12 shrink-0 rounded-full px-4" onClick={paste} disabled={busy}>
            <ClipboardPaste /> <span className="max-sm:sr-only">Coller</span>
          </Button>
          {busy && <BorderBeam size={160} duration={4} colorFrom="#FF5A1F" colorTo="#FFB38F" borderWidth={2} />}
        </div>

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
              <Button type="submit" className="h-14 w-full rounded-full px-8 text-base font-semibold hover:bg-primary/90 active:scale-[0.97] sm:w-auto">
                <ArrowDownToLine className="size-5" /> Télécharger
              </Button>
            )}
          </div>
        </div>

        <p aria-live="polite" className="min-h-6 truncate text-sm text-muted-foreground tabular-nums">
          {busy && (title
            ? `${title} — ${progress < 100 ? `${progress.toFixed(0)} %` : "conversion en cours"}`
            : "Lecture du lien…")}
        </p>
      </form>

      <footer className="mt-auto pt-16 text-sm text-muted-foreground">
        <p className="max-w-xl">
          Fonctionne avec YouTube, TikTok, Instagram, X, SoundCloud, Vimeo, Twitch et plus de mille autres sites.
          Pour un usage personnel : respecte les droits des auteurs.
        </p>
      </footer>
      <Toaster position="bottom-center" />
    </main>
  )
}
