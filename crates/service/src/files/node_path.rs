use crate::rpc::{SessionIdentity, action_once};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathSegment {
    pub id: String,
    pub label: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NodeTarget {
    Directory {
        id: String,
        label: String,
    },
    Document {
        id: String,
        label: String,
        #[serde(rename = "parentId")]
        parent_id: Option<String>,
    },
}
#[derive(Debug, Clone, Serialize)]
pub struct ResolvedNodeTarget {
    pub segments: Vec<PathSegment>,
    pub target: NodeTarget,
}

pub fn decode_segments(path: &str, ids: &[String]) -> Result<Vec<PathSegment>, String> {
    if !path.starts_with('/')
        || ids.first().map(String::as_str) != Some("/")
        || ids.iter().any(String::is_empty)
    {
        return Err("Invalid node_lookup root".into());
    }
    let parts: Vec<&str> = if path == "/" {
        vec![]
    } else {
        path[1..].split('/').collect()
    };
    if parts.len() + 1 != ids.len() || parts.iter().any(|part| part.is_empty()) {
        return Err("node_lookup path does not match node IDs".into());
    }
    parts
        .iter()
        .zip(&ids[1..])
        .map(|(part, id)| {
            let mut output = Vec::new();
            let mut bytes = part.as_bytes().iter().copied();
            while let Some(byte) = bytes.next() {
                if byte == b'%' {
                    let a = bytes
                        .next()
                        .and_then(|v| (v as char).to_digit(16))
                        .ok_or("Invalid encoded path")?;
                    let b = bytes
                        .next()
                        .and_then(|v| (v as char).to_digit(16))
                        .ok_or("Invalid encoded path")?;
                    output.push((a * 16 + b) as u8);
                } else {
                    output.push(byte);
                }
            }
            Ok(PathSegment {
                id: id.clone(),
                label: String::from_utf8(output).map_err(|_| "Invalid UTF-8 path")?,
            })
        })
        .collect()
}

pub async fn resolve(
    state: &crate::state::AppState,
    path: &str,
) -> Result<ResolvedNodeTarget, String> {
    let identity = SessionIdentity::capture(state).await?;
    if !super::supports_node_lookup(&state.server_extension_flags.read().await) {
        return Err("The connected server does not advertise node_lookup support".into());
    }
    let raw = action_once(
        state,
        &identity,
        "node_lookup.node.resolve",
        serde_json::json!({"path": path}),
    )
    .await
    .map_err(|e| e.to_string())?;
    let ids: Vec<String> = serde_json::from_value(raw.get("node_ids").cloned().unwrap_or_default())
        .map_err(|e| e.to_string())?;
    let segments = decode_segments(path, &ids)?;
    let Some(last) = segments.last() else {
        return Ok(ResolvedNodeTarget {
            segments,
            target: NodeTarget::Directory {
                id: "/".into(),
                label: "/".into(),
            },
        });
    };
    let target = match action_once(
        state,
        &identity,
        "core.directory.info.get",
        serde_json::json!({"directory_id": last.id}),
    )
    .await
    {
        Ok(_) => NodeTarget::Directory {
            id: last.id.clone(),
            label: last.label.clone(),
        },
        Err(error) if error.status == Some(404) => {
            let info = action_once(
                state,
                &identity,
                "core.document.info.get",
                serde_json::json!({"document_id": last.id}),
            )
            .await
            .map_err(|e| e.to_string())?;
            let expected = ids
                .get(ids.len() - 2)
                .filter(|id| id.as_str() != "/")
                .cloned();
            let actual = info
                .get("parent_id")
                .ok_or("Document response missing parent_id")?;
            let actual = actual.as_str().filter(|id| *id != "/");
            if actual != expected.as_deref() {
                return Err("node_lookup document parent does not match get_document_info".into());
            }
            NodeTarget::Document {
                id: last.id.clone(),
                label: info
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&last.label)
                    .into(),
                parent_id: expected,
            }
        }
        Err(error) => return Err(error.to_string()),
    };
    Ok(ResolvedNodeTarget { segments, target })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decodes_names_once_and_checks_shape() {
        let ids = ["/", "a", "b"].map(String::from);
        let parts = decode_segments("/项目 A/%252F", &ids).unwrap();
        assert_eq!(parts[1].label, "%2F");
        for path in ["/a/", "/a", "/%zz/b", "/%FF/b"] {
            assert!(decode_segments(path, &ids).is_err());
        }
        assert!(decode_segments("/", &["/".into()]).unwrap().is_empty());
    }
}
