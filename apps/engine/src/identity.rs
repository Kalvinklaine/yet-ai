use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductIdentity {
    pub product: ProductSection,
    pub storage: StorageSection,
    pub engine: EngineSection,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductSection {
    pub display_name: String,
    pub id: String,
    pub short_name: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSection {
    pub project_dir: String,
    pub config_dir: String,
    pub cache_dir: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineSection {
    pub rust_crate: String,
    pub binary_name: String,
}

#[derive(Debug, thiserror::Error)]
pub enum IdentityError {
    #[error("failed to parse product identity: {0}")]
    Parse(#[from] serde_json::Error),
}

impl ProductIdentity {
    pub fn load() -> Result<Self, IdentityError> {
        Self::from_json_str(include_str!("../../../product/identity.json"))
    }

    pub fn from_json_str(input: &str) -> Result<Self, IdentityError> {
        Ok(serde_json::from_str(input)?)
    }
}

#[cfg(test)]
mod tests {
    use super::ProductIdentity;

    #[test]
    fn loads_identity_defaults() {
        let identity = ProductIdentity::load().unwrap();
        assert_eq!(identity.product.id, "yet-ai");
        assert_eq!(identity.product.display_name, "Yet AI");
        assert_eq!(identity.engine.rust_crate, "yet-lsp");
        assert_eq!(identity.engine.binary_name, "yet-lsp");
    }
}
