//! Thin HTTP layer around yt-dlp + ffmpeg (they do the real work).
//! GET /api/job?url=&format=mp3|mp4&quality=  -> SSE: title, progress, done(id) | error(msg)
//! GET /api/file/{id}                         -> the file once, then gone
//! everything else                            -> ../dist (built Vite front)

use axum::{
    Router,
    body::Body,
    extract::{Path, Query, State},
    http::{StatusCode, header},
    response::{
        IntoResponse, Response,
        sse::{Event, Sse},
    },
    routing::get,
};
use std::{
    collections::HashMap,
    convert::Infallible,
    path::PathBuf,
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::Command,
    sync::{Mutex, mpsc},
};
use tokio_stream::wrappers::ReceiverStream;
use tokio_util::io::ReaderStream;
use tower_http::services::{ServeDir, ServeFile};

const QUALITIES: [&str; 6] = ["360", "480", "720", "1080", "1440", "2160"];
const MAX_JOBS: usize = 3; // ponytail: global cap, per-IP queue if this ever goes public
const FILE_TTL: Duration = Duration::from_secs(600);

#[derive(Default)]
struct App {
    files: Mutex<HashMap<String, PathBuf>>, // id -> file inside its own temp dir
    running: AtomicUsize,
}
type Shared = Arc<App>;

#[derive(serde::Deserialize)]
struct JobQuery {
    url: Option<String>,
    format: Option<String>,
    quality: Option<String>,
}

struct Job {
    url: String,
    mp3: bool,
    quality: String,
}

fn validate(q: &JobQuery) -> Result<Job, &'static str> {
    let raw = q.url.as_deref().unwrap_or("").trim();
    let u = url::Url::parse(raw).map_err(|_| "URL invalide")?;
    if !matches!(u.scheme(), "http" | "https") {
        return Err("Seuls les liens http(s) sont acceptés");
    }
    let mp3 = match q.format.as_deref() {
        Some("mp3") => true,
        Some("mp4") => false,
        _ => return Err("Format inconnu"),
    };
    let quality = q.quality.clone().unwrap_or_else(|| "1080".into());
    if !mp3 && !QUALITIES.contains(&quality.as_str()) {
        return Err("Qualité inconnue");
    }
    Ok(Job { url: u.into(), mp3, quality })
}

fn build_args(job: &Job) -> Vec<String> {
    let mut a: Vec<String> = [
        "--no-playlist", "--newline", "--progress", "--restrict-filenames",
        "--progress-template", "download:P %(progress._percent_str)s",
        "--print", "before_dl:T %(title)s",
        "--print", "after_move:F %(filepath)s",
        "-o", "%(title).120B.%(ext)s",
    ]
    .map(String::from)
    .into();
    if job.mp3 {
        a.extend(["-x", "--audio-format", "mp3", "--audio-quality", "0"].map(String::from));
    } else {
        a.extend(["-S".into(), format!("res:{},vcodec:h264,acodec:aac", job.quality)]);
        a.extend(["--merge-output-format", "mp4"].map(String::from));
    }
    a.extend(["--".into(), job.url.clone()]); // `--`: the URL can never be parsed as a flag
    a
}

struct RunningGuard(Shared);
impl Drop for RunningGuard {
    fn drop(&mut self) {
        self.0.running.fetch_sub(1, Ordering::SeqCst);
    }
}

fn ev(name: &str, data: impl serde_json_lite::Json) -> Result<Event, Infallible> {
    Ok(Event::default().event(name).data(data.json()))
}

async fn job(State(app): State<Shared>, Query(q): Query<JobQuery>) -> impl IntoResponse {
    let (tx, rx) = mpsc::channel(64);
    tokio::spawn(async move {
        let job = match validate(&q) {
            Ok(j) => j,
            Err(e) => {
                _ = tx.send(ev("error", e)).await;
                return;
            }
        };
        if app.running.fetch_add(1, Ordering::SeqCst) >= MAX_JOBS {
            app.running.fetch_sub(1, Ordering::SeqCst);
            _ = tx.send(ev("error", "Serveur occupé, réessaie dans un instant")).await;
            return;
        }
        let _guard = RunningGuard(app.clone());
        let dir = std::env::temp_dir().join(format!("aspire-{}", uuid::Uuid::new_v4()));
        match run(&job, &dir, &tx).await {
            Ok(Some(file)) => {
                let id = uuid::Uuid::new_v4().to_string();
                app.files.lock().await.insert(id.clone(), file);
                let (app2, id2) = (app.clone(), id.clone());
                tokio::spawn(async move {
                    tokio::time::sleep(FILE_TTL).await; // unclaimed files die after 10 min
                    if app2.files.lock().await.remove(&id2).is_some() {
                        _ = tokio::fs::remove_dir_all(&dir).await;
                    }
                });
                _ = tx.send(ev("done", id.as_str())).await;
            }
            Ok(None) => {
                _ = tokio::fs::remove_dir_all(&dir).await; // client left
            }
            Err(msg) => {
                _ = tokio::fs::remove_dir_all(&dir).await;
                _ = tx.send(ev("error", msg.as_str())).await;
            }
        }
    });
    Sse::new(ReceiverStream::new(rx))
}

/// Ok(Some(path)) done, Ok(None) client disconnected, Err(msg) yt-dlp failed.
async fn run(job: &Job, dir: &PathBuf, tx: &mpsc::Sender<Result<Event, Infallible>>) -> Result<Option<PathBuf>, String> {
    tokio::fs::create_dir_all(dir).await.map_err(|_| "Erreur serveur")?;
    let mut child = Command::new("yt-dlp")
        .args(build_args(job))
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true) // returning early (client gone) kills yt-dlp
        .spawn()
        .map_err(|_| "yt-dlp introuvable sur le serveur")?;

    let mut stderr = child.stderr.take().unwrap();
    let err_task = tokio::spawn(async move {
        let mut s = String::new();
        _ = stderr.read_to_string(&mut s).await;
        s
    });
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let mut file = None;
    loop {
        tokio::select! {
            line = lines.next_line() => match line {
                Ok(Some(l)) => {
                    if let Some(p) = l.strip_prefix("P ") {
                        let pct: f64 = p.trim().trim_end_matches('%').parse().unwrap_or(0.0);
                        _ = tx.send(ev("progress", pct)).await;
                    } else if let Some(t) = l.strip_prefix("T ") {
                        _ = tx.send(ev("title", t)).await;
                    } else if let Some(f) = l.strip_prefix("F ") {
                        file = Some(f.trim().to_string());
                    }
                }
                _ => break,
            },
            _ = tx.closed() => return Ok(None),
        }
    }
    let ok = child.wait().await.map(|s| s.success()).unwrap_or(false);
    let err = err_task.await.unwrap_or_default();
    match (ok, file) {
        // only the basename: never trust a path printed by a subprocess
        (true, Some(f)) => Ok(Some(dir.join(PathBuf::from(f).file_name().ok_or("Fichier introuvable")?))),
        _ => Err(err
            .lines()
            .filter_map(|l| l.strip_prefix("ERROR: "))
            .last()
            .unwrap_or("Téléchargement impossible")
            .to_string()),
    }
}

async fn file(State(app): State<Shared>, Path(id): Path<String>) -> Response {
    let Some(path) = app.files.lock().await.remove(&id) else {
        return (StatusCode::NOT_FOUND, "Fichier expiré").into_response();
    };
    let Ok(f) = tokio::fs::File::open(&path).await else {
        return (StatusCode::NOT_FOUND, "Fichier expiré").into_response();
    };
    let size = f.metadata().await.map(|m| m.len()).unwrap_or(0);
    // ponytail: unix trick, unlink now; the open fd keeps streaming the bytes and the OS frees them at close
    if let Some(dir) = path.parent() {
        _ = tokio::fs::remove_dir_all(dir).await;
    }
    let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
    let mime = if name.ends_with(".mp3") { "audio/mpeg" } else { "video/mp4" };
    (
        [
            (header::CONTENT_TYPE, mime.to_string()),
            (header::CONTENT_LENGTH, size.to_string()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename*=UTF-8''{}", pct_encode(&name))),
        ],
        Body::from_stream(ReaderStream::new(f)),
    )
        .into_response()
}

fn pct_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'.' | b'-' | b'_' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Minimal JSON encoding for the two SSE payload types we send (string, number).
mod serde_json_lite {
    pub trait Json {
        fn json(&self) -> String;
    }
    impl Json for &str {
        fn json(&self) -> String {
            let mut o = String::from("\"");
            for c in self.chars() {
                match c {
                    '"' => o.push_str("\\\""),
                    '\\' => o.push_str("\\\\"),
                    c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
                    c => o.push(c),
                }
            }
            o + "\""
        }
    }
    impl Json for f64 {
        fn json(&self) -> String {
            format!("{self:.1}")
        }
    }
}

#[tokio::main]
async fn main() {
    let dist = std::env::var("DIST").unwrap_or_else(|_| "dist".into());
    let addr = std::env::var("ADDR").unwrap_or_else(|_| "127.0.0.1:8787".into()); // local only by default
    let app = Router::new()
        .route("/api/job", get(job))
        .route("/api/file/{id}", get(file))
        .fallback_service(ServeDir::new(&dist).fallback(ServeFile::new(format!("{dist}/index.html"))))
        .with_state(Shared::default());
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("port occupé ?");
    println!("aspire → http://{addr}");
    axum::serve(listener, app).await.unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json_lite::Json;

    fn q(url: &str, format: &str, quality: Option<&str>) -> JobQuery {
        JobQuery { url: Some(url.into()), format: Some(format.into()), quality: quality.map(Into::into) }
    }

    #[test]
    fn validates_input() {
        assert!(validate(&q("https://youtu.be/x", "mp3", None)).is_ok());
        assert!(validate(&q("https://youtu.be/x", "mp4", Some("1080"))).is_ok());
        assert!(validate(&q("file:///etc/passwd", "mp3", None)).is_err());
        assert!(validate(&q("--exec rm", "mp3", None)).is_err());
        assert!(validate(&q("https://a.b", "exe", None)).is_err());
        assert!(validate(&q("https://a.b", "mp4", Some("99"))).is_err());
    }

    #[test]
    fn url_always_after_double_dash() {
        let a = build_args(&validate(&q("https://x.y", "mp4", Some("720"))).unwrap());
        assert_eq!(a[a.len() - 2], "--");
        assert!(a.contains(&"res:720,vcodec:h264,acodec:aac".to_string()));
        assert!(build_args(&validate(&q("https://x.y", "mp3", None)).unwrap()).contains(&"-x".to_string()));
    }

    #[test]
    fn encodes() {
        assert_eq!("a\"b\n".json(), "\"a\\\"b\\u000a\"");
        assert_eq!(pct_encode("a b.mp3"), "a%20b.mp3");
    }
}
