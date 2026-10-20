fn main() {
    // Explicit application permissions prevent these commands being available to
    // another webview merely because it has an IPC bridge.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["open_document", "save_file"]),
        ),
    )
    .expect("無法建立 pst 桌面應用程式的設定與權限。");
}
