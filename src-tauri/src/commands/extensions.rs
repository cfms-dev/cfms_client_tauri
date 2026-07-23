// Signed declarative extension management and host API broker.

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionAccountStateDto {
    enabled: bool,
    install_epoch: String,
    granted_capabilities: Vec<String>,
    settings: serde_json::Value,
    stale_installation: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionOverviewDto {
    installed: Vec<cfms_service::extensions::ExtensionInstallation>,
    account_states: std::collections::BTreeMap<String, ExtensionAccountStateDto>,
    catalog: Option<cfms_service::extensions::CatalogDocument>,
    trusted_keys_configured: bool,
    host_api_version: &'static str,
}

#[tauri::command]
pub async fn get_extension_overview(
    state: tauri::State<'_, AppHandleState>,
) -> Result<ExtensionOverviewDto, String> {
    let store = state.extensions.clone();
    let installed = tokio::task::spawn_blocking(move || store.list_installed())
        .await
        .map_err(|e| format!("Extension list task failed: {e}"))??;
    let account_preferences = load_current_extension_preferences(&state).await?;
    let account_states = installed
        .iter()
        .map(|installation| {
            let preference = account_preferences
                .as_ref()
                .and_then(|preferences| preferences.get(&installation.manifest.id));
            let revoked = state
                .extensions
                .revocation_reason(&installation.manifest.id, &installation.manifest.version)
                .ok()
                .flatten()
                .is_some();
            let stale = preference
                .is_some_and(|preference| preference.install_epoch != installation.install_epoch);
            let grants_current = preference.is_some_and(|preference| {
                installation
                    .manifest
                    .requested_capabilities
                    .iter()
                    .all(|capability| preference.granted_capabilities.contains(capability))
            });
            let dto = preference.map_or_else(
                || ExtensionAccountStateDto {
                    enabled: false,
                    install_epoch: String::new(),
                    granted_capabilities: Vec::new(),
                    settings: serde_json::Value::Null,
                    stale_installation: false,
                },
                |preference| ExtensionAccountStateDto {
                    enabled: preference.enabled && !stale && !revoked && grants_current,
                    install_epoch: preference.install_epoch.clone(),
                    granted_capabilities: preference.granted_capabilities.clone(),
                    settings: preference.settings.clone(),
                    stale_installation: stale,
                },
            );
            (installation.manifest.id.clone(), dto)
        })
        .collect();
    let catalog = state
        .extensions
        .cached_catalog(cfms_service::extensions::DEFAULT_CATALOG_URL)
        .unwrap_or(None);

    Ok(ExtensionOverviewDto {
        installed,
        account_states,
        catalog,
        trusted_keys_configured: state.extensions.has_trusted_keys(),
        host_api_version: cfms_service::extensions::HOST_API_VERSION,
    })
}

#[tauri::command]
pub async fn import_extension_package(
    state: tauri::State<'_, AppHandleState>,
    path: String,
) -> Result<cfms_service::extensions::ExtensionInstallation, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = state;
        let _ = path;
        return Err("Installable extension packages are not available on mobile".into());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let package_path = std::path::PathBuf::from(path);
        let metadata = tokio::fs::metadata(&package_path)
            .await
            .map_err(|e| format!("Failed to inspect extension package: {e}"))?;
        if !metadata.is_file() || metadata.len() > 20 * 1024 * 1024 {
            return Err("Extension package must be a file no larger than 20 MiB".into());
        }
        let package = tokio::fs::read(&package_path)
            .await
            .map_err(|e| format!("Failed to read extension package: {e}"))?;
        let store = state.extensions.clone();
        tokio::task::spawn_blocking(move || store.install_package(&package))
            .await
            .map_err(|e| format!("Extension installation task failed: {e}"))?
    }
}

#[tauri::command]
pub async fn refresh_extension_catalog(
    state: tauri::State<'_, AppHandleState>,
) -> Result<cfms_service::extensions::CatalogDocument, String> {
    fetch_and_cache_extension_catalog(&state).await
}

#[tauri::command]
pub async fn install_extension_from_catalog(
    state: tauri::State<'_, AppHandleState>,
    extension_id: String,
) -> Result<cfms_service::extensions::ExtensionInstallation, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = state;
        let _ = extension_id;
        return Err("Installable extension packages are not available on mobile".into());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let catalog = match state
            .extensions
            .cached_catalog(cfms_service::extensions::DEFAULT_CATALOG_URL)?
        {
            Some(catalog) => catalog,
            None => fetch_and_cache_extension_catalog(&state).await?,
        };
        let entry = catalog
            .extensions
            .into_iter()
            .find(|entry| entry.manifest.id == extension_id)
            .ok_or_else(|| "Extension is not available in the official catalog".to_string())?;
        if entry.revoked {
            return Err(entry
                .revocation_reason
                .unwrap_or_else(|| "This extension version has been revoked".into()));
        }
        let client = update_http_client(updater_proxy_url(&state)?.as_ref())?;
        let response = client
            .get(&entry.download_url)
            .send()
            .await
            .map_err(|e| format!("Failed to download extension package: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Extension package download failed: {e}"))?;
        if response.content_length().is_some_and(|length| length > 20 * 1024 * 1024) {
            return Err("Extension package exceeds the 20 MiB download limit".into());
        }
        let package = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to receive extension package: {e}"))?;
        let store = state.extensions.clone();
        tokio::task::spawn_blocking(move || store.install_catalog_package(&package, &entry))
            .await
            .map_err(|e| format!("Extension installation task failed: {e}"))?
    }
}

#[tauri::command]
pub async fn rollback_extension(
    state: tauri::State<'_, AppHandleState>,
    extension_id: String,
) -> Result<cfms_service::extensions::ExtensionInstallation, String> {
    let store = state.extensions.clone();
    tokio::task::spawn_blocking(move || store.rollback(&extension_id))
        .await
        .map_err(|e| format!("Extension rollback task failed: {e}"))?
}

#[tauri::command]
pub async fn uninstall_extension(
    state: tauri::State<'_, AppHandleState>,
    extension_id: String,
) -> Result<(), String> {
    let store = state.extensions.clone();
    tokio::task::spawn_blocking(move || store.uninstall(&extension_id))
        .await
        .map_err(|e| format!("Extension uninstall task failed: {e}"))?
}

#[tauri::command]
pub async fn set_extension_enabled(
    state: tauri::State<'_, AppHandleState>,
    extension_id: String,
    enabled: bool,
    granted_capabilities: Vec<String>,
) -> Result<(), String> {
    let installation = state
        .extensions
        .get_installed(&extension_id)?
        .ok_or_else(|| "Extension is not installed".to_string())?;
    if enabled && let Some(reason) = state.extensions.revocation_reason(
        &installation.manifest.id,
        &installation.manifest.version,
    )? {
        return Err(reason);
    }
    let requested = installation
        .manifest
        .requested_capabilities
        .iter()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    let granted = granted_capabilities
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>();
    if !granted.is_subset(&requested) {
        return Err("Cannot grant capabilities that the extension did not request".into());
    }
    if enabled && granted != requested {
        return Err("All requested capabilities must be approved before enabling the extension".into());
    }

    let (scope, mut preferences) = load_current_user_preferences(&state).await?;
    let existing_settings = preferences
        .extensions
        .get(&extension_id)
        .map(|preference| preference.settings.clone())
        .unwrap_or(serde_json::Value::Null);
    preferences.extensions.insert(
        extension_id.clone(),
        cfms_core::ExtensionPreference {
            enabled,
            install_epoch: installation.install_epoch,
            granted_capabilities: granted.into_iter().collect(),
            settings: existing_settings,
        },
    );
    save_current_user_preferences(&state, scope, preferences).await?;
    tracing::info!(extension_id, enabled, "Extension account activation changed");
    Ok(())
}

#[tauri::command]
pub async fn read_extension_page(
    state: tauri::State<'_, AppHandleState>,
    extension_id: String,
    page: String,
) -> Result<serde_json::Value, String> {
    ensure_extension_enabled(&state, &extension_id, None).await?;
    let store = state.extensions.clone();
    tokio::task::spawn_blocking(move || store.read_page(&extension_id, &page))
        .await
        .map_err(|e| format!("Extension page task failed: {e}"))?
}

#[tauri::command]
pub async fn read_extension_workflow(
    state: tauri::State<'_, AppHandleState>,
    extension_id: String,
    workflow: String,
) -> Result<serde_json::Value, String> {
    ensure_extension_enabled(&state, &extension_id, None).await?;
    let store = state.extensions.clone();
    tokio::task::spawn_blocking(move || store.read_workflow(&extension_id, &workflow))
        .await
        .map_err(|e| format!("Extension workflow task failed: {e}"))?
}

#[tauri::command]
pub async fn execute_extension_host_call(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    extension_id: String,
    capability: String,
    arguments: serde_json::Value,
    user_confirmed: Option<bool>,
) -> Result<serde_json::Value, String> {
    ensure_extension_enabled(&state, &extension_id, Some(&capability)).await?;
    match capability.as_str() {
        "account.summary.read" => Ok(serde_json::json!({
            "username": state.inner.username.read().await.clone(),
            "nickname": state.inner.nickname.read().await.clone(),
            "server": state.inner.server_name.read().await.clone(),
            "permissions": state.inner.permissions.read().await.clone(),
            "groups": state.inner.groups.read().await.clone(),
        })),
        "tasks.read" => serde_json::to_value(state.tasks.list(None))
            .map_err(|e| format!("Failed to serialize tasks: {e}")),
        "files.list" => {
            let folder_id = arguments.get("folderId").and_then(serde_json::Value::as_str).map(str::to_string);
            let listing = fetch_all_listing_pages(
                &state,
                "list_directory",
                serde_json::json!({ "folder_id": folder_id }),
            ).await?;
            serde_json::to_value(listing).map_err(|e| format!("Failed to serialize directory listing: {e}"))
        }
        "files.search" => {
            let query = arguments.get("query").and_then(serde_json::Value::as_str)
                .ok_or_else(|| "files.search requires a query".to_string())?;
            if query.trim().is_empty() { return Err("Search query cannot be empty".into()); }
            server_action_json(&state, "search", serde_json::json!({
                "query": query.trim(), "page_size": 128, "sort_by": "name", "sort_order": "asc",
                "search_documents": true, "search_directories": true
            })).await
        }
        "files.metadata.read" => {
            let document_id = arguments.get("documentId").and_then(serde_json::Value::as_str)
                .ok_or_else(|| "files.metadata.read requires documentId".to_string())?;
            server_action_json(&state, "get_document_info", serde_json::json!({ "document_id": document_id })).await
        }
        "preferences.read" => {
            let (_, preferences) = load_current_user_preferences(&state).await?;
            Ok(preferences.extensions.get(&extension_id)
                .map(|preference| preference.settings.clone())
                .unwrap_or(serde_json::Value::Null))
        }
        "preferences.write" => {
            let value = arguments.get("value").cloned().unwrap_or(serde_json::Value::Null);
            if serde_json::to_vec(&value).map_err(|e| e.to_string())?.len() > 64 * 1024 {
                return Err("Extension preferences cannot exceed 64 KiB".into());
            }
            let (scope, mut preferences) = load_current_user_preferences(&state).await?;
            let preference = preferences.extensions.get_mut(&extension_id)
                .ok_or_else(|| "Extension account state is missing".to_string())?;
            preference.settings = value;
            save_current_user_preferences(&state, scope, preferences).await?;
            Ok(serde_json::json!({ "saved": true }))
        }
        "ui.confirm" => Ok(serde_json::json!({ "requiresUserConfirmation": true, "request": arguments })),
        "ui.notify" => Ok(serde_json::json!({ "notification": arguments })),
        "transfers.download.enqueue" => {
            if user_confirmed != Some(true) {
                return Err("A user confirmation is required before enqueueing a download".into());
            }
            let document_id = arguments.get("documentId").and_then(serde_json::Value::as_str)
                .ok_or_else(|| "transfers.download.enqueue requires documentId".to_string())?;
            let filename = arguments.get("filename").and_then(serde_json::Value::as_str)
                .ok_or_else(|| "transfers.download.enqueue requires filename".to_string())?;
            get_document(
                app_handle,
                state,
                document_id.to_string(),
                filename.to_string(),
                None,
                None,
                None,
                None,
                None,
            ).await
        }
        "events.subscribe" => Ok(serde_json::json!({ "supportedEvents": ["connection.changed", "tasks.changed"] })),
        _ => Err("Unsupported extension host capability".into()),
    }
}

async fn fetch_and_cache_extension_catalog(
    state: &tauri::State<'_, AppHandleState>,
) -> Result<cfms_service::extensions::CatalogDocument, String> {
    if !state.extensions.has_trusted_keys() {
        return Err("No official extension signing public key is configured for this build".into());
    }
    let catalog_url = cfms_service::extensions::DEFAULT_CATALOG_URL;
    let signature_url = format!("{catalog_url}.sig");
    let client = update_http_client(updater_proxy_url(state)?.as_ref())?;
    let catalog_response = client
        .get(catalog_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch extension catalog: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Extension catalog request failed: {e}"))?;
    let etag = catalog_response.headers().get(reqwest::header::ETAG)
        .and_then(|value| value.to_str().ok()).map(str::to_string);
    let catalog = catalog_response.text().await
        .map_err(|e| format!("Failed to read extension catalog: {e}"))?;
    let signature = client
        .get(signature_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch extension catalog signature: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Extension catalog signature request failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Failed to read extension catalog signature: {e}"))?;
    let verified = state.extensions.verify_catalog(catalog.as_bytes(), &signature)?;
    state.extensions.cache_catalog(catalog_url, etag.as_deref(), &catalog, &signature)?;
    Ok(verified)
}

struct CurrentPreferenceScope {
    server_hash: String,
    username: String,
    dek: zeroize::Zeroizing<[u8; cfms_core::constants::KEY_LEN]>,
}

async fn load_current_extension_preferences(
    state: &AppHandleState,
) -> Result<Option<std::collections::BTreeMap<String, cfms_core::ExtensionPreference>>, String> {
    if state.inner.username.read().await.is_none() || state.inner.dek.read().await.is_none() {
        return Ok(None);
    }
    let (_, preferences) = load_current_user_preferences(state).await?;
    Ok(Some(preferences.extensions))
}

async fn load_current_user_preferences(
    state: &AppHandleState,
) -> Result<(CurrentPreferenceScope, cfms_core::UserPreference), String> {
    let username = state.inner.username.read().await.clone().ok_or_else(|| "Not logged in".to_string())?;
    let server = state.inner.server_address.read().await.clone().ok_or_else(|| "No server address".to_string())?;
    let dek = state.inner.dek.read().await.clone().ok_or_else(|| "Preference DEK is unavailable".to_string())?;
    let server_hash = cfms_core::get_server_hash(&server);
    let app_data_dir = state.app_data_dir.clone();
    let load_hash = server_hash.clone();
    let load_username = username.clone();
    let load_dek = dek.clone();
    let preferences = tokio::task::spawn_blocking(move || {
        cfms_service::user_preferences::load(
            &app_data_dir, &load_hash, &load_username, Some(&*load_dek),
        ).map_err(|e| e.to_string())
    }).await.map_err(|e| format!("Preference load task failed: {e}"))??;
    Ok((CurrentPreferenceScope { server_hash, username, dek }, preferences))
}

async fn save_current_user_preferences(
    state: &AppHandleState,
    scope: CurrentPreferenceScope,
    preferences: cfms_core::UserPreference,
) -> Result<(), String> {
    let app_data_dir = state.app_data_dir.clone();
    tokio::task::spawn_blocking(move || {
        cfms_service::user_preferences::save(
            &app_data_dir, &scope.server_hash, &scope.username, Some(&*scope.dek), &preferences,
        ).map_err(|e| e.to_string())
    }).await.map_err(|e| format!("Preference save task failed: {e}"))?
}

async fn ensure_extension_enabled(
    state: &AppHandleState,
    extension_id: &str,
    capability: Option<&str>,
) -> Result<(), String> {
    let installation = state.extensions.get_installed(extension_id)?
        .ok_or_else(|| "Extension is not installed".to_string())?;
    if let Some(reason) = state.extensions.revocation_reason(
        &installation.manifest.id,
        &installation.manifest.version,
    )? {
        return Err(reason);
    }
    let (_, preferences) = load_current_user_preferences(state).await?;
    let preference = preferences.extensions.get(extension_id)
        .ok_or_else(|| "Extension is not enabled for this account".to_string())?;
    if !preference.enabled || preference.install_epoch != installation.install_epoch {
        return Err("Extension is not enabled for this installation".into());
    }
    if installation
        .manifest
        .requested_capabilities
        .iter()
        .any(|capability| !preference.granted_capabilities.contains(capability))
    {
        return Err("Extension permissions changed and require renewed approval".into());
    }
    if let Some(capability) = capability {
        if !installation.manifest.requested_capabilities.iter().any(|item| item == capability)
            || !preference.granted_capabilities.iter().any(|item| item == capability)
        {
            return Err(format!("Extension capability {capability} is not authorized"));
        }
    }
    Ok(())
}
