// Application updater
// ---------------------------------------------------------------------------

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn check_app_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    channel: Option<String>,
) -> Result<Option<AppUpdateMetadata>, String> {
    let channel = UpdateChannel::parse(channel.as_deref());
    check_android_app_update(&app, state, channel).await
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn check_app_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    channel: Option<String>,
) -> Result<Option<AppUpdateMetadata>, String> {
    let channel = UpdateChannel::parse(channel.as_deref());
    let proxy_url = updater_proxy_url(&state)?;
    tracing::info!(
        "Checking for app updates (proxy={})",
        describe_update_proxy(proxy_url.as_ref())
    );
    let client = update_http_client(proxy_url.as_ref())?;
    let Some(release) =
        find_update_release(&client, channel, UpdateAssetKind::DesktopManifest).await?
    else {
        let mut pending = state
            .pending_update
            .lock()
            .map_err(|_| "Updater state is unavailable.".to_string())?;
        *pending = None;
        return Ok(None);
    };
    let Some(manifest_asset) = select_update_manifest_asset(&release, channel) else {
        let mut pending = state
            .pending_update
            .lock()
            .map_err(|_| "Updater state is unavailable.".to_string())?;
        *pending = None;
        return Ok(None);
    };

    let manifest_url = manifest_asset.browser_download_url.clone();
    let release_body = release.body.clone();
    let release_url = release.html_url.clone();

    let endpoint =
        url::Url::parse(&manifest_url).map_err(|e| format!("Invalid update manifest URL: {e}"))?;
    let mut updater_builder = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| format!("Failed to configure updater endpoint: {e}"))?;
    if let Some(proxy_url) = proxy_url {
        updater_builder = updater_builder.proxy(proxy_url);
    }
    let mut update = updater_builder
        .build()
        .map_err(|e| format!("Failed to initialize updater: {e}"))?
        .check()
        .await
        .map_err(|e| format!("Failed to check for updates: {e}"))?;

    if let Some(update) = update.as_mut() {
        reconcile_update_download_url(update, &release)?;
    }

    let metadata = update.as_ref().map(|update| AppUpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: update.date.map(|date| date.to_string()),
        body: first_non_empty_update_body(update.body.as_ref(), release_body.as_ref()),
        channel: channel.as_str().to_string(),
        release_url,
        install_mode: "desktop".to_string(),
    });

    let mut pending = state
        .pending_update
        .lock()
        .map_err(|_| "Updater state is unavailable.".to_string())?;
    *pending = update;

    Ok(metadata)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn install_app_update<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    on_event: Channel<AppUpdateDownloadEvent>,
) -> Result<(), String> {
    install_android_app_update(app, state, on_event).await
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn open_downloaded_file<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    task_id: String,
) -> Result<(), String> {
    let path = prepare_downloaded_file_for_open(&state, &task_id)?;

    let opener = app.state::<AndroidFileOpener<R>>();
    opener
        .handle
        .run_mobile_plugin::<()>("openFile", serde_json::json!({ "path": path }))
        .map_err(|e| format!("Failed to open downloaded file: {e}"))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn open_downloaded_file<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    task_id: String,
) -> Result<(), String> {
    let path = prepare_downloaded_file_for_open(&state, &task_id)?;

    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(path, None::<&str>)
        .map_err(|e| format!("Failed to open downloaded file: {e}"))
}

fn prepare_downloaded_file_for_open(
    state: &AppHandleState,
    task_id: &str,
) -> Result<String, String> {
    let task = state
        .tasks
        .get(task_id)
        .ok_or_else(|| "Download task was not found.".to_string())?;
    let metadata = match std::fs::metadata(&task.file_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return mark_download_file_deleted(
                state,
                task_id,
                format!("Downloaded file was not found: {error}"),
            );
        }
        Err(error) => return Err(format!("Failed to inspect downloaded file: {error}")),
    };
    if !metadata.is_file() {
        return mark_download_file_deleted(
            state,
            task_id,
            "Downloaded path is not a file.".to_string(),
        );
    }
    Ok(task.file_path)
}

fn mark_download_file_deleted(
    state: &AppHandleState,
    task_id: &str,
    error: String,
) -> Result<String, String> {
    state
        .tasks
        .mark_file_deleted(task_id)
        .map_err(|e| format!("Failed to update download task: {e}"))?;
    if let Some(task) = state.tasks.get(task_id) {
        let _ = state
            .inner
            .event_tx
            .send(ServiceEvent::DownloadTaskUpdated { task });
    }
    Err(error)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn install_app_update<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    on_event: Channel<AppUpdateDownloadEvent>,
) -> Result<(), String> {
    let _ = &app;
    let update_proxy = updater_proxy_url(&state)?;
    let update = {
        let mut pending = state
            .pending_update
            .lock()
            .map_err(|_| "Updater state is unavailable.".to_string())?;
        pending.take()
    };

    let Some(mut update) = update else {
        return Err("No pending update is available. Check for updates first.".to_string());
    };

    let mut started = false;
    let download_url = update.download_url.clone();
    update.proxy = update_proxy;
    tracing::info!(
        "Installing app update (proxy={})",
        describe_update_proxy(update.proxy.as_ref())
    );
    update
        .download_and_install(
            |chunk_length, content_length| {
                if !started {
                    let _ = on_event.send(AppUpdateDownloadEvent::Started { content_length });
                    started = true;
                }
                let _ = on_event.send(AppUpdateDownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(AppUpdateDownloadEvent::Finished);
            },
        )
        .await
        .map_err(|e| format!("Failed to install update from {download_url}: {e}"))
}

#[cfg(target_os = "android")]
async fn check_android_app_update(
    app: &tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    channel: UpdateChannel,
) -> Result<Option<AppUpdateMetadata>, String> {
    let architecture = AndroidApkArchitecture::from_rust_arch(std::env::consts::ARCH)?;
    let proxy_url = updater_proxy_url(&state)?;
    tracing::info!(
        "Checking for Android app updates (architecture={}, proxy={})",
        architecture.as_str(),
        describe_update_proxy(proxy_url.as_ref())
    );
    let client = update_http_client(proxy_url.as_ref())?;
    let release = find_update_release(
        &client,
        channel,
        UpdateAssetKind::AndroidApk { architecture },
    )
    .await?;
    let Some(release) = release else {
        clear_mobile_pending_update(&state)?;
        return Ok(None);
    };

    let current_version = app.package_info().version.to_string();
    if !is_release_newer(&release.tag_name, &current_version) {
        clear_mobile_pending_update(&state)?;
        return Ok(None);
    }

    let Some(asset) = select_android_apk_asset(&release, architecture) else {
        clear_mobile_pending_update(&state)?;
        return Ok(None);
    };
    tracing::info!(
        "Selected Android update asset {} for architecture {}",
        asset.name,
        architecture.as_str()
    );

    let digest = asset.digest.as_deref().and_then(parse_asset_digest);
    let file_name = sanitize_update_file_name(&asset.name, &release.tag_name);

    let update = MobileAppUpdate {
        download_url: asset.browser_download_url.clone(),
        file_name,
        digest,
    };

    let metadata = AppUpdateMetadata {
        current_version,
        version: release.tag_name,
        date: release.published_at,
        body: release.body,
        channel: channel.as_str().to_string(),
        release_url: release.html_url,
        install_mode: "android-apk".to_string(),
    };

    let mut pending = state
        .pending_mobile_update
        .lock()
        .map_err(|_| "Mobile updater state is unavailable.".to_string())?;
    *pending = Some(update);

    Ok(Some(metadata))
}

#[cfg(target_os = "android")]
async fn install_android_app_update<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    on_event: Channel<AppUpdateDownloadEvent>,
) -> Result<(), String> {
    let proxy_url = updater_proxy_url(&state)?;
    tracing::info!(
        "Installing Android app update (proxy={})",
        describe_update_proxy(proxy_url.as_ref())
    );
    let client = update_http_client(proxy_url.as_ref())?;
    let update = {
        let pending = state
            .pending_mobile_update
            .lock()
            .map_err(|_| "Mobile updater state is unavailable.".to_string())?;
        pending.clone()
    };

    let Some(update) = update else {
        return Err("No pending Android update is available. Check for updates first.".to_string());
    };

    let update_dir = android_update_cache_dir(&app)?;
    tokio::fs::create_dir_all(&update_dir)
        .await
        .map_err(|e| format!("Failed to create update directory: {e}"))?;
    let target_path = update_dir.join(&update.file_name);

    download_mobile_update(&client, &update, &target_path, &on_event).await?;

    let installer = app.state::<AndroidApkInstaller<R>>();
    installer
        .handle
        .run_mobile_plugin::<()>(
            "installApk",
            serde_json::json!({ "path": target_path.to_string_lossy() }),
        )
        .map_err(|e| format!("Failed to open Android package installer: {e}"))?;

    let mut pending = state
        .pending_mobile_update
        .lock()
        .map_err(|_| "Mobile updater state is unavailable.".to_string())?;
    *pending = None;

    Ok(())
}

#[cfg(target_os = "android")]
fn android_update_cache_dir<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<std::path::PathBuf, String> {
    // Keep APK handoff files under Android cache; file_paths.xml exposes
    // this via <cache-path>, while app_data_dir may live outside FileProvider.
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to resolve update cache directory: {e}"))?
        .join("updates"))
}

#[cfg(target_os = "android")]
fn clear_mobile_pending_update(state: &tauri::State<'_, AppHandleState>) -> Result<(), String> {
    let mut pending = state
        .pending_mobile_update
        .lock()
        .map_err(|_| "Mobile updater state is unavailable.".to_string())?;
    *pending = None;
    Ok(())
}

#[cfg(target_os = "android")]
async fn download_mobile_update(
    client: &reqwest::Client,
    update: &MobileAppUpdate,
    target_path: &std::path::Path,
    on_event: &Channel<AppUpdateDownloadEvent>,
) -> Result<(), String> {
    if is_cached_mobile_update_valid(target_path, update).await? {
        let size = tokio::fs::metadata(target_path)
            .await
            .ok()
            .map(|metadata| metadata.len());
        let _ = on_event.send(AppUpdateDownloadEvent::Started {
            content_length: size,
        });
        if let Some(size) = size {
            let _ = on_event.send(AppUpdateDownloadEvent::Progress {
                chunk_length: size as usize,
            });
        }
        let _ = on_event.send(AppUpdateDownloadEvent::Finished);
        return Ok(());
    }

    remove_file_if_exists(target_path).await?;

    let mut last_error = None;
    for attempt in 1..=2 {
        match download_mobile_update_once(client, update, target_path, on_event).await {
            Ok(()) => return Ok(()),
            Err(err) if is_update_digest_error(&err) && attempt < 2 => {
                tracing::warn!(
                    "Downloaded Android update failed SHA-256 verification; retrying download"
                );
                let _ = remove_file_if_exists(&target_path.with_extension("apk.part")).await;
                let _ = remove_file_if_exists(target_path).await;
                last_error = Some(err);
            }
            Err(err) => return Err(err),
        }
    }

    Err(last_error.unwrap_or_else(|| "Failed to download Android update.".to_string()))
}

#[cfg(target_os = "android")]
async fn download_mobile_update_once(
    client: &reqwest::Client,
    update: &MobileAppUpdate,
    target_path: &std::path::Path,
    on_event: &Channel<AppUpdateDownloadEvent>,
) -> Result<(), String> {
    let mut response = client
        .get(&update.download_url)
        .header(reqwest::header::USER_AGENT, UPDATE_USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Failed to download Android update: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Android update download failed: {e}"))?;

    let content_length = response.content_length();
    let _ = on_event.send(AppUpdateDownloadEvent::Started { content_length });

    let tmp_path = target_path.with_extension("apk.part");
    let mut file = std::fs::File::create(&tmp_path)
        .map_err(|e| format!("Failed to create temporary update file: {e}"))?;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Failed while downloading Android update: {e}"))?
    {
        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write Android update file: {e}"))?;
        let _ = on_event.send(AppUpdateDownloadEvent::Progress {
            chunk_length: chunk.len(),
        });
    }

    file.flush()
        .map_err(|e| format!("Failed to flush Android update file: {e}"))?;
    drop(file);

    if let Some(digest) = &update.digest {
        if let Err(err) = verify_update_digest(&tmp_path, digest).await {
            let _ = remove_file_if_exists(&tmp_path).await;
            return Err(err);
        }
    }

    tokio::fs::rename(&tmp_path, target_path)
        .await
        .map_err(|e| format!("Failed to finalize Android update file: {e}"))?;

    let _ = on_event.send(AppUpdateDownloadEvent::Finished);
    Ok(())
}

#[cfg(target_os = "android")]
async fn is_cached_mobile_update_valid(
    target_path: &std::path::Path,
    update: &MobileAppUpdate,
) -> Result<bool, String> {
    let Ok(metadata) = tokio::fs::metadata(target_path).await else {
        return Ok(false);
    };
    if metadata.len() == 0 {
        return Ok(false);
    }

    let Some(digest) = &update.digest else {
        return Ok(false);
    };

    verify_update_digest(target_path, digest)
        .await
        .map(|_| true)
        .or_else(|err| {
            if is_update_digest_error(&err) {
                Ok(false)
            } else {
                Err(err)
            }
        })
}

#[cfg(target_os = "android")]
async fn verify_update_digest(path: &std::path::Path, digest: &AssetDigest) -> Result<(), String> {
    match digest.kind {
        AssetDigestKind::Sha256 => {
            let expected = digest.value.to_ascii_lowercase();
            let path = path.to_path_buf();
            let actual = tokio::task::spawn_blocking(move || {
                cfms_transfer::compute_sha256(&path).map(hex::encode)
            })
            .await
            .map_err(|e| format!("SHA-256 verification task failed: {e}"))?
            .map_err(|e| format!("Failed to calculate update SHA-256: {e}"))?;

            if actual == expected {
                Ok(())
            } else {
                Err("Downloaded update failed SHA-256 verification.".to_string())
            }
        }
    }
}

#[cfg(target_os = "android")]
fn is_update_digest_error(error: &str) -> bool {
    error.contains("SHA-256 verification")
}

#[cfg(target_os = "android")]
async fn remove_file_if_exists(path: &std::path::Path) -> Result<(), String> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("Failed to remove stale update file: {err}")),
    }
}

#[cfg(target_os = "android")]
fn parse_asset_digest(raw: &str) -> Option<AssetDigest> {
    let (kind, value) = raw.split_once(':')?;
    let kind = match kind.trim().to_ascii_lowercase().as_str() {
        "sha256" => AssetDigestKind::Sha256,
        _ => return None,
    };
    let value = value.trim().to_ascii_lowercase();
    if value.is_empty() {
        return None;
    }
    Some(AssetDigest { kind, value })
}

#[cfg(target_os = "android")]
fn sanitize_update_file_name(raw: &str, version: &str) -> String {
    let fallback = format!("cfms-client-{version}.apk");
    let source = if raw.trim().is_empty() {
        &fallback
    } else {
        raw
    };
    let mut sanitized = source
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' => ch,
            _ => '_',
        })
        .collect::<String>();

    if !sanitized.to_ascii_lowercase().ends_with(".apk") {
        sanitized.push_str(".apk");
    }

    sanitized
}

#[derive(Debug, Clone, Copy)]
enum UpdateAssetKind {
    #[cfg(not(target_os = "android"))]
    DesktopManifest,
    #[cfg(target_os = "android")]
    AndroidApk {
        architecture: AndroidApkArchitecture,
    },
}

#[cfg(any(target_os = "android", test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AndroidApkArchitecture {
    Arm64,
    X86_64,
}

#[cfg(any(target_os = "android", test))]
impl AndroidApkArchitecture {
    fn from_rust_arch(value: &str) -> Result<Self, String> {
        match value {
            "aarch64" => Ok(Self::Arm64),
            "x86_64" => Ok(Self::X86_64),
            unsupported => Err(format!(
                "Android updates are not available for unsupported architecture {unsupported}."
            )),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Arm64 => "arm64-v8a",
            Self::X86_64 => "x86_64",
        }
    }

    fn release_asset_name(self) -> &'static str {
        match self {
            Self::Arm64 => "app-arm64-release.apk",
            Self::X86_64 => "app-x86_64-release.apk",
        }
    }
}

#[cfg(any(target_os = "android", test))]
const ANDROID_UNIVERSAL_APK_ASSET_NAME: &str = "app-universal-release.apk";

async fn find_update_release(
    client: &reqwest::Client,
    channel: UpdateChannel,
    asset_kind: UpdateAssetKind,
) -> Result<Option<GithubReleaseDto>, String> {
    let releases = client
        .get(UPDATE_RELEASES_API)
        .header(reqwest::header::USER_AGENT, UPDATE_USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch release list: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub release request failed: {e}"))?
        .json::<Vec<GithubReleaseDto>>()
        .await
        .map_err(|e| format!("Failed to parse release list: {e}"))?;

    let mut candidates = releases
        .into_iter()
        .filter(|release| select_update_asset(release, channel, asset_kind).is_some())
        .filter_map(|release| {
            channel_match_priority(channel, release_channel(&release))
                .map(|priority| (priority, release))
        })
        .collect::<Vec<_>>();

    candidates.sort_by(|(left_priority, left), (right_priority, right)| {
        left_priority
            .cmp(right_priority)
            .then_with(|| compare_release_version(right, left))
            .then_with(|| right.published_at.cmp(&left.published_at))
    });

    Ok(candidates.into_iter().map(|(_, release)| release).next())
}

fn updater_proxy_url(state: &tauri::State<'_, AppHandleState>) -> Result<Option<url::Url>, String> {
    let settings = ConnectionSettingsDto::load(&state.settings);
    settings.updater_proxy_url()
}

fn update_http_client(proxy_url: Option<&url::Url>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().user_agent(UPDATE_USER_AGENT);
    if let Some(proxy_url) = proxy_url {
        let proxy = reqwest::Proxy::all(proxy_url.as_str())
            .map_err(|e| format!("Failed to configure updater proxy: {e}"))?;
        builder = builder.proxy(proxy);
    }
    builder
        .build()
        .map_err(|e| format!("Failed to initialize updater HTTP client: {e}"))
}

fn describe_update_proxy(proxy_url: Option<&url::Url>) -> String {
    let Some(proxy_url) = proxy_url else {
        return "none".to_string();
    };

    let host = proxy_url.host_str().unwrap_or("unknown");
    match proxy_url.port() {
        Some(port) => format!("{}://{}:{}", proxy_url.scheme(), host, port),
        None => format!("{}://{}", proxy_url.scheme(), host),
    }
}

fn select_update_asset(
    release: &GithubReleaseDto,
    _channel: UpdateChannel,
    kind: UpdateAssetKind,
) -> Option<&GithubAssetDto> {
    match kind {
        #[cfg(not(target_os = "android"))]
        UpdateAssetKind::DesktopManifest => select_update_manifest_asset(release, _channel),
        #[cfg(target_os = "android")]
        UpdateAssetKind::AndroidApk { architecture } => {
            select_android_apk_asset(release, architecture)
        }
    }
}

#[cfg(not(target_os = "android"))]
fn select_update_manifest_asset(
    release: &GithubReleaseDto,
    channel: UpdateChannel,
) -> Option<&GithubAssetDto> {
    let channel_manifest = format!("latest-{}.json", channel.as_str());
    release
        .assets
        .iter()
        .find(|asset| asset.name == channel_manifest)
        .or_else(|| {
            release
                .assets
                .iter()
                .find(|asset| asset.name == "latest.json")
        })
}

#[cfg(not(target_os = "android"))]
fn first_non_empty_update_body(
    manifest_body: Option<&String>,
    release_body: Option<&String>,
) -> Option<String> {
    manifest_body
        .filter(|body| !body.trim().is_empty())
        .or_else(|| release_body.filter(|body| !body.trim().is_empty()))
        .cloned()
}

#[cfg(not(target_os = "android"))]
fn reconcile_update_download_url(
    update: &mut tauri_plugin_updater::Update,
    release: &GithubReleaseDto,
) -> Result<(), String> {
    let Some(requested_file_name) = update_download_file_name(&update.download_url) else {
        return Ok(());
    };

    let Some(asset) = release.assets.iter().find(|asset| {
        asset.name == requested_file_name || asset.label.as_deref() == Some(&requested_file_name)
    }) else {
        return Ok(());
    };

    if asset.browser_download_url == update.download_url.as_str() {
        return Ok(());
    }

    update.download_url = url::Url::parse(&asset.browser_download_url)
        .map_err(|e| format!("Invalid update asset URL: {e}"))?;
    Ok(())
}

#[cfg(not(target_os = "android"))]
fn update_download_file_name(download_url: &url::Url) -> Option<String> {
    download_url
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .map(|segment| segment.replace("%20", " "))
}

#[cfg(any(target_os = "android", test))]
fn select_android_apk_asset(
    release: &GithubReleaseDto,
    architecture: AndroidApkArchitecture,
) -> Option<&GithubAssetDto> {
    release
        .assets
        .iter()
        .find(|asset| {
            asset
                .name
                .eq_ignore_ascii_case(architecture.release_asset_name())
        })
        .or_else(|| {
            release.assets.iter().find(|asset| {
                asset
                    .name
                    .eq_ignore_ascii_case(ANDROID_UNIVERSAL_APK_ASSET_NAME)
            })
        })
}

fn release_channel(release: &GithubReleaseDto) -> UpdateChannel {
    if let Some(body) = release.body.as_deref() {
        let lower = body.to_ascii_lowercase();
        if lower.contains("<!-- channel: alpha -->") {
            return UpdateChannel::Alpha;
        }
        if lower.contains("<!-- channel: beta -->") {
            return UpdateChannel::Beta;
        }
        if lower.contains("<!-- channel: stable -->") {
            return UpdateChannel::Stable;
        }
    }

    if release.prerelease {
        UpdateChannel::Alpha
    } else {
        UpdateChannel::Stable
    }
}

fn channel_match_priority(requested: UpdateChannel, actual: UpdateChannel) -> Option<u8> {
    match (requested, actual) {
        (UpdateChannel::Stable, UpdateChannel::Stable) => Some(0),
        (UpdateChannel::Beta, UpdateChannel::Beta) => Some(0),
        (UpdateChannel::Beta, UpdateChannel::Stable) => Some(1),
        (UpdateChannel::Alpha, UpdateChannel::Alpha) => Some(0),
        (UpdateChannel::Alpha, UpdateChannel::Beta) => Some(1),
        (UpdateChannel::Alpha, UpdateChannel::Stable) => Some(2),
        _ => None,
    }
}

fn compare_release_version(
    left: &GithubReleaseDto,
    right: &GithubReleaseDto,
) -> std::cmp::Ordering {
    let left_version = parse_release_version(&left.tag_name);
    let right_version = parse_release_version(&right.tag_name);
    left_version.cmp(&right_version)
}

fn parse_release_version(tag: &str) -> Option<semver::Version> {
    semver::Version::parse(tag.trim_start_matches('v')).ok()
}

#[cfg(target_os = "android")]
fn is_release_newer(release_tag: &str, current_version: &str) -> bool {
    let Some(release_version) = parse_release_version(release_tag) else {
        return false;
    };
    let Some(current_version) = parse_release_version(current_version) else {
        return true;
    };
    release_version > current_version
}

#[cfg(test)]
mod android_apk_selection_tests {
    use super::*;

    fn asset(name: &str) -> GithubAssetDto {
        GithubAssetDto {
            name: name.to_string(),
            #[cfg(not(target_os = "android"))]
            label: None,
            browser_download_url: format!("https://example.invalid/{name}"),
            #[cfg(target_os = "android")]
            digest: None,
        }
    }

    fn release(asset_names: &[&str]) -> GithubReleaseDto {
        GithubReleaseDto {
            tag_name: "v1.2.3".to_string(),
            body: None,
            prerelease: false,
            html_url: "https://example.invalid/release".to_string(),
            published_at: None,
            assets: asset_names.iter().map(|name| asset(name)).collect(),
        }
    }

    #[test]
    fn arm64_asset_wins_over_universal_regardless_of_order() {
        for asset_names in [
            ["app-universal-release.apk", "app-arm64-release.apk"],
            ["app-arm64-release.apk", "app-universal-release.apk"],
        ] {
            let release = release(&asset_names);
            let selected = select_android_apk_asset(&release, AndroidApkArchitecture::Arm64);
            assert_eq!(
                selected.map(|asset| asset.name.as_str()),
                Some("app-arm64-release.apk")
            );
        }
    }

    #[test]
    fn x86_64_asset_wins_over_universal() {
        let release = release(&[
            "app-arm64-release.apk",
            "app-universal-release.apk",
            "app-x86_64-release.apk",
        ]);
        let selected = select_android_apk_asset(&release, AndroidApkArchitecture::X86_64);
        assert_eq!(
            selected.map(|asset| asset.name.as_str()),
            Some("app-x86_64-release.apk")
        );
    }

    #[test]
    fn universal_asset_is_used_when_target_asset_is_missing() {
        let release = release(&["app-universal-release.apk"]);
        let selected = select_android_apk_asset(&release, AndroidApkArchitecture::Arm64);
        assert_eq!(
            selected.map(|asset| asset.name.as_str()),
            Some("app-universal-release.apk")
        );
    }

    #[test]
    fn incompatible_debug_and_unknown_assets_are_rejected() {
        let release = release(&[
            "app-x86_64-release.apk",
            "app-arm64-debug.apk",
            "cfms-client-arm64.apk",
            "app-universal-release.aab",
        ]);
        assert!(
            select_android_apk_asset(&release, AndroidApkArchitecture::Arm64).is_none()
        );
    }

    #[test]
    fn rust_architecture_names_map_to_release_contract() {
        let arm64 = AndroidApkArchitecture::from_rust_arch("aarch64").unwrap();
        let x86_64 = AndroidApkArchitecture::from_rust_arch("x86_64").unwrap();
        assert_eq!(arm64, AndroidApkArchitecture::Arm64);
        assert_eq!(arm64.as_str(), "arm64-v8a");
        assert_eq!(x86_64, AndroidApkArchitecture::X86_64);
        assert_eq!(x86_64.as_str(), "x86_64");
        assert!(AndroidApkArchitecture::from_rust_arch("arm").is_err());
    }
}

// ---------------------------------------------------------------------------
