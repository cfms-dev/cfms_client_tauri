//! File listing and node-lookup contracts, independent of the native shell.

pub mod access_batches;
pub mod download_paths;
pub mod node_path;
pub mod shortcuts;
#[cfg(test)]
mod workflow_tests;

use cfms_core::{CursorPage, ListDirectoryResponse};
use serde::{Deserialize, Serialize};

pub const SERVER_CURSOR_PAGE_SIZE: u32 = 128;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ListingCursorPage {
    #[serde(default)]
    pub items: Vec<cfms_core::ServerListingItem>,
    #[serde(default)]
    pub page_size: u32,
    #[serde(default)]
    pub next_cursor: Option<String>,
    #[serde(default)]
    pub has_more: bool,
    #[serde(default)]
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ListDirectoryPageDto {
    pub folders: Vec<cfms_core::ServerDirectoryEntry>,
    pub documents: Vec<cfms_core::ServerDocumentEntry>,
    pub parent_id: Option<String>,
    pub page_size: u32,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

pub fn split_listing_page(page: ListingCursorPage) -> ListDirectoryResponse {
    let mut folders = Vec::new();
    let mut documents = Vec::new();

    for item in page.items {
        match item {
            cfms_core::ServerListingItem::Directory(folder) => folders.push(folder),
            cfms_core::ServerListingItem::Document(document) => documents.push(document),
        }
    }

    ListDirectoryResponse {
        folders,
        documents,
        parent_id: page.parent_id,
    }
}

fn split_listing_page_dto(page: ListingCursorPage) -> ListDirectoryPageDto {
    let page_size = page.page_size;
    let next_cursor = page.next_cursor.clone();
    let has_more = page.has_more;
    let split = split_listing_page(page);

    ListDirectoryPageDto {
        folders: split.folders,
        documents: split.documents,
        parent_id: split.parent_id,
        page_size,
        next_cursor,
        has_more,
    }
}

pub fn merge_listing_response(target: &mut ListDirectoryResponse, page: ListingCursorPage) {
    target.parent_id = page.parent_id.clone();
    let split = split_listing_page(page);
    target.folders.extend(split.folders);
    target.documents.extend(split.documents);
}

pub fn normalize_search_page(mut page: CursorPage<serde_json::Value>) -> serde_json::Value {
    let items: Vec<serde_json::Value> = page
        .items
        .drain(..)
        .filter(|item| {
            matches!(
                item.get("type").and_then(|value| value.as_str()),
                Some("directory" | "document")
            )
        })
        .collect();

    serde_json::json!({
        "items": items,
        "page_size": page.page_size,
        "next_cursor": page.next_cursor,
        "has_more": page.has_more,
    })
}

pub fn directory_page_size(page_size: Option<u32>) -> u32 {
    page_size
        .unwrap_or(SERVER_CURSOR_PAGE_SIZE)
        .clamp(1, SERVER_CURSOR_PAGE_SIZE)
}

pub fn parse_listing_page_dto(raw: serde_json::Value) -> Result<ListDirectoryPageDto, String> {
    let page: ListingCursorPage = serde_json::from_value(raw)
        .map_err(|e| format!("Invalid list_directory page response: {e}"))?;
    if !(1..=SERVER_CURSOR_PAGE_SIZE).contains(&page.page_size) {
        return Err(format!(
            "Invalid list_directory page response: page_size must be between 1 and {SERVER_CURSOR_PAGE_SIZE}"
        ));
    }
    if page.has_more && page.next_cursor.is_none() {
        return Err(
            "Invalid list_directory page response: has_more requires next_cursor".to_string(),
        );
    }
    Ok(split_listing_page_dto(page))
}

pub fn supports_node_lookup(extension_flags: &[String]) -> bool {
    extension_flags.iter().any(|flag| flag == "node_lookup")
}

#[cfg(test)]
mod protocol_v15_tests {
    use super::*;
    use crate::files::{
        directory_page_size, normalize_search_page, parse_listing_page_dto, split_listing_page,
        split_listing_page_dto,
    };
    use crate::transfers::{relative_upload_path, suffixed_upload_name};

    #[test]
    fn split_listing_page_maps_v15_items_to_legacy_response() {
        let page: ListingCursorPage = serde_json::from_str(
            r#"{
                "items": [
                    { "type": "directory", "id": "dir", "name": "Folder", "created_time": 1.0 },
                    { "type": "document", "id": "doc", "title": "File", "name": "File", "size": 5, "last_modified": 2.0 }
                ],
                "page_size": 128,
                "next_cursor": null,
                "has_more": false,
                "parent_id": "/"
            }"#,
        )
        .unwrap();

        let split = split_listing_page(page);

        assert_eq!(split.folders.len(), 1);
        assert_eq!(split.folders[0].name, "Folder");
        assert_eq!(split.documents.len(), 1);
        assert_eq!(split.documents[0].title, "File");
        assert_eq!(split.parent_id.as_deref(), Some("/"));
    }

    #[test]
    fn split_listing_page_dto_preserves_cursor_metadata() {
        let page: ListingCursorPage = serde_json::from_str(
            r#"{
                "items": [
                    { "type": "directory", "id": "dir", "name": "Folder", "created_time": 1.0 },
                    { "type": "document", "id": "doc", "title": "File", "size": 5, "last_modified": 2.0 }
                ],
                "page_size": 128,
                "next_cursor": "next-page",
                "has_more": true,
                "parent_id": "parent"
            }"#,
        )
        .unwrap();

        let split = split_listing_page_dto(page);

        assert_eq!(split.folders.len(), 1);
        assert_eq!(split.documents.len(), 1);
        assert_eq!(split.parent_id.as_deref(), Some("parent"));
        assert_eq!(split.page_size, 128);
        assert_eq!(split.next_cursor.as_deref(), Some("next-page"));
        assert!(split.has_more);
    }

    #[test]
    fn directory_page_size_is_clamped_to_protocol_limits() {
        assert_eq!(directory_page_size(None), SERVER_CURSOR_PAGE_SIZE);
        assert_eq!(directory_page_size(Some(0)), 1);
        assert_eq!(directory_page_size(Some(32)), 32);
        assert_eq!(directory_page_size(Some(10_000)), SERVER_CURSOR_PAGE_SIZE);
    }

    #[test]
    fn invalid_listing_page_returns_a_descriptive_error() {
        let error = parse_listing_page_dto(serde_json::json!({ "has_more": false }))
            .expect_err("missing page fields must fail");

        assert!(error.starts_with("Invalid list_directory page response:"));
    }

    #[test]
    fn normalize_search_page_preserves_item_order_and_cursor_metadata() {
        let page: CursorPage<serde_json::Value> = serde_json::from_str(
            r#"{
                "items": [
                    { "type": "document", "id": "doc-1", "name": "Alpha.txt", "size": 5 },
                    { "type": "directory", "id": "dir-1", "name": "Beta" },
                    { "type": "unknown", "id": "ignored" },
                    { "type": "document", "id": "doc-2", "name": "Gamma.txt", "size": 9 }
                ],
                "page_size": 64,
                "next_cursor": "cursor",
                "has_more": true
            }"#,
        )
        .unwrap();

        let normalized = normalize_search_page(page);
        let items = normalized["items"].as_array().unwrap();

        assert_eq!(items.len(), 3);
        assert_eq!(items[0]["id"], "doc-1");
        assert_eq!(items[1]["id"], "dir-1");
        assert_eq!(items[2]["id"], "doc-2");
        assert_eq!(normalized["page_size"], 64);
        assert_eq!(normalized["next_cursor"], "cursor");
        assert_eq!(normalized["has_more"], true);
    }

    #[test]
    fn keep_both_suffix_preserves_file_extension() {
        assert_eq!(suffixed_upload_name("report.pdf", 2), "report (2).pdf");
        assert_eq!(suffixed_upload_name("README", 1), "README (1)");
    }

    #[test]
    fn relative_upload_paths_use_protocol_separators() {
        let path = std::path::Path::new("nested")
            .join("reports")
            .join("summary.txt");
        assert_eq!(relative_upload_path(&path), "nested/reports/summary.txt");
    }
}

#[cfg(test)]
mod node_lookup_response_tests {
    use super::supports_node_lookup;

    #[test]
    fn requires_the_exact_node_lookup_extension_flag() {
        assert!(supports_node_lookup(&["node_lookup".into()]));
        assert!(!supports_node_lookup(&[
            "node-lookup".into(),
            "documents".into()
        ]));
    }
}
