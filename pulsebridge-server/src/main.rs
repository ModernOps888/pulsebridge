mod api;
mod auth;
mod capture;
mod ingest;
mod models;
mod remote_action;
mod state;
mod system_telemetry;
mod watchers;
mod ws;

use std::net::SocketAddr;
use std::path::Path;
use axum::{
    response::Html,
    routing::{get, post},
    Router,
};
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::auth::AuthManager;
use crate::state::SharedState;
use crate::watchers::start_ide_watchers;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "pulsebridge_server=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Parse command line arguments
    let args: Vec<String> = std::env::args().collect();
    let port = parse_arg(&args, "--port").and_then(|p| p.parse().ok()).unwrap_or(8080);
    let custom_pin = parse_arg(&args, "--pin");
    let tunnel_url = parse_arg(&args, "--tunnel-url")
        .or_else(|| parse_arg(&args, "--public-url"))
        .or_else(|| std::env::var("PULSEBRIDGE_TUNNEL_URL").ok())
        .or_else(|| std::env::var("PULSEBRIDGE_PUBLIC_URL").ok());

    let auth_manager = AuthManager::new(port, custom_pin, tunnel_url);
    auth_manager.print_startup_banner();

    let allow_shell_commands = args.iter().any(|a| a == "--enable-shell-commands" || a == "--allow-shell")
        || std::env::var("PULSEBRIDGE_ENABLE_SHELL").map(|v| v == "1" || v == "true").unwrap_or(false);

    if allow_shell_commands {
        tracing::warn!("SECURITY POLICY: Remote shell execution is OPTED-IN via flag.");
    } else {
        tracing::info!("Zero-Trust Hardening: Remote shell execution is DISABLED by default.");
    }

    let state = SharedState::new(auth_manager.clone(), port, allow_shell_commands);

    // Launch background file & state watchers for Antigravity, Cursor, and VS Code
    start_ide_watchers(state.clone());

    // Restricted CORS Policy: allow localhost, local LAN IP, and Cloudflare quick tunnels
    let lan_ip_str = auth_manager.get_lan_ip().to_string();
    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::AllowOrigin::predicate(move |origin, _parts| {
            let origin_str = match origin.to_str() {
                Ok(s) => s,
                Err(_) => return false,
            };
            if origin_str.starts_with("http://localhost") || origin_str.starts_with("http://127.0.0.1") {
                return true;
            }
            if origin_str.starts_with(&format!("http://{}", lan_ip_str)) {
                return true;
            }
            if origin_str.ends_with(".trycloudflare.com") {
                return true;
            }
            false
        }))
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
        ]);

    let api_routes = Router::new()
        .route("/api/auth/login", post(api::login_handler))
        .route("/api/auth/qr", get(api::qr_code_handler))
        .route("/api/status", get(api::status_handler))
        .route("/api/chat", get(api::chat_steps_handler))
        .route("/api/ide/windows", get(api::list_windows_handler))
        .route("/api/preview/frame", get(api::preview_frame_handler))
        .route("/api/ingest/event", post(ingest::handle_ingest_event))
        .route("/api/action/prompt", post(ingest::handle_send_prompt))
        .route("/api/action/remote_prompt", post(ingest::handle_remote_action))
        .route("/api/action/click", post(ingest::handle_mouse_click))
        .route("/api/action/scroll", post(ingest::handle_mouse_scroll))
        .route("/api/action/hotkey", post(ingest::handle_hotkey))
        .route(
            "/api/action/clipboard",
            get(ingest::handle_get_clipboard).post(ingest::handle_set_clipboard),
        )
        .route("/ws", get(ws::ws_handler));

    // Resolve web dist directory
    let candidate_paths = [
        Path::new("C:\\PulseBridge\\pulsebridge-web\\dist").to_path_buf(),
        Path::new("pulsebridge-web").join("dist"),
        Path::new("..").join("pulsebridge-web").join("dist"),
        Path::new("dist").to_path_buf(),
    ];

    let found_dist = candidate_paths.into_iter().find(|p| p.exists() && p.is_dir());

    let static_router = if let Some(dist) = found_dist {
        info!("Serving Web UI bundle from {:?}", dist);
        Router::new().fallback_service(ServeDir::new(dist))
    } else {
        info!("No web build directory found. Serving embedded landing page.");
        Router::new().route("/", get(welcome_page))
    };

    let app = Router::new()
        .merge(api_routes)
        .merge(static_router)
        .layer(cors)
        .layer(tower_http::set_header::SetResponseHeaderLayer::overriding(
            axum::http::header::X_CONTENT_TYPE_OPTIONS,
            axum::http::HeaderValue::from_static("nosniff"),
        ))
        .layer(tower_http::set_header::SetResponseHeaderLayer::overriding(
            axum::http::header::X_FRAME_OPTIONS,
            axum::http::HeaderValue::from_static("DENY"),
        ))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("PulseBridge Server listening on http://0.0.0.0:{}", port);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?;

    Ok(())
}

fn parse_arg(args: &[String], flag: &str) -> Option<String> {
    for i in 0..args.len() {
        if args[i] == flag && i + 1 < args.len() {
            return Some(args[i + 1].clone());
        }
    }
    None
}

async fn welcome_page() -> Html<String> {
    Html(r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PulseBridge Core - Universal AI IDE Companion</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0b0f19; color: #f3f4f6; margin: 0; padding: 2rem; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 85vh; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 1rem; padding: 2rem; max-width: 500px; text-align: center; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5); }
    h1 { color: #38bdf8; margin-top: 0; font-size: 1.8rem; }
    p { color: #9ca3af; line-height: 1.6; }
    .badge { display: inline-block; background: #064e3b; color: #34d399; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.875rem; font-weight: 600; margin-bottom: 1rem; }
    .qr-container { background: white; padding: 1rem; border-radius: 0.75rem; display: inline-block; margin: 1.5rem 0; }
    .qr-container img { display: block; max-width: 220px; }
    .btn { display: inline-block; background: #2563eb; color: white; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-weight: 600; transition: background 0.2s; }
    .btn:hover { background: #1d4ed8; }
    code { background: #1f2937; color: #38bdf8; padding: 0.2rem 0.4rem; border-radius: 0.25rem; font-family: monospace; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">● PulseBridge Rust Core Online</div>
    <h1>Universal AI IDE Companion</h1>
    <p>The high-performance Rust telemetry bridge is active and monitoring <strong>Antigravity, Cursor, and VS Code</strong>.</p>
    <div class="qr-container">
      <img src="/api/auth/qr" alt="Scan to pair on phone">
    </div>
    <p>Scan the QR code on your mobile device to open the dashboard, or connect the React frontend.</p>
    <p>REST API: <code>/api/status</code> | WebSocket: <code>/ws</code></p>
  </div>
</body>
</html>"#.to_string())
}
