//! File listing and node-lookup contracts, independent of the native shell.

pub mod access_batches;
pub mod download_paths;
pub mod node_path;
pub mod shortcuts;
#[cfg(test)]
mod workflow_tests;

use cfms_core::{CursorPage, ListDirectoryResponse, NodeLookupResponse};
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

pub fn split_listing_page_dto(page: ListingCursorPage) -> ListDirectoryPageDto {
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

pub fn split_search_page(mut page: CursorPage<serde_json::Value>) -> serde_json::Value {
    let mut documents = Vec::new();
    let mut directories = Vec::new();

    for item in page.items.drain(..) {
        match item.get("type").and_then(|value| value.as_str()) {
            Some("directory") => directories.push(item),
            Some("document") => documents.push(item),
            _ => {}
        }
    }

    serde_json::json!({
        "documents": documents,
        "directories": directories,
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

pub fn validate_node_lookup_response(
    response: NodeLookupResponse,
) -> Result<NodeLookupResponse, String> {
    if response.node_ids.first().map(String::as_str) != Some("/") {
        return Err(
            "Invalid node_lookup response: node_ids must start with the root ID".to_string(),
        );
    }
    if response.node_ids.iter().any(|node_id| node_id.is_empty()) {
        return Err(
            "Invalid node_lookup response: node_ids must not contain empty IDs".to_string(),
        );
    }
    Ok(response)
}

#[cfg(test)]
mod protocol_v15_tests {
    use super::*;
    use crate::files::{
        directory_page_size, parse_listing_page_dto, split_listing_page, split_listing_page_dto,
        split_search_page,
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
    fn split_search_page_preserves_cursor_metadata() {
        let page: CursorPage<serde_json::Value> = serde_json::from_str(
            r#"{
                "items": [
                    { "type": "directory", "id": "dir", "name": "Folder" },
                    { "type": "document", "id": "doc", "name": "File", "size": 5 }
                ],
                "page_size": 64,
                "next_cursor": "cursor",
                "has_more": true
            }"#,
        )
        .unwrap();

        let split = split_search_page(page);

        assert_eq!(split["directories"].as_array().unwrap().len(), 1);
        assert_eq!(split["documents"].as_array().unwrap().len(), 1);
        assert_eq!(split["page_size"], 64);
        assert_eq!(split["next_cursor"], "cursor");
        assert_eq!(split["has_more"], true);
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
    use super::{supports_node_lookup, validate_node_lookup_response};
    use cfms_core::NodeLookupResponse;

    #[test]
    fn accepts_rooted_non_empty_node_id_chains() {
        let response = NodeLookupResponse {
            node_ids: vec!["/".into(), "projects".into()],
        };
        assert_eq!(
            validate_node_lookup_response(response).unwrap().node_ids,
            ["/", "projects"]
        );
    }

    #[test]
    fn requires_the_exact_node_lookup_extension_flag() {
        assert!(supports_node_lookup(&["node_lookup".into()]));
        assert!(!supports_node_lookup(&[
            "node-lookup".into(),
            "documents".into()
        ]));
    }

    #[test]
    fn rejects_missing_root_and_empty_ids() {
        let missing_root = NodeLookupResponse {
            node_ids: vec!["projects".into()],
        };
        assert!(validate_node_lookup_response(missing_root).is_err());

        let empty_id = NodeLookupResponse {
            node_ids: vec!["/".into(), "".into()],
        };
        assert!(validate_node_lookup_response(empty_id).is_err());
    }
}
