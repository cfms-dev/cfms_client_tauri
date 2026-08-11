// Hidden desktop developer request console.

fn normalize_developer_action(action: String) -> Result<String, String> {
    let action = action.trim();
    if action.is_empty() {
        return Err("Business name cannot be empty".to_string());
    }
    Ok(action.to_string())
}

/// Send an arbitrary authenticated business request and preserve the complete
/// server response envelope, including non-success status codes.
#[tauri::command]
pub async fn send_developer_request(
    state: tauri::State<'_, AppHandleState>,
    action: String,
    payload: serde_json::Value,
) -> Result<cfms_core::Response, String> {
    let action = normalize_developer_action(action)?;
    server_action_response(&state, &action, payload).await
}

#[cfg(test)]
mod developer_request_tests {
    use super::{ServerActionIdentity, normalize_developer_action, validate_server_action_identity};

    #[test]
    fn trims_and_accepts_arbitrary_business_names() {
        assert_eq!(
            normalize_developer_action("  get_document  ".to_string()).unwrap(),
            "get_document"
        );
        assert_eq!(
            normalize_developer_action("custom.business/v2".to_string()).unwrap(),
            "custom.business/v2"
        );
    }

    #[test]
    fn rejects_empty_business_names() {
        assert!(normalize_developer_action(" \n\t ".to_string()).is_err());
    }

    #[test]
    fn response_serialization_preserves_non_success_envelopes() {
        let response = cfms_core::Response {
            code: 403,
            message: "Forbidden".to_string(),
            data: serde_json::json!({ "reason": "permission_denied" }),
            timestamp: 1_723_456_789.25,
        };

        let value = serde_json::to_value(response).unwrap();
        assert_eq!(value["code"], 403);
        assert_eq!(value["message"], "Forbidden");
        assert_eq!(value["data"]["reason"], "permission_denied");
        assert_eq!(value["timestamp"], 1_723_456_789.25);
    }

    #[test]
    fn retry_identity_rejects_server_or_account_changes() {
        let expected = ServerActionIdentity {
            server_address: Some("server.example".to_string()),
            username: "developer".to_string(),
        };
        assert!(validate_server_action_identity(&expected, &expected).is_ok());
        assert!(
            validate_server_action_identity(
                &expected,
                &ServerActionIdentity {
                    server_address: Some("other.example".to_string()),
                    username: "developer".to_string(),
                },
            )
            .is_err()
        );
        assert!(
            validate_server_action_identity(
                &expected,
                &ServerActionIdentity {
                    server_address: Some("server.example".to_string()),
                    username: "another-user".to_string(),
                },
            )
            .is_err()
        );
    }
}
