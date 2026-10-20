use crate::file_policy::{
    FileKind, MAX_OPEN_JSON_BYTES, read_document_text, validate_payload, validate_selected_path,
};
use std::fs::File;
use std::io::Write;
use std::path::Path;

/// The only caller supplies a path returned by the native open dialog, never IPC.
pub fn read_selected_document(path: &Path) -> Result<String, String> {
    let file = File::open(path)
        .map_err(|_| "無法開啟時程文件，請確認檔案仍存在且可以存取。".to_string())?;
    let metadata = file
        .metadata()
        .map_err(|_| "無法讀取這個檔案的資訊。".to_string())?;
    if !metadata.is_file() {
        return Err("請選擇一般 JSON 檔案。".into());
    }
    if metadata.len() > MAX_OPEN_JSON_BYTES as u64 {
        return Err("檔案超過 1,000,000 位元組，請選擇較小的 pst JSON 檔案。".into());
    }
    read_document_text(file)
}

/// Complete and synchronize a temporary file before replacing the chosen destination.
/// A failed write leaves the existing file intact. The tempfile remains in the same
/// directory so persist() can atomically replace on Windows and macOS.
pub fn save_selected_file(path: &Path, kind: FileKind, bytes: &[u8]) -> Result<(), String> {
    validate_payload(kind, bytes)?;
    validate_selected_path(path, kind)?;
    let directory = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| "儲存位置無效，請重新選擇資料夾。".to_string())?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".pst-save-")
        .tempfile_in(directory)
        .map_err(|_| "無法在所選資料夾建立檔案，請確認寫入權限與剩餘空間。".to_string())?;
    temporary
        .write_all(bytes)
        .map_err(|_| "寫入未完成；原有檔案保持不變，請確認剩餘空間後重試。".to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| "無法完成磁碟寫入；原有檔案保持不變，請重試。".to_string())?;
    temporary.persist(path).map_err(|_| {
        "無法取代目的檔案；原有檔案保持不變，請確認檔案未被其他程式鎖定。".to_string()
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn atomic_save_preserves_exact_recovery_bytes_and_replaces_existing_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("recovery.json");
        fs::write(&path, "old document").unwrap();
        let bytes = "\u{feff}{broken JSON\r\n資料".as_bytes();
        save_selected_file(&path, FileKind::Json, bytes).unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(read_selected_document(&path).unwrap().as_bytes(), bytes);
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn rejected_payload_or_extension_never_changes_an_existing_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("existing.json");
        fs::write(&path, "keep me").unwrap();
        assert!(save_selected_file(&path, FileKind::Png, b"not a png").is_err());
        assert!(
            save_selected_file(&path, FileKind::Png, crate::file_policy::PNG_SIGNATURE).is_err()
        );
        assert_eq!(fs::read(&path).unwrap(), b"keep me");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn failed_replace_leaves_the_destination_and_cleans_up_temporary_file() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("folder.json");
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("keep.txt"), "keep me").unwrap();
        assert!(save_selected_file(&destination, FileKind::Json, b"new data").is_err());
        assert_eq!(fs::read(destination.join("keep.txt")).unwrap(), b"keep me");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn native_read_rejects_large_files_before_loading_them() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("too-large.json");
        File::create(&path)
            .unwrap()
            .set_len((MAX_OPEN_JSON_BYTES + 1) as u64)
            .unwrap();
        assert!(
            read_selected_document(&path)
                .unwrap_err()
                .contains("1,000,000")
        );
        assert!(read_selected_document(&directory.path().join("missing.json")).is_err());
    }
}
