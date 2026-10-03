-- Etapa 3b: LUTs importadas. O arquivo fica copiado em <dados do app>/luts/<id>.cube,
-- então a receita não depende do arquivo original.

CREATE TABLE luts (
    id       TEXT PRIMARY KEY,      -- hash do conteúdo
    name     TEXT NOT NULL,         -- nome do arquivo original, sem extensão
    kind     TEXT NOT NULL CHECK (kind IN ('1d', '3d')),
    size     INTEGER NOT NULL,
    title    TEXT NOT NULL DEFAULT '',
    added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
