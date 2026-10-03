# Photo Batch Editor

App desktop (Mac e Windows) para aplicar o mesmo tratamento de cor e luz a centenas de fotos e exportar em lote. Especificação completa em [`docs/SPEC.md`](docs/SPEC.md).

**Estado atual:** etapa 3a — tela Edição com ajustes de Luz, Cor e Presença em tempo real (WebGL), histograma, receita salva automaticamente e desfazer/refazer persistente. Fórmulas em [`docs/ADJUSTMENTS.md`](docs/ADJUSTMENTS.md).

## Estrutura

```
src/                    # Interface (React + TypeScript + Vite + Tailwind)
  screens/              # Library (Biblioteca), Develop (Edição)
  components/           # PhotoGrid, Sidebar, Viewer, Filmstrip, Slider, Panel, HistogramView
  gl/                   # renderer.ts + shaders.ts (prévia WebGL2)
  lib/                  # api.ts, recipe.ts, adjust.ts (referência em CPU), useEditor.ts…
src-tauri/              # Motor (Rust)
  src/commands/         # comandos Tauri expostos à interface
  src/db/               # SQLite + migrações (src/db/migrations/*.sql) e consultas
  src/import.rs         # varredura, registro no catálogo e cache em paralelo
  src/pipeline/         # decodificação, EXIF, HEIC, miniaturas
  src/raw/              # leitura de RAW (rawler)
  src/recipe.rs         # receita (mesmo JSON do SPEC)
  src/db/edits.rs       # receita atual + histórico (desfazer/refazer)
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
npm test                                              # Vitest: fórmulas, receita, seleção
npx playwright install chromium webkit && npm run test:gl   # WebGL = referência + fluxo da Edição (Chromium e WebKit)
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

## Edição

- Abrir: duplo clique na miniatura ou tecla D (abre a última foto clicada). G volta à Biblioteca.
- Zoom: clique na foto alterna entre "Ajustar" e 100 % (um pixel da prévia de 2048 px por pixel da tela); arraste para mover.
- ← → navegam pela tira de miniaturas; segure `\` para ver o antes.
- Duplo clique num slider zera o valor; ↺ zera o painel.
- A receita é salva ~300 ms depois da última mudança; cada salvamento é um passo de desfazer (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z), mantido depois de reabrir o app.
- A miniatura da Biblioteca passa a mostrar a edição (gerada pela prévia, em `edited/` na pasta de cache) e ganha o selo ✎.
- Os originais nunca são abertos pela Edição: ela usa a prévia de 2048 px do cache.

## Ícone

`app-icon.svg` é a fonte dos ícones. Para regenerar: `npx tauri icon app-icon.svg -o src-tauri/icons`.
