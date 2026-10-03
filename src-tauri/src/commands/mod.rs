//! Tauri commands exposed to the interface via `invoke`.
//! Next steps add `preset` and `export` here.

pub mod develop;
pub mod library;
pub mod system;

/// Error type returned by commands; serialized as a plain string for the UI.
#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error(transparent)]
    Db(#[from] crate::db::DbError),
    #[error("estado do banco indisponível")]
    Poisoned,
    #[error("{0}")]
    Message(String),
}

impl serde::Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
