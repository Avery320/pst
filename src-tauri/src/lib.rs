mod file_io;
mod file_policy;

use file_policy::{FileKind, allowed_navigation, suggested_filename, validate_payload};
use serde::Serialize;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tauri::{Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct DialogState(Arc<AtomicBool>);

struct DialogLease(Arc<AtomicBool>);

impl DialogState {
    fn acquire(&self) -> Result<DialogLease, String> {
        self.0
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "請先完成目前的檔案對話框。".to_string())?;
        Ok(DialogLease(Arc::clone(&self.0)))
    }
}

impl Drop for DialogLease {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Serialize)]
struct OpenedDocument {
    name: String,
    content: String,
}

fn require_main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("這個視窗沒有檔案存取權限。".into());
    }
    Ok(())
}

/// IPC has no path parameter. Selection and reading both happen off the event-loop thread.
#[tauri::command]
async fn open_document(
    window: WebviewWindow,
    dialogs: State<'_, DialogState>,
) -> Result<Option<OpenedDocument>, String> {
    require_main_window(&window)?;
    let lease = dialogs.acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        let selected = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("開啟 pst 時程文件")
            .add_filter("pst 時程文件（JSON）", &["json"])
            .blocking_pick_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = selected
            .into_path()
            .map_err(|_| "所選位置不是可讀取的本機檔案。".to_string())?;
        let content = file_io::read_selected_document(&path)?;
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "pst-timeline.json".into());
        Ok(Some(OpenedDocument { name, content }))
    })
    .await
    .map_err(|_| "檔案對話框無法完成，請稍後再試。".to_string())?
}

/// The frontend supplies bytes and a filename suggestion, never a destination path.
#[tauri::command]
async fn save_file(
    window: WebviewWindow,
    dialogs: State<'_, DialogState>,
    filename: String,
    kind: String,
    bytes: Vec<u8>,
) -> Result<bool, String> {
    require_main_window(&window)?;
    let kind = FileKind::parse(&kind)?;
    let lease = dialogs.acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        validate_payload(kind, &bytes)?;
        let filename = suggested_filename(&filename, kind);
        let selected = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title(match kind {
                FileKind::Json => "儲存 pst 時程文件",
                FileKind::Png => "儲存 PNG 圖片",
            })
            .set_file_name(filename)
            .add_filter(kind.filter_name(), &[kind.extension()])
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(false);
        };
        let path = selected
            .into_path()
            .map_err(|_| "所選位置不是可寫入的本機檔案。".to_string())?;
        file_io::save_selected_file(&path, kind, &bytes)?;
        Ok(true)
    })
    .await
    .map_err(|_| "檔案儲存無法完成，請稍後再試。".to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(DialogState::default())
        .invoke_handler(tauri::generate_handler![open_document, save_file])
        .setup(|app| {
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .ok_or("缺少主要視窗設定。")?;
            tauri::WebviewWindowBuilder::from_config(app, config)?
                .on_navigation(|url| {
                    allowed_navigation(
                        url.scheme(),
                        url.host_str(),
                        url.port(),
                        url.path(),
                        !url.username().is_empty() || url.password().is_some(),
                        cfg!(dev),
                    )
                })
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("無法啟動 pst 桌面應用程式。");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dialog_lease_blocks_overlap_and_releases_after_cancel_or_error() {
        let dialogs = DialogState::default();
        let first = dialogs.acquire().unwrap();
        assert!(dialogs.acquire().is_err());
        drop(first);
        assert!(dialogs.acquire().is_ok());
    }
}
