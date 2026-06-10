use std::sync::RwLock;

use fluent_bundle::{FluentBundle, FluentResource};
use unic_langid::LanguageIdentifier;

const DEFAULT_LOCALE: &str = "zh_CN";
const EN_FTL: &str = include_str!("../i18n/en.ftl");
const ZH_CN_FTL: &str = include_str!("../i18n/zh_CN.ftl");

pub struct LocalizationManager {
    locale: RwLock<String>,
}

impl LocalizationManager {
    pub fn new(locale: impl Into<String>) -> Self {
        Self {
            locale: RwLock::new(normalize_locale(&locale.into()).to_string()),
        }
    }

    pub fn locale(&self) -> String {
        self.locale
            .read()
            .map(|value| value.clone())
            .unwrap_or_else(|_| DEFAULT_LOCALE.to_string())
    }

    pub fn set_locale(&self, locale: &str) -> Result<String, String> {
        let normalized = normalize_locale(locale).to_string();
        if let Ok(mut current) = self.locale.write() {
            *current = normalized.clone();
        }
        Ok(normalized)
    }

    pub fn translate(&self, key: &str) -> String {
        translate_for_locale(&self.locale(), key)
    }
}

pub fn normalize_locale(locale: &str) -> &'static str {
    match locale {
        "en" | "en-US" | "en_US" => "en",
        "zh" | "zh-CN" | "zh_CN" => "zh_CN",
        _ => DEFAULT_LOCALE,
    }
}

fn translate_for_locale(locale: &str, key: &str) -> String {
    let source = match normalize_locale(locale) {
        "en" => EN_FTL,
        _ => ZH_CN_FTL,
    };

    let langid: LanguageIdentifier = match normalize_locale(locale) {
        "en" => "en".parse().expect("valid language identifier"),
        _ => "zh-CN".parse().expect("valid language identifier"),
    };

    let resource = match FluentResource::try_new(source.to_string()) {
        Ok(resource) => resource,
        Err(_) => return key.to_string(),
    };

    let mut bundle = FluentBundle::new(vec![langid]);
    if bundle.add_resource(resource).is_err() {
        return key.to_string();
    }

    let Some(message) = bundle.get_message(key) else {
        return key.to_string();
    };
    let Some(pattern) = message.value() else {
        return key.to_string();
    };

    let mut errors = Vec::new();
    bundle
        .format_pattern(pattern, None, &mut errors)
        .into_owned()
}
