-- Fase 1: catálogo, receitas, histórico, presets e perfis de exportação.
-- Receitas são JSON versionado (campo "version" dentro do JSON).

CREATE TABLE photos (
    id          INTEGER PRIMARY KEY,
    path        TEXT    NOT NULL UNIQUE,
    hash        TEXT,
    format      TEXT    NOT NULL,
    width       INTEGER,
    height      INTEGER,
    exif        TEXT,   -- JSON
    imported_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_photos_hash ON photos (hash);

CREATE TABLE recipes (
    photo_id   INTEGER PRIMARY KEY REFERENCES photos (id) ON DELETE CASCADE,
    recipe     TEXT    NOT NULL, -- JSON
    updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE history (
    id         INTEGER PRIMARY KEY,
    photo_id   INTEGER NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
    recipe     TEXT    NOT NULL, -- JSON
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_history_photo ON history (photo_id, id);

CREATE TABLE presets (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    folder     TEXT    NOT NULL DEFAULT '',
    recipe     TEXT    NOT NULL,              -- JSON (receita parcial)
    groups     TEXT    NOT NULL DEFAULT '[]', -- JSON array, ex.: ["light","color"]
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (folder, name)
);

CREATE TABLE export_profiles (
    id           INTEGER PRIMARY KEY,
    name         TEXT    NOT NULL UNIQUE,
    format       TEXT    NOT NULL CHECK (format IN ('jpeg', 'png', 'tiff', 'webp')),
    quality      INTEGER CHECK (quality BETWEEN 1 AND 100),
    resize_mode  TEXT    NOT NULL DEFAULT 'none'
                         CHECK (resize_mode IN ('none', 'long_edge', 'width', 'megapixels')),
    resize_value REAL,
    name_pattern TEXT    NOT NULL DEFAULT '{nome}'
);
