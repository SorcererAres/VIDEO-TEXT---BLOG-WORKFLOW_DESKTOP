// 桌面化 sidecar：拉起 Python 后端 (FastAPI/uvicorn) 子进程，前端通过
// invoke 拿到实际 URL。
//
// 设计：
// - dev 模式（CARGO_MANIFEST_DIR 下能找到 .venv）：用 .venv/bin/python 跑源码。
// - prod 模式（Resources/backend/video2blog-server/ 存在）：跑 PyInstaller onedir。
// - 子进程开 --auto-port，把实际 host:port 写 ~/Library/Application Support/com.sorcerer.video2blog/port。
// - 启动后 Rust 轮询握手文件 + GET /health，最长 30s。Ready 后存到 BackendState，
//   前端 invoke get_backend_url 拿到。
// - App 退出（RunEvent::Exit）时 kill 子进程，避免变孤儿。

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};

/// 共享状态：子进程句柄 + 协商出来的后端 URL（None = 还没 ready）。
#[derive(Default)]
pub struct BackendState {
    pub child: Mutex<Option<Child>>,
    pub url: Mutex<Option<String>>,
}

/// 后端实际 URL（前端 mount 时 invoke 拿）。未 ready 返回 None。
#[tauri::command]
pub fn get_backend_url(state: tauri::State<'_, Arc<BackendState>>) -> Option<String> {
    state.url.lock().ok().and_then(|g| g.clone())
}

/// 入口：setup hook 里 spawn 一次性后台任务，拉起后端 + 轮询 ready。
pub fn spawn(app: &AppHandle, state: Arc<BackendState>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match launch_and_wait(&app, &state) {
            Ok(url) => {
                if let Ok(mut guard) = state.url.lock() {
                    *guard = Some(url.clone());
                }
                let _ = app.emit("backend:ready", &url);
                log::info!("[sidecar] backend ready: {url}");
            }
            Err(err) => {
                log::error!("[sidecar] backend 启动失败: {err}");
                let _ = app.emit("backend:error", err.to_string());
            }
        }
    });
}

/// 退出时回收：RunEvent::Exit 钩子调，避免子进程变孤儿。
pub fn shutdown(state: &BackendState) {
    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
            log::info!("[sidecar] killing backend pid={}", child.id());
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

// ─── 内部：定位 / 启动 / 等待 ──────────────────────────────────────

enum Launcher {
    /// 打包后：Resources/backend/video2blog-server/video2blog-server
    Frozen {
        exe: PathBuf,
        /// repo_root：成品/work/memory 等写入位置，prod 用用户 Home 下默认仓库。
        repo_root: PathBuf,
    },
    /// 开发态：.venv/bin/python + scripts/run_engine_server.py
    Dev {
        python: PathBuf,
        script: PathBuf,
        repo_root: PathBuf,
    },
}

fn locate_launcher(app: &AppHandle) -> anyhow::Result<Launcher> {
    // prod：先尝试 Resources/backend/video2blog-server/video2blog-server
    if let Ok(res) = app
        .path()
        .resolve("backend/video2blog-server/video2blog-server", BaseDirectory::Resource)
    {
        if res.exists() {
            // 打包后用 ~/Documents/Video2Blog 作为工作仓库（用户产物落这里）
            let home = dirs_next_home().ok_or_else(|| anyhow::anyhow!("找不到 home"))?;
            let repo_root = home.join("Documents").join("Video2Blog");
            fs::create_dir_all(&repo_root).ok();
            return Ok(Launcher::Frozen { exe: res, repo_root });
        }
    }
    // dev：从 CARGO_MANIFEST_DIR (= frontend/src-tauri) 推 ../../ 为仓库根
    let dev_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .canonicalize()?;
    let py = dev_root.join(".venv/bin/python");
    let script = dev_root.join("scripts/run_engine_server.py");
    if py.exists() && script.exists() {
        return Ok(Launcher::Dev {
            python: py,
            script,
            repo_root: dev_root,
        });
    }
    Err(anyhow::anyhow!(
        "找不到后端入口：prod resource 不存在且 dev .venv/scripts 缺失"
    ))
}

/// 跨平台 home dir，避免引 dirs crate。macOS/Linux 看 $HOME。
fn dirs_next_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
}

/// macOS：~/Library/Application Support/com.sorcerer.video2blog
fn state_dir() -> Option<PathBuf> {
    let home = dirs_next_home()?;
    #[cfg(target_os = "macos")]
    let p = home
        .join("Library")
        .join("Application Support")
        .join("com.sorcerer.video2blog");
    #[cfg(target_os = "linux")]
    let p = home.join(".config").join("video2blog");
    #[cfg(target_os = "windows")]
    let p = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join("AppData").join("Roaming"))
        .join("video2blog");
    Some(p)
}

fn launch_and_wait(app: &AppHandle, state: &BackendState) -> anyhow::Result<String> {
    // 启动前清掉旧握手文件，避免误读上一次的 stale 端口
    let sd = state_dir().ok_or_else(|| anyhow::anyhow!("找不到 state_dir"))?;
    fs::create_dir_all(&sd).ok();
    let port_file = sd.join("port");
    let _ = fs::remove_file(&port_file);

    let launcher = locate_launcher(app)?;
    let (mut cmd, repo_root, label) = match launcher {
        Launcher::Frozen { exe, repo_root } => {
            let mut c = Command::new(&exe);
            c.arg("--auto-port").arg("--repo-root").arg(&repo_root);
            (c, repo_root, format!("frozen {}", exe.display()))
        }
        Launcher::Dev {
            python,
            script,
            repo_root,
        } => {
            let mut c = Command::new(&python);
            c.arg(&script)
                .arg("--auto-port")
                .arg("--repo-root")
                .arg(&repo_root);
            (c, repo_root, format!("dev {} {}", python.display(), script.display()))
        }
    };

    // 子进程日志：dev 走 stdout（便于调试），prod 走 dev null（避免日志污染）。
    // 用 debug_assertions 区分。
    #[cfg(debug_assertions)]
    {
        cmd.stdout(Stdio::inherit()).stderr(Stdio::inherit());
    }
    #[cfg(not(debug_assertions))]
    {
        cmd.stdout(Stdio::null()).stderr(Stdio::null());
    }

    log::info!("[sidecar] spawn: {label} (repo_root={})", repo_root.display());
    let child = cmd.spawn()?;
    let pid = child.id();
    if let Ok(mut guard) = state.child.lock() {
        *guard = Some(child);
    }
    log::info!("[sidecar] spawned pid={pid}");

    // 等握手：先等 port 文件，再 /health probe。45s 上限
    // （冻结后端冷启动 ~8s，prod 首次叠加 Gatekeeper 校验更慢，留足余量）。
    let url = wait_for_ready(&port_file, Duration::from_secs(45))?;
    Ok(url)
}

fn wait_for_ready(port_file: &Path, timeout: Duration) -> anyhow::Result<String> {
    let started = Instant::now();
    let mut url: Option<String> = None;

    while started.elapsed() < timeout {
        // 1) 读端口文件
        if let Ok(text) = fs::read_to_string(port_file) {
            let line = text.trim();
            if !line.is_empty() {
                url = Some(format!("http://{line}"));
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    let url = url.ok_or_else(|| anyhow::anyhow!("backend 30s 内没写出端口握手文件"))?;

    // 2) /health probe
    let health = format!("{url}/health");
    while started.elapsed() < timeout {
        if probe_health(&health) {
            return Ok(url);
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Err(anyhow::anyhow!("backend /health 30s 内未返回 200"))
}

/// 极简同步 HTTP GET：标准库 TcpStream，不引 reqwest 省体积。
fn probe_health(url: &str) -> bool {
    use std::io::{Read, Write};
    use std::net::TcpStream;

    // 仅处理 http://host:port/path
    let rest = match url.strip_prefix("http://") {
        Some(r) => r,
        None => return false,
    };
    let (host_port, path) = match rest.find('/') {
        Some(idx) => (&rest[..idx], &rest[idx..]),
        None => (rest, "/"),
    };
    let mut stream = match TcpStream::connect_timeout(
        &match host_port.parse() {
            Ok(addr) => addr,
            Err(_) => return false,
        },
        Duration::from_millis(500),
    ) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let req = format!("GET {path} HTTP/1.0\r\nHost: {host_port}\r\n\r\n");
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 64];
    match stream.read(&mut buf) {
        Ok(n) if n > 12 => buf.starts_with(b"HTTP/1.0 200") || buf.starts_with(b"HTTP/1.1 200"),
        _ => false,
    }
}
