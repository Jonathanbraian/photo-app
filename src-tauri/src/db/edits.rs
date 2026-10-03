//! Per-photo recipe with persistent undo/redo.
//!
//! Every saved change is a row in `history`; `recipes.history_id` points at
//! the current one. Undo/redo move that pointer, so both survive restarts.
//! Saving after an undo drops the "redo" branch. The first save also records
//! the starting recipe, so the very first edit can be undone.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use super::DbError;
use crate::recipe::Recipe;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditState {
    pub photo_id: i64,
    pub recipe: Recipe,
    pub history_id: Option<i64>,
    pub can_undo: bool,
    pub can_redo: bool,
    pub edited: bool,
}

struct Current {
    recipe: Recipe,
    history_id: Option<i64>,
    thumb_file: Option<String>,
}

fn current(conn: &Connection, photo_id: i64) -> Result<Current, DbError> {
    let row = conn
        .query_row(
            "SELECT recipe, history_id, thumb_file FROM recipes WHERE photo_id = ?1",
            [photo_id],
            |r| Ok((r.get::<_, String>(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    Ok(match row {
        Some((json, history_id, thumb_file)) => Current {
            recipe: Recipe::from_json(&json).unwrap_or_default(),
            history_id,
            thumb_file,
        },
        None => Current {
            recipe: Recipe::default(),
            history_id: None,
            thumb_file: None,
        },
    })
}

fn neighbor(
    conn: &Connection,
    photo_id: i64,
    at: Option<i64>,
    older: bool,
) -> Result<Option<(i64, String)>, DbError> {
    let Some(at) = at else { return Ok(None) };
    let sql = if older {
        "SELECT id, recipe FROM history WHERE photo_id = ?1 AND id < ?2 ORDER BY id DESC LIMIT 1"
    } else {
        "SELECT id, recipe FROM history WHERE photo_id = ?1 AND id > ?2 ORDER BY id ASC LIMIT 1"
    };
    Ok(conn
        .query_row(sql, params![photo_id, at], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?)
}

fn state(conn: &Connection, photo_id: i64) -> Result<EditState, DbError> {
    let cur = current(conn, photo_id)?;
    Ok(EditState {
        photo_id,
        can_undo: neighbor(conn, photo_id, cur.history_id, true)?.is_some(),
        can_redo: neighbor(conn, photo_id, cur.history_id, false)?.is_some(),
        edited: cur.recipe.is_edited(),
        history_id: cur.history_id,
        recipe: cur.recipe,
    })
}

fn write_current(
    conn: &Connection,
    photo_id: i64,
    recipe: &Recipe,
    history_id: i64,
) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO recipes (photo_id, recipe, history_id, edited, updated_at)
         VALUES (?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT (photo_id) DO UPDATE SET
             recipe = excluded.recipe,
             history_id = excluded.history_id,
             edited = excluded.edited,
             updated_at = excluded.updated_at",
        params![photo_id, recipe.to_json(), history_id, recipe.is_edited()],
    )?;
    Ok(())
}

fn push_history(conn: &Connection, photo_id: i64, recipe: &Recipe) -> Result<i64, DbError> {
    Ok(conn.query_row(
        "INSERT INTO history (photo_id, recipe) VALUES (?1, ?2) RETURNING id",
        params![photo_id, recipe.to_json()],
        |r| r.get(0),
    )?)
}

pub fn load(conn: &Connection, photo_id: i64) -> Result<EditState, DbError> {
    state(conn, photo_id)
}

/// Saves `recipe` as the photo's current state (no-op if unchanged).
pub fn save(conn: &mut Connection, photo_id: i64, recipe: &Recipe) -> Result<EditState, DbError> {
    let tx = conn.transaction()?;
    let cur = current(&tx, photo_id)?;
    if &cur.recipe != recipe {
        let base = match cur.history_id {
            Some(id) => id,
            None => push_history(&tx, photo_id, &cur.recipe)?,
        };
        tx.execute(
            "DELETE FROM history WHERE photo_id = ?1 AND id > ?2",
            params![photo_id, base],
        )?;
        let id = push_history(&tx, photo_id, recipe)?;
        write_current(&tx, photo_id, recipe, id)?;
    }
    let st = state(&tx, photo_id)?;
    tx.commit()?;
    Ok(st)
}

fn step(conn: &mut Connection, photo_id: i64, older: bool) -> Result<EditState, DbError> {
    let tx = conn.transaction()?;
    let cur = current(&tx, photo_id)?;
    if let Some((id, json)) = neighbor(&tx, photo_id, cur.history_id, older)? {
        let recipe = Recipe::from_json(&json).unwrap_or_default();
        write_current(&tx, photo_id, &recipe, id)?;
    }
    let st = state(&tx, photo_id)?;
    tx.commit()?;
    Ok(st)
}

pub fn undo(conn: &mut Connection, photo_id: i64) -> Result<EditState, DbError> {
    step(conn, photo_id, true)
}

pub fn redo(conn: &mut Connection, photo_id: i64) -> Result<EditState, DbError> {
    step(conn, photo_id, false)
}

/// Records the edited-thumbnail file name if `history_id` is still current.
/// Returns `(accepted, previous file)`; the caller deletes the old file.
pub fn set_thumb(
    conn: &Connection,
    photo_id: i64,
    history_id: Option<i64>,
    file: Option<&str>,
) -> Result<(bool, Option<String>), DbError> {
    let cur = current(conn, photo_id)?;
    if cur.history_id != history_id {
        return Ok((false, None));
    }
    conn.execute(
        "UPDATE recipes SET thumb_file = ?2 WHERE photo_id = ?1",
        params![photo_id, file],
    )?;
    Ok((
        true,
        cur.thumb_file.filter(|old| Some(old.as_str()) != file),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn setup() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        db::configure(&conn).unwrap();
        db::migrate(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO photos (id, path, format) VALUES (1, '/a.jpg', 'jpeg')",
            [],
        )
        .unwrap();
        conn
    }

    fn exposure(v: f64) -> Recipe {
        let mut r = Recipe::default();
        r.light.exposure = v;
        r
    }

    fn history_len(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM history", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn fresh_photo_has_neutral_recipe_and_no_history() {
        let conn = setup();
        let st = load(&conn, 1).unwrap();
        assert_eq!(st.recipe, Recipe::default());
        assert!(!st.can_undo && !st.can_redo && !st.edited);
    }

    #[test]
    fn first_edit_can_be_undone_back_to_neutral() {
        let mut conn = setup();
        let st = save(&mut conn, 1, &exposure(1.0)).unwrap();
        assert!(st.edited && st.can_undo && !st.can_redo);
        assert_eq!(history_len(&conn), 2, "base + change");

        let st = undo(&mut conn, 1).unwrap();
        assert_eq!(st.recipe, Recipe::default());
        assert!(!st.edited && !st.can_undo && st.can_redo);

        let st = redo(&mut conn, 1).unwrap();
        assert_eq!(st.recipe, exposure(1.0));
        assert!(st.edited && !st.can_redo);
    }

    #[test]
    fn saving_unchanged_recipe_adds_nothing() {
        let mut conn = setup();
        save(&mut conn, 1, &exposure(1.0)).unwrap();
        save(&mut conn, 1, &exposure(1.0)).unwrap();
        assert_eq!(history_len(&conn), 2);
    }

    #[test]
    fn new_change_after_undo_drops_redo_branch() {
        let mut conn = setup();
        save(&mut conn, 1, &exposure(1.0)).unwrap();
        save(&mut conn, 1, &exposure(2.0)).unwrap();
        undo(&mut conn, 1).unwrap();
        let st = save(&mut conn, 1, &exposure(3.0)).unwrap();
        assert!(!st.can_redo);
        assert_eq!(history_len(&conn), 3, "base, 1.0, 3.0");
        assert_eq!(undo(&mut conn, 1).unwrap().recipe, exposure(1.0));
    }

    #[test]
    fn undo_redo_survive_reopening_the_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.db");
        {
            let mut conn = db::open(&path).unwrap();
            conn.execute(
                "INSERT INTO photos (id, path, format) VALUES (1, '/a.jpg', 'jpeg')",
                [],
            )
            .unwrap();
            save(&mut conn, 1, &exposure(1.0)).unwrap();
            save(&mut conn, 1, &exposure(2.0)).unwrap();
            undo(&mut conn, 1).unwrap();
        }
        let mut conn = db::open(&path).unwrap();
        let st = load(&conn, 1).unwrap();
        assert_eq!(st.recipe, exposure(1.0));
        assert!(st.can_undo && st.can_redo);
        assert_eq!(redo(&mut conn, 1).unwrap().recipe, exposure(2.0));
    }

    #[test]
    fn undo_and_redo_at_the_ends_do_nothing() {
        let mut conn = setup();
        assert_eq!(undo(&mut conn, 1).unwrap().recipe, Recipe::default());
        save(&mut conn, 1, &exposure(1.0)).unwrap();
        assert_eq!(redo(&mut conn, 1).unwrap().recipe, exposure(1.0));
    }

    #[test]
    fn stale_thumbnail_is_rejected() {
        let mut conn = setup();
        let first = save(&mut conn, 1, &exposure(1.0)).unwrap();
        let (ok, _) = set_thumb(&conn, 1, first.history_id, Some("1-a.jpg")).unwrap();
        assert!(ok);
        save(&mut conn, 1, &exposure(2.0)).unwrap();
        let (ok, _) = set_thumb(&conn, 1, first.history_id, Some("1-b.jpg")).unwrap();
        assert!(!ok, "a thumbnail rendered for an older state is ignored");
    }

    #[test]
    fn deleting_photo_removes_recipe_and_history() {
        let mut conn = setup();
        save(&mut conn, 1, &exposure(1.0)).unwrap();
        conn.execute("DELETE FROM photos WHERE id = 1", []).unwrap();
        assert_eq!(history_len(&conn), 0);
    }
}
