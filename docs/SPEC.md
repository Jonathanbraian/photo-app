# Photo Batch Editor — Especificação Fase 1

Oct 3, 2026 · @Jonathan Braian

## Visão geral

A fase 1 entrega um app desktop para Mac e Windows que aplica o mesmo tratamento de cor e luz a centenas de fotos de uma vez e exporta tudo em lote. O uso inicial é pessoal; a arquitetura já prevê virar produto da Nexsyss.

O problema resolvido: ajustar uma foto e repetir o ajuste manualmente em todas as outras. Aqui, você ajusta uma, salva como preset e aplica ao ensaio inteiro.

Princípios que valem para todas as fases:

- **Local primeiro:** todo o processamento roda no computador, sem custo por foto e sem internet.
- **Não destrutivo:** o arquivo original nunca é alterado. Cada edição é uma receita salva à parte.
- **Rápido:** prévias leves para editar, processamento em alta resolução só na exportação.
- **RAW e JPEG:** abre RAW das principais câmeras (CR2, CR3, NEF, ARW, RAF, DNG), além de JPEG, PNG, TIFF e HEIC.

## Stack técnica

Tauri 2 com backend em Rust e interface em React: um único código gera instaladores para Mac e Windows, com app leve e acesso direto aos arquivos.

| Camada | Tecnologia | Por quê |
| --- | --- | --- |
| App desktop | Tauri 2 | Instalador pequeno, Mac + Windows, base para vender depois |
| Interface | React + TypeScript + Vite + Tailwind | Mesmo ecossistema dos seus outros projetos |
| Prévia em tempo real | WebGL (shaders) | Sliders respondem instantaneamente, sem esperar o Rust |
| Processamento final | Rust + libvips | Rápido e econômico em memória para lotes grandes |
| Leitura de RAW | LibRaw (via crate `rawler` ou binding) | Suporta CR3, NEF, ARW, RAF, DNG |
| Paralelismo | `rayon` (Rust) | Usa todos os núcleos do processador na exportação |
| Dados locais | SQLite | Catálogo, receitas e presets |
| Metadados | `kamadak-exif` / ExifTool | Preserva EXIF e orientação na exportação |

Ponto de atenção: a prévia em WebGL e o processamento final em Rust precisam produzir a mesma cor. A fórmula de cada ajuste deve ser escrita uma vez e replicada nos dois lados com testes comparando os resultados.

## Arquitetura

A interface só mostra e edita prévias leves; todo o trabalho pesado (decodificar RAW, processar em resolução total, gravar arquivos) fica no motor Rust.

&#91;embedded content: arquitetura da fase 1 · do ensaio aos arquivos finais\]

A interface conversa com o Rust por comandos Tauri (`invoke`) e recebe progresso por eventos. A receita é o único elo entre a edição e a exportação.

## Funcionalidades da fase 1

Cinco blocos: importar, ajustar, presets, aplicar em lote e exportar.

**1. Importar**

- Arrastar uma pasta ou escolher pelo menu; leitura recursiva opcional.
- Gera miniaturas (300 px) e prévias (2048 px) em segundo plano, guardadas em cache.
- Grade de miniaturas com seleção múltipla (Shift, Ctrl/Cmd, selecionar tudo).

**2. Ajustar (painel de edição)**

- Luz: exposição, contraste, realces, sombras, brancos, pretos.
- Cor: temperatura, matiz, vibração, saturação.
- Presença: nitidez, clareza, redução de ruído básica, vinheta.
- HSL por cor (8 canais: matiz, saturação, luminância).
- Curva de tons (RGB e por canal).
- Corte, endireitar e proporções fixas (1:1, 4:5, 3:2, 16:9).
- Importar LUT .cube.
- Antes/depois (tecla `\`), desfazer/refazer ilimitado por foto.

**3. Presets**

- Salvar os ajustes atuais como preset, escolhendo quais grupos incluir (ex.: só cor, sem corte).
- Organizar em pastas; exportar e importar presets como arquivo `.json`.

**4. Aplicar em lote**

- Aplicar preset a todas as fotos selecionadas.
- Copiar ajustes de uma foto e colar nas outras (Ctrl/Cmd+Shift+C / V).
- Sincronizar: editar uma foto e refletir nas selecionadas em tempo real.

**5. Exportar**

- Formatos: JPEG (qualidade ajustável), PNG, TIFF 16 bits, WebP.
- Redimensionar por lado maior, largura ou megapixels.
- Perfis de exportação salvos (ex.: Instagram 1080 px, Web 2048 px, Impressão TIFF).
- Vários perfis numa só exportação.
- Renomear em lote com padrão (`{cliente}_{data}_{seq}`).
- Barra de progresso, cancelamento e processamento paralelo.

## Modelo de dados

Tudo gira em torno da **receita**: um JSON versionado com os ajustes de uma foto. Um preset é uma receita parcial com nome. O original nunca é tocado.

```json
{
  "version": 1,
  "light": { "exposure": 0.35, "contrast": 12, "highlights": -40, "shadows": 25, "whites": 5, "blacks": -8 },
  "color": { "temperature": 5600, "tint": 4, "vibrance": 15, "saturation": 0 },
  "presence": { "sharpness": 30, "clarity": 10, "noise": 0, "vignette": -15 },
  "hsl": { "orange": { "h": 0, "s": -5, "l": 8 } },
  "curve": { "rgb": [[0,0],[64,58],[192,200],[255,255]] },
  "lut": null,
  "crop": { "x": 0, "y": 0, "w": 1, "h": 1, "angle": 0, "ratio": "4:5" }
}
```

Tabelas SQLite:

| Tabela | Campos principais |
| --- | --- |
| `photos` | id, caminho, hash, formato, largura, altura, EXIF, data de importação |
| `recipes` | photo\_id, receita JSON, atualizado\_em |
| `history` | photo\_id, receita JSON, criado\_em (para desfazer) |
| `presets` | id, nome, pasta, receita parcial JSON, grupos incluídos |
| `export_profiles` | id, nome, formato, qualidade, tamanho, padrão de nome |

O campo `version` permite evoluir a receita nas fases seguintes (logo, fundos, efeitos) sem quebrar edições antigas. As fases 2 a 4 entram como novas chaves: `watermark`, `background`, `effects`.

## Interface

Duas telas principais, tema escuro por padrão (padrão em edição de foto, para não distorcer a percepção de cor).

**Biblioteca**

- Barra lateral: pastas importadas e lista de presets.
- Centro: grade de miniaturas com tamanho ajustável; selo nas fotos já editadas.
- Rodapé: tira com a seleção atual e botões "Aplicar preset", "Colar ajustes" e "Exportar".

**Edição**

- Centro: foto grande com zoom (ajustar, 100%) e antes/depois.
- Direita: painéis recolhíveis (Luz, Cor, Presença, HSL, Curva, Corte, LUT).
- Esquerda: presets com prévia ao passar o mouse e histórico de ajustes.
- Inferior: tira de miniaturas para navegar entre fotos com as setas.

**Fluxo típico de um ensaio**

1. Importar a pasta do ensaio.
2. Abrir uma foto representativa e ajustar.
3. Salvar como preset (ou copiar ajustes).
4. Voltar à biblioteca, selecionar tudo e aplicar.
5. Revisar fotos com luz diferente e corrigir individualmente.
6. Exportar com um ou mais perfis.

Atalhos essenciais: G (biblioteca), D (edição), `\` (antes/depois), Ctrl/Cmd+Z, Ctrl/Cmd+Shift+C / V, Ctrl/Cmd+Shift+E (exportar).

## Repositório e etapas para o Claude Code

Entregar em seis etapas, cada uma um commit testável. Só avançar quando a etapa anterior funcionar no Mac e no Windows.

```
photo-batch-editor/
  src/                  # React (interface)
    components/         # Grid, Slider, Panel, Filmstrip
    screens/            # Library, Develop, Export
    gl/                 # shaders da prévia
    lib/recipe.ts       # tipos e defaults da receita
  src-tauri/            # Rust
    src/
      commands/         # import, recipe, preset, export
      pipeline/         # decode, adjust, encode
      raw/              # leitura RAW
      db/               # SQLite + migrações
    tests/fixtures/     # fotos de teste (RAW + JPEG)
  .github/workflows/    # build Mac + Windows
```

1. **Esqueleto:** projeto Tauri 2 + React, SQLite com migrações, build automático no GitHub Actions para Mac (.dmg) e Windows (.msi).
2. **Importar:** comando Rust que lê a pasta, decodifica RAW e JPEG, gera miniaturas e prévias em cache; grade na tela Biblioteca.
3. **Ajustes:** tela Edição com sliders, prévia em WebGL, receita salva no SQLite, desfazer/refazer.
4. **Pipeline Rust:** mesmos ajustes aplicados em resolução total; teste que compara a prévia com o resultado final.
5. **Presets e lote:** salvar, organizar e aplicar presets; copiar e colar ajustes; seleção múltipla.
6. **Exportar:** formatos, tamanhos, perfis, renomear, processamento paralelo com progresso.

Prompt inicial sugerido para o Claude Code: *"Leia este documento e implemente apenas a etapa 1. Ao final, descreva o que foi feito e como testar."*

## Critérios de aceite

A fase 1 está pronta quando um ensaio real de 300 fotos RAW vai da importação à exportação sem travar e sem sair do app.

- [ ] Instala e abre no Mac (Apple Silicon e Intel) e no Windows 10/11.
- [ ] Importa 300 fotos RAW e mostra a grade de miniaturas enquanto o resto carrega.
- [ ] Sliders respondem sem atraso perceptível na prévia.
- [ ] Prévia e arquivo exportado têm a mesma cor (diferença visualmente imperceptível).
- [ ] Preset aplicado a 300 fotos em poucos segundos.
- [ ] Exporta em JPEG e TIFF com EXIF e orientação preservados.
- [ ] Fechar e reabrir o app mantém todas as edições.
- [ ] Nenhum arquivo original é modificado.

**Fora do escopo da fase 1** (próximas fases): logo e marca d'água, remoção de fundo, fundos novos ou gerados por IA, efeitos e filtros criativos, ajustes locais (pincel, máscaras), retoque de pele, contas e licenças.
