# Photo Batch Editor

App desktop (Mac e Windows) para aplicar o mesmo tratamento de cor e luz a centenas de fotos e exportar em lote. Especificação completa em [`docs/SPEC.md`](docs/SPEC.md).

**Estado atual:** etapa 2 — importação de pastas com miniaturas e prévias em cache, grade virtualizada com seleção múltipla e filtro por pasta.

## Estrutura

```
src/                    # Interface (React + TypeScript + Vite + Tailwind)
  screens/              # Library (Biblioteca), Develop (Edição)
  components/           # PhotoGrid (virtualizada), Sidebar, StatusCard
  lib/                  # api.ts (invoke/eventos), selection.ts, useLibrary.ts
src-tauri/              # Motor (Rust)
  src/commands/         # comandos Tauri expostos à interface
  src/db/               # SQLite + migrações (src/db/migrations/*.sql) e consultas
  src/import.rs         # varredura, registro no catálogo e cache em paralelo
  src/pipeline/         # decodificação, EXIF, HEIC, miniaturas
  src/raw/              # leitura de RAW (rawler)
  tests/                # testes de importação + fixtures (JPEG e DNG)
  tauri.conf.json
.github/workflows/      # build Mac (.dmg) + Windows (.msi)
```

## Pré-requisitos

- Node.js 22+
- Rust estável (`rustup`)
- **Mac:** Xcode Command Line Tools (`xcode-select --install`)
- **Windows:** Microsoft C++ Build Tools ("Desenvolvimento para desktop com C++") e WebView2 (já vem no Windows 10/11 atualizados)

Detalhes: <https://v2.tauri.app/start/prerequisites/>

## Desenvolvimento

```bash
npm install
npm run tauri dev       # abre o app com hot reload
```

Testes e verificações:

```bash
npm run build                                         # typecheck + build da interface
cargo test   --manifest-path src-tauri/Cargo.toml     # testes do banco/migrações
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Gerar instalador localmente:

```bash
npm run tauri build -- --bundles dmg    # Mac
npm run tauri build -- --bundles msi    # Windows
```

## Banco de dados

O catálogo fica em `library.db`, na pasta de dados do app:

- Mac: `~/Library/Application Support/com.nexsyss.photobatcheditor/`
- Windows: `%APPDATA%\com.nexsyss.photobatcheditor\`

As migrações são arquivos SQL em `src-tauri/src/db/migrations/`, aplicados em ordem ao abrir o app. A versão aplicada fica em `PRAGMA user_version`. Para mudar o esquema, crie um novo arquivo e acrescente-o à lista `MIGRATIONS` em `src-tauri/src/db/mod.rs`; nunca edite uma migração já publicada.

## Importação

- Formatos: JPEG, PNG, TIFF, HEIC/HEIF e RAW (CR2, CR3, NEF, ARW, RAF, DNG). Outros arquivos e pastas ocultas são ignorados.
- Os originais só são lidos, nunca alterados. O app grava apenas no catálogo e no cache.
- Cache: prévia de 2048 px e miniatura de 300 px (JPEG), já na orientação correta, nomeadas pelo hash (BLAKE3) do arquivo:
  - Mac: `~/Library/Caches/com.nexsyss.photobatcheditor/`
  - Windows: `%LOCALAPPDATA%\com.nexsyss.photobatcheditor\`
- RAW: usa o JPEG embutido pela câmera; só revela os dados do sensor quando não há prévia utilizável.
- HEIC: usa o decodificador do sistema. No Mac funciona direto; no Windows precisa das "Extensões de Imagem HEIF" e "Extensões de Vídeo HEVC" da Microsoft Store (o mesmo que o app Fotos exige).
- Reimportar uma pasta não duplica fotos: arquivos sem mudança (mesmo tamanho e data) são pulados; arquivos alterados são reprocessados mantendo o mesmo id.

As fixtures de teste (`src-tauri/tests/fixtures/`) são geradas por `cargo run --example make_fixtures` (em `src-tauri/`).

## Ícone

`app-icon.svg` é a fonte dos ícones. Para regenerar: `npx tauri icon app-icon.svg -o src-tauri/icons`.
