pub mod antigravity;
pub mod cursor;
pub mod vscode;

use std::time::Duration;
use tokio::time::sleep;
use tracing::info;
use crate::state::SharedState;
use self::antigravity::AntigravityWatcher;
use self::cursor::CursorWatcher;
use self::vscode::VSCodeWatcher;

pub fn start_ide_watchers(state: SharedState) {
    tokio::spawn(async move {
        info!("Starting Universal IDE background watchers (Antigravity, Cursor, VS Code)...");
        let mut ag_watcher = AntigravityWatcher::new();
        let mut cursor_watcher = CursorWatcher::new();
        let mut vscode_watcher = VSCodeWatcher::new();

        loop {
            ag_watcher.poll_updates(&state);
            cursor_watcher.poll_updates(&state);
            vscode_watcher.poll_updates(&state);

            sleep(Duration::from_millis(750)).await;
        }
    });
}
