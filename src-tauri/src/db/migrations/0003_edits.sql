-- Etapa 3a: edição. `history_id` aponta a posição atual no histórico (para
-- desfazer/refazer sobreviverem ao reinício), `edited` marca receitas diferentes
-- da neutra e `thumb_file` é a miniatura editada na pasta de cache `edited/`.

ALTER TABLE recipes ADD COLUMN history_id INTEGER;
ALTER TABLE recipes ADD COLUMN edited     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recipes ADD COLUMN thumb_file TEXT;
