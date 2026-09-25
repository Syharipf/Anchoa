//! The system clipboard, so copy and paste work across file managers.
//!
//! Files are offered as a file list (`text/uri-list`), in the GNOME copied-files format
//! Nautilus and Dolphin use to tell a cut from a copy, and as plain paths.

use std::path::PathBuf;

use anchoa::paste;
use relm4::gtk;
use relm4::gtk::gio::prelude::*;
use relm4::gtk::{gdk, gio};

const GNOME_COPIED_FILES_MIME: &str = "x-special/gnome-copied-files";
const PLAIN_TEXT_MIME: &str = "text/plain";

/// Puts `paths` on the clipboard, marked as cut or copied.
pub fn write(clipboard: &gdk::Clipboard, paths: &[PathBuf], cut: bool) {
    let files: Vec<_> = paths.iter().map(gio::File::for_path).collect();
    let file_list = gdk::FileList::from_array(&files).to_value();
    let gnome = gtk::glib::Bytes::from_owned(paste::gnome_copied_files(paths, cut).into_bytes());
    let text = paths
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("\n");
    let text = gtk::glib::Bytes::from_owned(text.into_bytes());
    let provider = gdk::ContentProvider::new_union(&[
        gdk::ContentProvider::for_value(&file_list),
        gdk::ContentProvider::for_bytes(GNOME_COPIED_FILES_MIME, &gnome),
        gdk::ContentProvider::for_bytes(PLAIN_TEXT_MIME, &text),
    ]);
    let _ = clipboard.set_content(Some(&provider));
}

/// Empties the clipboard, as after a cut has been pasted.
pub fn clear(clipboard: &gdk::Clipboard) {
    let _ = clipboard.set_content(None::<&gdk::ContentProvider>);
}

/// Reads files from the clipboard without blocking: the GNOME copied-files format first
/// (it says whether they were cut), then a plain file list (a copy). `None` when the
/// clipboard holds anything else.
pub async fn read(clipboard: &gdk::Clipboard) -> Option<(Vec<PathBuf>, bool)> {
    if clipboard
        .formats()
        .contain_mime_type(GNOME_COPIED_FILES_MIME)
        && let Ok((stream, mime)) = clipboard
            .read_future(&[GNOME_COPIED_FILES_MIME], gtk::glib::Priority::DEFAULT)
            .await
        && mime.as_str() == GNOME_COPIED_FILES_MIME
        && let Some(bytes) = read_stream(stream).await
        && let Ok(text) = String::from_utf8(bytes)
        && let Some(parsed) = paste::parse_gnome_copied_files(&text)
    {
        return Some(parsed);
    }
    let value = clipboard
        .read_value_future(gdk::FileList::static_type(), gtk::glib::Priority::DEFAULT)
        .await
        .ok()?;
    let files = value.get::<gdk::FileList>().ok()?;
    let sources: Vec<_> = files
        .files()
        .into_iter()
        .filter_map(|file| file.path())
        .collect();
    (!sources.is_empty()).then_some((sources, false))
}

/// Reads a clipboard stream to its end, giving up past 16 MiB.
async fn read_stream(stream: gio::InputStream) -> Option<Vec<u8>> {
    const CHUNK_SIZE: usize = 64 * 1024;
    const MAX_SIZE: usize = 16 * 1024 * 1024;
    let mut data = Vec::new();
    loop {
        let bytes = stream
            .read_bytes_future(CHUNK_SIZE, gtk::glib::Priority::DEFAULT)
            .await
            .ok()?;
        if bytes.is_empty() {
            return Some(data);
        }
        if data.len().saturating_add(bytes.len()) > MAX_SIZE {
            return None;
        }
        data.extend_from_slice(bytes.as_ref());
    }
}
