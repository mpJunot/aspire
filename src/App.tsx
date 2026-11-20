import { useRef, useState } from "react"
import { ClipboardPaste, Download, Music, Video, X } from "lucide-react"
import { toast } from "sonner"
import { AnimatedGridPattern } from "@/components/ui/animated-grid-pattern"
import { BorderBeam } from "@/components/ui/border-beam"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ShimmerButton } from "@/components/ui/shimmer-button"
import { Toaster } from "@/components/ui/sonner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

type Format = "mp4" | "mp3"
const QUALITIES = ["2160", "1440", "1080", "720", "480", "360"].map((v) => ({ value: v, label: v === "2160" ? "4K" : `${v}p` }))

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
    const q = new URLSearchParams({ url: url.trim(), format, quality })
    const source = new EventSource(`/api/job?${q}`)
    es.current = source
    source.addEventListener("title", (ev) => setTitle(JSON.parse(ev.data)))
    source.addEventListener("progress", (ev) => setProgress(JSON.parse(ev.data)))
    source.addEventListener("done", (ev) => {
      stop()
      setProgress(100)
      location.assign(`/api/file/${JSON.parse(ev.data)}`) // attachment header → browser saves it
      toast.success("Téléchargement prêt")
    })
    source.addEventListener("error", (ev) => {
      const msg = (ev as MessageEvent).data
      stop()
      toast.error(msg ? JSON.parse(msg) : "Connexion au serveur perdue")
    })
  }

  async function paste() {
    try { setUrl(await navigator.clipboard.readText()) }
    catch { toast.error("Accès au presse-papier refusé") }
  }

  return (
    <main className="dark relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 text-foreground">
      <AnimatedGridPattern
        numSquares={30}
        maxOpacity={0.12}
        duration={3}
        className="[mask-image:radial-gradient(500px_circle_at_center,white,transparent)] inset-x-0 inset-y-[-30%] h-[160%] skew-y-12"
      />

      <div className="relative z-10 w-full max-w-xl space-y-6">
        <header className="space-y-2 text-center">
          <h1 className="text-4xl font-semibold tracking-tight">aspire</h1>
          <p className="text-sm text-muted-foreground">
            Colle un lien, récupère le fichier. YouTube, TikTok, X, SoundCloud, Vimeo et 1000+ sites.
          </p>
        </header>

        <Card className="relative overflow-hidden">
          <CardContent>
            <form onSubmit={start} className="space-y-4">
              <div className="flex gap-2">
                <Input
                  type="url"
                  required
                  autoFocus
                  aria-label="Lien de la vidéo"
                  placeholder="https://youtube.com/watch?v=…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={busy}
                  className="h-11"
                />
                <Button type="button" variant="outline" size="icon" className="size-11 shrink-0" onClick={paste} disabled={busy} aria-label="Coller">
                  <ClipboardPaste />
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Tabs value={format} onValueChange={(v) => setFormat(v as Format)}>
                  <TabsList>
                    <TabsTrigger value="mp4" disabled={busy}><Video /> Vidéo MP4</TabsTrigger>
                    <TabsTrigger value="mp3" disabled={busy}><Music /> Audio MP3</TabsTrigger>
                  </TabsList>
                </Tabs>

                {format === "mp4" && (
                  <Select items={QUALITIES} value={quality} onValueChange={(v) => v && setQuality(v)} disabled={busy}>
                    <SelectTrigger className="w-28" aria-label="Qualité max">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {QUALITIES.map((q) => <SelectItem key={q.value} value={q.value}>{q.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}

                <div className="ml-auto">
                  {busy ? (
                    <Button type="button" variant="secondary" onClick={stop}><X /> Annuler</Button>
                  ) : (
                    <ShimmerButton type="submit" className="h-9 px-5 text-sm">
                      <Download className="mr-2 size-4" /> Télécharger
                    </ShimmerButton>
                  )}
                </div>
              </div>

              {busy && (
                <div className="space-y-2" aria-live="polite">
                  <Progress value={progress} />
                  <p className="truncate text-xs text-muted-foreground">
                    {title || "Analyse du lien…"} · {progress < 100 ? `${progress.toFixed(0)} %` : "conversion…"}
                  </p>
                </div>
              )}
            </form>
          </CardContent>
          {busy && <BorderBeam size={120} duration={6} />}
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Usage perso uniquement · respecte les droits d’auteur et les CGU des plateformes.
        </p>
      </div>
      <Toaster position="top-center" />
    </main>
  )
}
