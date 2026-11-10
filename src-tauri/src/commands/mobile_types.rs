use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidSelectedUploadDirectory {
    pub(super) uri: String,
    pub(super) name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidPasskeyAvailability {
    pub(super) available: bool,
    pub(super) web_view_web_authn: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidPasskeyRegistration {
    pub(super) id: String,
    pub(super) registration_response_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidPasskeyAssertion {
    pub(super) id: String,
    pub(super) authentication_response_json: String,
}
