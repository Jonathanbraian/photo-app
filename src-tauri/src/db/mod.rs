//! SQLite catalog: connection setup and schema migrations.
//!
//! Migrations are plain SQL files embedded at compile time and applied in
//! order. The applied version is stored in `PRAGMA user_version`, so each
//! migration runs exactly once. To evolve the schema, append a new file to
//! `MIGRATIONS` — never edit one that has already shipped.

pub mod catalog;
pub mod edits;

use std::path::Path;

use rusqlite::Connection;

pub const DB_FILE_NAME: &str = "library.db";

const MIGRATIONS: &[&str] = &[
    include_str!("migrations/0001_init.sql"),
    include_str!("migrations/0002_import.sql"),
    include_str!("migrations/0003_edits.sql"),
    include_str!("migrations/0004_luts.sql"),
];

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("erro no SQLite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error(
        "o banco está na versão {found}, mais nova que a suportada ({supported}); atualize o app"
    )]
    TooNew { found: u32, supported: u32 },
}

/// Opens (creating if needed) the catalog at `path` and brings it up to date.
pub fn open(path: &Path) -> Result<Connection, DbError> {
    let mut conn = Connection::open(path)?;
    configure(&conn)?;
    migrate(&mut conn)?;
    Ok(conn)
}

pub(crate) fn configure(conn: &Connection) -> Result<(), DbError> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", true)?;
    Ok(())
}

pub fn latest_version() -> u32 {
    MIGRATIONS.len() as u32
}

pub fn schema_version(conn: &Connection) -> Result<u32, DbError> {
    Ok(conn.pragma_query_value(None, "user_version", |row| row.get(0))?)
}

/// Applies every pending migration, each in its own transaction.
pub fn migrate(conn: &mut Connection) -> Result<(), DbError> {
    let current = schema_version(conn)?;
    let latest = latest_version();
    if current > latest {
        return Err(DbError::TooNew {
            found: current,
            supported: latest,
        });
    }
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", index as u32 + 1)?;
        tx.commit()?;
    }
    Ok(())
}

pub fn list_tables(conn: &Connection) -> Result<Vec<String>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master \
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )?;
    let names = stmt
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<String>, _>>()?;
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        configure(&conn).unwrap();
        migrate(&mut conn).unwrap();
        conn
    }

    #[test]
    fn fresh_database_reaches_latest_version() {
        let conn = memory_db();
        assert_eq!(schema_version(&conn).unwrap(), latest_version());
        assert_eq!(
            list_tables(&conn).unwrap(),
            [
                "export_profiles",
                "folders",
                "history",
                "luts",
                "photos",
                "presets",
                "recipes"
            ]
        );
    }

    #[test]
    fn migrate_is_idempotent() {
        let mut conn = memory_db();
        migrate(&mut conn).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), latest_version());
    }

    #[test]
    fn rejects_database_from_newer_app() {
        let mut conn = memory_db();
        conn.pragma_update(None, "user_version", latest_version() + 1)
            .unwrap();
        assert!(matches!(migrate(&mut conn), Err(DbError::TooNew { .. })));
    }

    #[test]
    fn deleting_photo_cascades_to_recipe_and_history() {
        let conn = memory_db();
        conn.execute(
            "INSERT INTO photos (id, path, format) VALUES (1, '/fotos/a.cr3', 'cr3')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO recipes (photo_id, recipe) VALUES (1, '{\"version\":1}')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO history (photo_id, recipe) VALUES (1, '{\"version\":1}')",
            [],
        )
        .unwrap();

        conn.execute("DELETE FROM photos WHERE id = 1", []).unwrap();

        let remaining: i64 = conn
            .query_row(
                "SELECT (SELECT COUNT(*) FROM recipes) + (SELECT COUNT(*) FROM history)",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn export_profile_rejects_unknown_format() {
        let conn = memory_db();
        let result = conn.execute(
            "INSERT INTO export_profiles (name, format) VALUES ('x', 'bmp')",
            [],
        );
        assert!(result.is_err());
    }

    #[test]
    fn opens_and_reopens_file_database() {
        let dir = std::env::temp_dir().join(format!("pbe-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(DB_FILE_NAME);
        let _ = std::fs::remove_file(&path);

        {
            let conn = open(&path).unwrap();
            conn.execute(
                "INSERT INTO photos (path, format) VALUES ('/fotos/b.jpg', 'jpeg')",
                [],
            )
            .unwrap();
        }
        let conn = open(&path).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM photos", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(schema_version(&conn).unwrap(), latest_version());

        drop(conn);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
