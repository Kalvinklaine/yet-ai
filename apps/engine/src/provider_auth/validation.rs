use serde::de::Error as DeError;
use serde::{Deserialize, Deserializer};

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub(super) enum NonNullField<T> {
    Value(T),
}

pub(super) fn deserialize_optional_non_null<'de, D, T>(
    deserializer: D,
) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    match Option::<NonNullField<T>>::deserialize(deserializer)? {
        Some(NonNullField::Value(value)) => Ok(Some(value)),
        None => Err(D::Error::custom("null is not allowed")),
    }
}
