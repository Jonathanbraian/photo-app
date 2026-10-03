-- Etapa 2: importação. Cada pasta que contém fotos vira uma linha em
-- `folders`; as fotos ganham metadados de arquivo, EXIF principal e o estado
-- do cache (miniatura + prévia). A coluna `exif` (0001) fica reservada para o
-- EXIF completo.

CREATE TABLE folders (
    id       INTEGER PRIMARY KEY,
    path     TEXT    NOT NULL UNIQUE,
    name     TEXT    NOT NULL,
    added_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

ALTER TABLE photos ADD COLUMN folder_id     INTEGER REFERENCES folders (id) ON DELETE CASCADE;
ALTER TABLE photos ADD COLUMN file_name     TEXT;
ALTER TABLE photos ADD COLUMN file_size     INTEGER;
ALTER TABLE photos ADD COLUMN modified_at   INTEGER; -- ms desde 1970 (mtime do arquivo)
ALTER TABLE photos ADD COLUMN orientation   INTEGER; -- EXIF 1–8
ALTER TABLE photos ADD COLUMN camera        TEXT;
ALTER TABLE photos ADD COLUMN lens          TEXT;
ALTER TABLE photos ADD COLUMN iso           INTEGER;
ALTER TABLE photos ADD COLUMN aperture      REAL;    -- número f
ALTER TABLE photos ADD COLUMN shutter_speed REAL;    -- segundos
ALTER TABLE photos ADD COLUMN taken_at      TEXT;    -- YYYY-MM-DDTHH:MM:SS (hora local da câmera)
ALTER TABLE photos ADD COLUMN cache_status  TEXT NOT NULL DEFAULT 'pending'
                                            CHECK (cache_status IN ('pending', 'ready', 'error'));
ALTER TABLE photos ADD COLUMN cache_error   TEXT;

CREATE INDEX idx_photos_folder ON photos (folder_id);
