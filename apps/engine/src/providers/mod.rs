use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRegistrySummary {
    pub providers: Vec<ProviderSummary>,
    pub cloud_required: bool,
    pub provider_access: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSummary {
    pub id: String,
    pub display_name: String,
    pub enabled: bool,
    pub models: Vec<ModelSummary>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelListResponse {
    pub models: Vec<ModelSummary>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSummary {
    pub id: String,
    pub display_name: String,
}

pub fn empty_registry() -> ProviderRegistrySummary {
    ProviderRegistrySummary {
        providers: Vec::new(),
        cloud_required: false,
        provider_access: "direct".to_string(),
    }
}

pub fn empty_models() -> ModelListResponse {
    ModelListResponse { models: Vec::new() }
}
