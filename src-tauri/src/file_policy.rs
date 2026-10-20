//! Pure, dependency-free policies shared by native dialogs and filesystem I/O.
//! No function in this module accepts a path supplied through IPC.

use std::io::Read;
use std::path::Path;

pub const MAX_OPEN_JSON_BYTES: usize = 1_000_000;
// Recovery copies may be larger than a valid import; keep their raw UTF-8 intact.
pub const MAX_SAVE_JSON_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_PNG_BYTES: usize = 128 * 1024 * 1024;
pub const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
const MAX_FILENAME_BYTES: usize = 180;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FileKind {
    Json,
    Png,
}

impl FileKind {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "json" => Ok(Self::Json),
            "png" => Ok(Self::Png),
            _ => Err("不支援這個檔案類型；只能儲存 JSON 或 PNG。".into()),
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Png => "png",
        }
    }

    pub fn filter_name(self) -> &'static str {
        match self {
            Self::Json => "pst 時程文件（JSON）",
            Self::Png => "PNG 圖片",
        }
    }

    pub fn maximum_bytes(self) -> usize {
        match self {
            Self::Json => MAX_SAVE_JSON_BYTES,
            Self::Png => MAX_PNG_BYTES,
        }
    }
}

pub fn validate_size(kind: FileKind, length: usize) -> Result<(), String> {
    if length > kind.maximum_bytes() {
        return Err(match kind {
            FileKind::Json => "JSON 或復原備份超過 16 MiB，無法儲存。",
            FileKind::Png => "PNG 圖片超過 128 MiB，請降低輸出倍率或縮小日期範圍。",
        }
        .into());
    }
    Ok(())
}

pub fn validate_payload(kind: FileKind, bytes: &[u8]) -> Result<(), String> {
    validate_size(kind, bytes.len())?;
    match kind {
        FileKind::Json => {
            // Do not parse JSON: the user must be able to preserve a corrupt backup.
            std::str::from_utf8(bytes).map_err(|_| "JSON 備份必須是 UTF-8 文字。".to_string())?;
        }
        FileKind::Png => {
            if !bytes.starts_with(PNG_SIGNATURE) {
                return Err("圖片資料缺少有效的 PNG 檔案標頭。".into());
            }
        }
    }
    Ok(())
}

/// Read at most one byte past the import cap, including when the file grows while open.
pub fn read_document_text(reader: impl Read) -> Result<String, String> {
    let mut bytes = Vec::new();
    reader
        .take((MAX_OPEN_JSON_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "無法讀取時程文件，請確認檔案仍存在且可以存取。".to_string())?;
    if bytes.len() > MAX_OPEN_JSON_BYTES {
        return Err("檔案超過 1,000,000 位元組，請選擇較小的 pst JSON 檔案。".into());
    }
    String::from_utf8(bytes).map_err(|_| "此檔案不是有效的 UTF-8 文字，無法作為 JSON 開啟。".into())
}

fn is_windows_reserved(stem: &str) -> bool {
    let base = stem.split('.').next().unwrap_or(stem).to_ascii_uppercase();
    matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$")
        || ((base.starts_with("COM") || base.starts_with("LPT"))
            && base.len() == 4
            && matches!(base.as_bytes()[3], b'1'..=b'9'))
}

/// A filename suggestion is never a filesystem path. Preserve readable Unicode names.
pub fn suggested_filename(filename: &str, kind: FileKind) -> String {
    let basename = filename.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = basename
        .chars()
        .map(|ch| {
            if ch.is_control()
                || matches!(ch, '<' | '>' | ':' | '"' | '|' | '?' | '*')
                || matches!(ch, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
            {
                '-'
            } else {
                ch
            }
        })
        .collect();
    let cleaned = cleaned.trim_matches(|ch: char| ch.is_whitespace() || ch == '.');
    let stem = cleaned.rsplit_once('.').map_or(cleaned, |(stem, _)| stem);
    let stem = stem.trim_matches(|ch: char| ch.is_whitespace() || ch == '.');
    let mut safe = String::new();
    if is_windows_reserved(stem) {
        safe.push_str("pst-");
    }
    for ch in stem.chars() {
        if safe.len() + ch.len_utf8() > MAX_FILENAME_BYTES {
            break;
        }
        safe.push(ch);
    }
    let safe = safe.trim_end_matches(|ch: char| ch.is_whitespace() || ch == '.');
    let safe = if safe.is_empty() {
        "pst-timeline"
    } else {
        safe
    };
    format!("{safe}.{}", kind.extension())
}

/// Validate the exact path returned by the dialog; never silently rewrite its extension.
/// Rewriting after the dialog could bypass an overwrite confirmation for another file.
pub fn validate_selected_path(path: &Path, kind: FileKind) -> Result<(), String> {
    let valid = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(kind.extension()));
    if !valid || path.file_name().is_none() {
        return Err(format!("請在儲存對話框使用 .{} 副檔名。", kind.extension()));
    }
    Ok(())
}

/// Only the embedded root document (or the exact loopback dev origin) may navigate.
pub fn allowed_navigation(
    scheme: &str,
    host: Option<&str>,
    port: Option<u16>,
    path: &str,
    has_credentials: bool,
    development: bool,
) -> bool {
    if has_credentials || !matches!(path, "/" | "/index.html") {
        return false;
    }
    match (scheme, host, port) {
        ("tauri", Some("localhost"), None) => true,
        ("http" | "https", Some("tauri.localhost"), None) => true,
        ("http", Some("127.0.0.1"), Some(1420)) if development => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Error, ErrorKind};

    #[test]
    fn import_preserves_corrupt_json_bom_crlf_and_unicode() {
        for text in ["", "{broken json", "\u{feff}{\r\n\"name\":\"時程☀\"\r\n}"] {
            assert_eq!(
                read_document_text(Cursor::new(text.as_bytes())).unwrap(),
                text
            );
        }
    }

    #[test]
    fn import_accepts_exact_byte_limit_and_rejects_one_more() {
        assert_eq!(
            read_document_text(Cursor::new(vec![b'a'; MAX_OPEN_JSON_BYTES]))
                .unwrap()
                .len(),
            MAX_OPEN_JSON_BYTES
        );
        assert!(
            read_document_text(Cursor::new(vec![b'a'; MAX_OPEN_JSON_BYTES + 1]))
                .unwrap_err()
                .contains("1,000,000")
        );
        // The limit is UTF-8 bytes, not JavaScript character count.
        assert!(read_document_text(Cursor::new("日".repeat(333_334).into_bytes())).is_err());
    }

    #[test]
    fn import_reader_is_bounded_even_without_metadata() {
        struct CountingReader(usize);
        impl Read for CountingReader {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                self.0 += buf.len();
                assert!(self.0 <= MAX_OPEN_JSON_BYTES + 1);
                buf.fill(b'a');
                Ok(buf.len())
            }
        }
        assert!(read_document_text(CountingReader(0)).is_err());
    }

    #[test]
    fn import_rejects_non_utf8_and_read_errors() {
        assert!(
            read_document_text(Cursor::new([0xff, 0xfe]))
                .unwrap_err()
                .contains("UTF-8")
        );
        struct BrokenReader;
        impl Read for BrokenReader {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                Err(Error::new(ErrorKind::PermissionDenied, "test"))
            }
        }
        assert!(
            read_document_text(BrokenReader)
                .unwrap_err()
                .contains("無法讀取")
        );
    }

    #[test]
    fn save_limits_are_independent_and_accept_their_boundaries() {
        assert!(validate_size(FileKind::Json, MAX_SAVE_JSON_BYTES).is_ok());
        assert!(validate_size(FileKind::Json, MAX_SAVE_JSON_BYTES + 1).is_err());
        assert!(validate_size(FileKind::Png, MAX_PNG_BYTES).is_ok());
        assert!(validate_size(FileKind::Png, MAX_PNG_BYTES + 1).is_err());
        assert!(validate_size(FileKind::Png, usize::MAX).is_err());
        let large_recovery = vec![b'{'; MAX_OPEN_JSON_BYTES + 1];
        assert!(validate_payload(FileKind::Json, &large_recovery).is_ok());
    }

    #[test]
    fn json_save_keeps_raw_utf8_without_attempting_json_parse() {
        for bytes in [
            b"".as_slice(),
            b"{broken json",
            "\u{feff}資料\r\n".as_bytes(),
        ] {
            assert!(validate_payload(FileKind::Json, bytes).is_ok());
        }
        assert!(validate_payload(FileKind::Json, &[0xff]).is_err());
    }

    #[test]
    fn png_save_requires_the_complete_binary_signature() {
        assert!(validate_payload(FileKind::Png, PNG_SIGNATURE).is_ok());
        let mut bytes = PNG_SIGNATURE.to_vec();
        bytes.extend_from_slice(&[0, 1, 255, 0]);
        assert!(validate_payload(FileKind::Png, &bytes).is_ok());
        for bytes in [
            b"".as_slice(),
            b"PNG",
            &PNG_SIGNATURE[..7],
            b"\x89PNG\n\r\x1a\n",
            b"{\"png\":true}",
        ] {
            assert!(validate_payload(FileKind::Png, bytes).is_err());
        }
    }

    #[test]
    fn filenames_cannot_supply_a_path_or_another_extension() {
        assert_eq!(
            suggested_filename("../../private/report.json", FileKind::Json),
            "report.json"
        );
        assert_eq!(
            suggested_filename(r"C:\Users\name\report.exe", FileKind::Png),
            "report.png"
        );
        assert_eq!(
            suggested_filename("schedule.pst.JSON", FileKind::Json),
            "schedule.pst.json"
        );
        assert_eq!(
            suggested_filename("../", FileKind::Json),
            "pst-timeline.json"
        );
        assert_eq!(suggested_filename("...", FileKind::Png), "pst-timeline.png");
        assert_eq!(
            suggested_filename("報告\u{202e}gpj.exe", FileKind::Json),
            "報告-gpj.json"
        );
    }

    #[test]
    fn filenames_preserve_unicode_but_avoid_reserved_names_and_excess_bytes() {
        assert_eq!(
            suggested_filename(" 產品上線時程.json ", FileKind::Json),
            "產品上線時程.json"
        );
        for reserved in ["CON", "nul", "AUX.json", "COM1", "LPT9", "con.backup.json"] {
            assert!(suggested_filename(reserved, FileKind::Json).starts_with("pst-"));
        }
        let long = suggested_filename(&"日".repeat(500), FileKind::Png);
        assert!(long.len() <= MAX_FILENAME_BYTES + 4);
        assert!(long.ends_with(".png"));
        assert_eq!(
            suggested_filename("a\0b:c?d*.json", FileKind::Json),
            "a-b-c-d-.json"
        );
    }

    #[test]
    fn selected_paths_are_not_retargeted_after_native_confirmation() {
        assert!(validate_selected_path(Path::new("/chosen/output.JSON"), FileKind::Json).is_ok());
        assert!(validate_selected_path(Path::new("/chosen/output.png"), FileKind::Png).is_ok());
        for filename in ["output", "output.exe", "output.png.json", "/"] {
            assert!(validate_selected_path(Path::new(filename), FileKind::Png).is_err());
        }
        assert_eq!(FileKind::parse("png"), Ok(FileKind::Png));
        for kind in ["PNG", "text", "", "../json"] {
            assert!(FileKind::parse(kind).is_err());
        }
    }

    #[test]
    fn navigation_accepts_only_local_root_documents_and_exact_dev_origin() {
        assert!(allowed_navigation(
            "tauri",
            Some("localhost"),
            None,
            "/index.html",
            false,
            false
        ));
        assert!(allowed_navigation(
            "http",
            Some("tauri.localhost"),
            None,
            "/",
            false,
            false
        ));
        assert!(allowed_navigation(
            "https",
            Some("tauri.localhost"),
            None,
            "/",
            false,
            false
        ));
        assert!(allowed_navigation(
            "http",
            Some("127.0.0.1"),
            Some(1420),
            "/",
            false,
            true
        ));
        for (scheme, host, port, path, credentials) in [
            ("https", Some("example.com"), None, "/", false),
            ("http", Some("tauri.localhost.evil.test"), None, "/", false),
            ("http", Some("127.0.0.1"), Some(1421), "/", false),
            ("tauri", Some("localhost"), None, "/other.html", false),
            ("tauri", Some("localhost"), None, "/", true),
            ("file", None, None, "/index.html", false),
            ("javascript", None, None, "/", false),
        ] {
            assert!(!allowed_navigation(
                scheme,
                host,
                port,
                path,
                credentials,
                true
            ));
        }
        assert!(!allowed_navigation(
            "http",
            Some("127.0.0.1"),
            Some(1420),
            "/",
            false,
            false
        ));
    }
}
