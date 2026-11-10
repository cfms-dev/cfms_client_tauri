use super::settings::CA_CERT_API_URL;
use super::updates::UPDATE_CHECK_TIMEOUT;
use super::updates::UPDATE_RELEASES_API;
use super::updates::UPDATE_USER_AGENT;
#[cfg(test)]
use super::updates::update_api_http_client;
#[cfg(test)]
use super::updates::update_http_client;
#[cfg(target_os = "android")]
use std::io::Write;

// Authenticated requests are limited to these two public GitHub REST endpoints.
// Asset and certificate downloads use separate clients without this header.
#[derive(Clone, Copy)]
pub(super) enum GithubApiEndpoint {
    UpdateReleases,
    CaCertificates,
}

impl GithubApiEndpoint {
    const fn url(self) -> &'static str {
        match self {
            Self::UpdateReleases => UPDATE_RELEASES_API,
            Self::CaCertificates => CA_CERT_API_URL,
        }
    }
}

static GITHUB_API_COOLDOWN: std::sync::OnceLock<
    std::sync::Mutex<Option<(u64, std::time::Instant)>>,
> = std::sync::OnceLock::new();

fn github_api_cooldown() -> &'static std::sync::Mutex<Option<(u64, std::time::Instant)>> {
    GITHUB_API_COOLDOWN.get_or_init(|| std::sync::Mutex::new(None))
}

#[cfg(test)]
fn clear_github_api_cooldown() {
    if let Ok(mut deadline) = github_api_cooldown().lock() {
        *deadline = None;
    }
}

fn github_api_cooldown_remaining(generation: u64) -> Option<std::time::Duration> {
    github_api_cooldown().lock().ok().and_then(|deadline| {
        deadline.as_ref().and_then(|(stored_generation, deadline)| {
            (*stored_generation == generation)
                .then(|| deadline.checked_duration_since(std::time::Instant::now()))
                .flatten()
        })
    })
}

fn start_github_api_cooldown(generation: u64, wait: std::time::Duration) {
    if let Ok(mut deadline) = github_api_cooldown().lock() {
        let Some(next_deadline) = std::time::Instant::now().checked_add(wait) else {
            return;
        };
        match deadline.as_mut() {
            Some((stored_generation, _)) if *stored_generation > generation => {}
            Some((stored_generation, stored_deadline)) if *stored_generation == generation => {
                *stored_deadline = (*stored_deadline).max(next_deadline);
            }
            _ => *deadline = Some((generation, next_deadline)),
        }
    }
}

fn github_wait_seconds(wait: std::time::Duration) -> u64 {
    wait.as_secs()
        .saturating_add(u64::from(wait.subsec_nanos() > 0))
        .max(1)
}

fn github_api_request(
    client: &reqwest::Client,
    url: &str,
    token: Option<&str>,
) -> reqwest::RequestBuilder {
    let request = client
        .get(url)
        .header(reqwest::header::USER_AGENT, UPDATE_USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .timeout(UPDATE_CHECK_TIMEOUT);
    match token {
        Some(token) => request.bearer_auth(token),
        None => request,
    }
}

enum GithubApiAttempt {
    Success(reqwest::Response),
    AuthenticationRejected,
}

enum GithubApiResponseError {
    RateLimited(std::time::Duration),
    AuthenticationRejected,
    Http(reqwest::StatusCode),
}

fn github_api_response_error(
    status: reqwest::StatusCode,
    headers: &reqwest::header::HeaderMap,
    body: &str,
) -> GithubApiResponseError {
    let body = body.to_ascii_lowercase();
    let rate_limited = status == reqwest::StatusCode::TOO_MANY_REQUESTS
        || (status == reqwest::StatusCode::FORBIDDEN
            && (headers.contains_key(reqwest::header::RETRY_AFTER)
                || headers
                    .get("x-ratelimit-remaining")
                    .is_some_and(|value| value == "0")
                || body.contains("rate limit")
                || body.contains("abuse detection")
                || body.contains("too many requests")));

    if rate_limited {
        let wait = headers
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|seconds| *seconds > 0)
            .map(std::time::Duration::from_secs)
            .or_else(|| {
                (headers.get("x-ratelimit-remaining")? == "0").then_some(())?;
                let reset = headers
                    .get("x-ratelimit-reset")?
                    .to_str()
                    .ok()?
                    .parse::<u64>()
                    .ok()?;
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .ok()?
                    .as_secs();
                (reset > now).then(|| std::time::Duration::from_secs(reset - now))
            })
            .unwrap_or_else(|| std::time::Duration::from_secs(60));
        return GithubApiResponseError::RateLimited(wait);
    }

    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        GithubApiResponseError::AuthenticationRejected
    } else {
        GithubApiResponseError::Http(status)
    }
}

async fn github_api_get_once(
    client: &reqwest::Client,
    url: &str,
    token: Option<&str>,
    generation: u64,
) -> Result<GithubApiAttempt, String> {
    let response = github_api_request(client, url, token)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "GitHub API request timed out.".to_string()
            } else {
                "GitHub API request failed.".to_string()
            }
        })?;
    if response.status().is_success() {
        return Ok(GithubApiAttempt::Success(response));
    }

    let status = response.status();
    let headers = response.headers().clone();
    let body = if status == reqwest::StatusCode::FORBIDDEN {
        response.text().await.unwrap_or_default()
    } else {
        String::new()
    };
    match github_api_response_error(status, &headers, &body) {
        GithubApiResponseError::RateLimited(wait) => {
            start_github_api_cooldown(generation, wait);
            let effective_wait = github_api_cooldown_remaining(generation).unwrap_or(wait);
            Err(format!(
                "GitHub API rate limit reached. Retry in at least {} seconds.",
                github_wait_seconds(effective_wait)
            ))
        }
        GithubApiResponseError::AuthenticationRejected if token.is_some() => {
            Ok(GithubApiAttempt::AuthenticationRejected)
        }
        GithubApiResponseError::AuthenticationRejected => {
            Err(format!("GitHub API request failed (HTTP {status})."))
        }
        GithubApiResponseError::Http(status) => {
            Err(format!("GitHub API request failed (HTTP {status})."))
        }
    }
}

async fn github_api_get_with_token(
    client: &reqwest::Client,
    url: &str,
    token: Option<&str>,
    generation: u64,
    on_invalid_token: impl FnOnce(),
) -> Result<reqwest::Response, String> {
    if let Some(wait) = github_api_cooldown_remaining(generation) {
        return Err(format!(
            "GitHub API rate limit reached. Retry in at least {} seconds.",
            github_wait_seconds(wait)
        ));
    }

    match github_api_get_once(client, url, token, generation).await? {
        GithubApiAttempt::Success(response) => Ok(response),
        GithubApiAttempt::AuthenticationRejected => {
            // A recognized authentication failure disables this credential
            // for the current run, even if the public fallback also fails.
            on_invalid_token();
            tracing::warn!("GitHub API token was rejected; retrying public request anonymously");
            match github_api_get_once(client, url, None, generation).await? {
                GithubApiAttempt::Success(response) => Ok(response),
                GithubApiAttempt::AuthenticationRejected => {
                    Err("GitHub API rejected the anonymous request.".to_string())
                }
            }
        }
    }
}

pub(super) async fn github_api_get(
    client: &reqwest::Client,
    endpoint: GithubApiEndpoint,
    credentials: &crate::github_credentials::GithubCredentialState,
) -> Result<reqwest::Response, String> {
    let token = credentials.token_for_request().await;
    let generation = token.as_ref().map(|(_, generation)| *generation);
    let request_generation = generation.unwrap_or_else(|| credentials.generation());
    github_api_get_with_token(
        client,
        endpoint.url(),
        token.as_ref().map(|(token, _)| token.as_str()),
        request_generation,
        || {
            if let Some(generation) = generation {
                credentials.mark_needs_attention_if_generation(generation);
            }
        },
    )
    .await
}

#[cfg(test)]
mod github_api_tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    static TEST_COOLDOWN_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    async fn serve_responses(responses: &[&str]) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/test", listener.local_addr().unwrap());
        let responses = responses
            .iter()
            .map(|response| response.to_string())
            .collect::<Vec<_>>();
        let server = tokio::spawn(async move {
            let mut requests = Vec::new();
            for response in responses {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut received = Vec::new();
                let mut buffer = [0_u8; 1024];
                loop {
                    let count = stream.read(&mut buffer).await.unwrap();
                    if count == 0 {
                        break;
                    }
                    received.extend_from_slice(&buffer[..count]);
                    if received.windows(4).any(|window| window == b"\r\n\r\n") {
                        break;
                    }
                }
                requests.push(String::from_utf8(received).unwrap());
                stream.write_all(response.as_bytes()).await.unwrap();
            }
            requests
        });
        (url, server)
    }

    #[test]
    fn bearer_auth_is_scoped_to_api_requests() {
        let client = update_api_http_client(None).unwrap();
        for endpoint in [
            GithubApiEndpoint::UpdateReleases,
            GithubApiEndpoint::CaCertificates,
        ] {
            let request = github_api_request(&client, endpoint.url(), Some("private-token"))
                .build()
                .unwrap();
            assert_eq!(request.url().host_str(), Some("api.github.com"));
            assert_eq!(
                request
                    .headers()
                    .get(reqwest::header::AUTHORIZATION)
                    .unwrap(),
                "Bearer private-token"
            );
        }

        // The ordinary download client has no default authorization header.
        let download_client = update_http_client(None).unwrap();
        for download_url in [
            "https://github.com/cfms-dev/cfms_client_tauri/releases/download/v1/app.apk",
            "https://raw.githubusercontent.com/cfms-dev/ca/main/cert.pem",
        ] {
            let request = download_client.get(download_url).build().unwrap();
            assert!(
                request
                    .headers()
                    .get(reqwest::header::AUTHORIZATION)
                    .is_none()
            );
        }
    }

    #[test]
    fn rate_limit_responses_do_not_reject_the_token() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("x-ratelimit-remaining", "0".parse().unwrap());
        headers.insert(reqwest::header::RETRY_AFTER, "42".parse().unwrap());
        assert!(matches!(
            github_api_response_error(reqwest::StatusCode::FORBIDDEN, &headers, ""),
            GithubApiResponseError::RateLimited(wait) if wait.as_secs() == 42
        ));
        assert!(matches!(
            github_api_response_error(reqwest::StatusCode::TOO_MANY_REQUESTS, &reqwest::header::HeaderMap::new(), ""),
            GithubApiResponseError::RateLimited(wait) if wait.as_secs() == 60
        ));
        assert!(matches!(
            github_api_response_error(
                reqwest::StatusCode::FORBIDDEN,
                &reqwest::header::HeaderMap::new(),
                "secondary rate limit"
            ),
            GithubApiResponseError::RateLimited(_)
        ));
        assert!(matches!(
            github_api_response_error(
                reqwest::StatusCode::UNAUTHORIZED,
                &reqwest::header::HeaderMap::new(),
                ""
            ),
            GithubApiResponseError::AuthenticationRejected
        ));
        assert!(matches!(
            github_api_response_error(
                reqwest::StatusCode::FORBIDDEN,
                &reqwest::header::HeaderMap::new(),
                "Resource not accessible by personal access token"
            ),
            GithubApiResponseError::AuthenticationRejected
        ));
    }

    #[tokio::test]
    async fn old_credential_cooldown_does_not_block_replacement() {
        let _guard = TEST_COOLDOWN_LOCK.lock().await;
        clear_github_api_cooldown();
        start_github_api_cooldown(3, std::time::Duration::from_secs(42));
        assert!(github_api_cooldown_remaining(3).is_some());
        assert!(github_api_cooldown_remaining(4).is_none());
        clear_github_api_cooldown();
    }

    #[tokio::test]
    async fn shorter_later_rate_limit_does_not_shorten_wait() {
        let _guard = TEST_COOLDOWN_LOCK.lock().await;
        clear_github_api_cooldown();
        start_github_api_cooldown(7, std::time::Duration::from_secs(120));
        start_github_api_cooldown(7, std::time::Duration::from_secs(5));
        assert!(github_api_cooldown_remaining(7).unwrap().as_secs() >= 119);
        start_github_api_cooldown(6, std::time::Duration::from_secs(300));
        assert!(github_api_cooldown_remaining(7).unwrap().as_secs() >= 119);
        clear_github_api_cooldown();
    }

    #[tokio::test]
    async fn rejected_token_retries_anonymously_once_and_marks_it() {
        let _guard = TEST_COOLDOWN_LOCK.lock().await;
        clear_github_api_cooldown();
        let (url, server) = serve_responses(&[
            "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n[]",
        ])
        .await;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let marked = std::cell::Cell::new(false);
        let response =
            github_api_get_with_token(&client, &url, Some("private-token"), 0, || marked.set(true))
                .await
                .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        assert!(marked.get());
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 2);
        assert!(
            requests[0]
                .to_ascii_lowercase()
                .contains("authorization: bearer private-token")
        );
        assert!(!requests[1].to_ascii_lowercase().contains("authorization:"));
    }

    #[tokio::test]
    async fn rejected_token_stays_disabled_when_anonymous_retry_fails() {
        let _guard = TEST_COOLDOWN_LOCK.lock().await;
        clear_github_api_cooldown();
        let (url, server) = serve_responses(&[
            "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        ])
        .await;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let marked = std::cell::Cell::new(false);
        let error =
            github_api_get_with_token(&client, &url, Some("private-token"), 0, || marked.set(true))
                .await
                .err()
                .unwrap();
        assert!(marked.get());
        assert!(error.contains("500"));
        assert!(!error.contains("private-token"));
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 2);
        assert!(!requests[1].to_ascii_lowercase().contains("authorization:"));
    }

    #[tokio::test]
    async fn rate_limit_stops_without_anonymous_retry() {
        let _guard = TEST_COOLDOWN_LOCK.lock().await;
        clear_github_api_cooldown();
        let (url, server) = serve_responses(&[
            "HTTP/1.1 403 Forbidden\r\nRetry-After: 42\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        ])
        .await;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let marked = std::cell::Cell::new(false);
        let error =
            github_api_get_with_token(&client, &url, Some("private-token"), 0, || marked.set(true))
                .await
                .err()
                .unwrap();
        assert!(error.contains("42 seconds"));
        assert!(!marked.get());
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 1);
        let second_error = github_api_get_with_token(&client, &url, None, 0, || {})
            .await
            .err()
            .unwrap();
        assert!(second_error.contains("rate limit"));
        clear_github_api_cooldown();
    }

    #[tokio::test]
    async fn api_redirect_does_not_forward_the_token() {
        let _guard = TEST_COOLDOWN_LOCK.lock().await;
        clear_github_api_cooldown();
        let (url, server) = serve_responses(&[
            "HTTP/1.1 302 Found\r\nLocation: https://example.invalid/capture\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        ])
        .await;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let error = github_api_get_with_token(&client, &url, Some("private-token"), 0, || {})
            .await
            .err()
            .unwrap();
        assert!(error.contains("302"));
        assert!(!error.contains("private-token"));
        assert_eq!(server.await.unwrap().len(), 1);
    }
}
