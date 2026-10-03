# Photo Batch Editor

App desktop (Mac e Windows) para aplicar o mesmo tratamento de cor e luz a centenas de fotos e exportar em lote. Especificação completa em [`docs/SPEC.md`](docs/SPEC.md).

**Estado atual:** etapa 1 — esqueleto Tauri 2 + React, catálogo SQLite com migrações e build automático no GitHub Actions.

## Estrutura

```
src/                    # Interface (React + TypeScript + Vite + Tailwind)
  screens/              # Library (Biblioteca), Develop (Edição)
  lib/api.ts            # chamadas ao Rust via invoke
src-tauri/              # Motor (Rust)
  src/commands/         # comandos Tauri expostos à interface
  src/db/               # SQLite + migrações (src/db/migrations/*.sql)
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

## Ícone

`app-icon.svg` é a fonte dos ícones. Para regenerar: `npx tauri icon app-icon.svg -o src-tauri/icons`.
