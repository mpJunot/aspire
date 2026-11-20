# aspire

Téléchargeur vidéo/audio façon cobalt.tools : colle un lien, récupère un MP4 (jusqu'à 4K) ou un MP3.
YouTube, TikTok, X, SoundCloud, Vimeo… (tous les sites supportés par yt-dlp).

**Stack** : front Vite + React + shadcn/ui + Magic UI · serveur Rust (axum/tokio) · moteur yt-dlp + ffmpeg.

## Prérequis

```sh
brew install yt-dlp ffmpeg deno rustup && rustup default stable
```

`deno` est requis par yt-dlp pour YouTube (résolution du JS du lecteur).

## Lancer

```sh
pnpm install
pnpm start            # build du front + serveur sur http://127.0.0.1:8787
```

Dev avec hot reload : `pnpm api` dans un terminal, `pnpm dev` dans l'autre (Vite proxie `/api`).

Variables : `ADDR` (défaut `127.0.0.1:8787`), `DIST` (défaut `dist`).

## API

- `GET /api/job?url=…&format=mp3|mp4&quality=360…2160` → flux SSE : `title`, `progress`, `done` (id) ou `error`
- `GET /api/file/{id}` → le fichier, une seule fois (supprimé ensuite ; expiré après 10 min sinon)

## Maintenance

YouTube casse régulièrement les téléchargeurs : si ça échoue, `brew upgrade yt-dlp` règle 90 % des cas.

Usage personnel uniquement : respecte les droits d'auteur et les CGU des plateformes.
