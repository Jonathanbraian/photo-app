# Ajustes: fórmulas e ordem de aplicação

Este documento é a **definição** dos ajustes da etapa 3a. A prévia em WebGL
(`src/gl/shaders.ts`) e a implementação de referência em CPU
(`src/lib/adjust.ts`) seguem exatamente estas fórmulas. A etapa 4 vai
reproduzi-las no Rust para a exportação ter a mesma cor da prévia.

Se uma fórmula mudar, mude aqui primeiro, depois nos dois lados, e atualize os
testes (`src/lib/adjust.test.ts` e `tests/gl/shaders.spec.ts`).

## Convenções

- Pixel de entrada: sRGB de 8 bits, `c8 ∈ {0…255}` por canal; `c = c8 / 255`.
- Todo o processamento é em **luz linear**, com primárias sRGB/Rec.709.
- Luminância linear: `Y(rgb) = 0.2126·r + 0.7152·g + 0.0722·b`.
- Codificação perceptual usada pelos ajustes de tom (não é a curva sRGB):
  `enc(L) = L^(1/2.2)` e `dec(p) = max(p, 0)^2.2`.
- `clamp(x, a, b) = min(max(x, a), b)`.
- `smoothstep(e0, e1, x)`: `t = clamp((x − e0)/(e1 − e0), 0, 1)`, resultado `t²·(3 − 2t)`.
- "Aplicar uma luminância nova `L'` mantendo a cor" significa:
  se `L > 1e-6`, `rgb ← rgb · (L'/L)`; senão `rgb ← (L', L', L')`.
  Chamamos isso de `relum(rgb, L, L')`.
- Coordenadas do pixel `(x, y)` com `x ∈ [0, W)`, `y ∈ [0, H)`; centro do pixel em
  `u = (x + 0.5)/W`, `v = (y + 0.5)/H`. `lado = max(W, H)`.

## Parâmetros

| Grupo | Chave na receita | Faixa | Neutro | Unidade |
| --- | --- | --- | --- | --- |
| Luz | `light.exposure` | −5 … +5 | 0 | EV |
| Luz | `light.contrast` | −100 … +100 | 0 | |
| Luz | `light.highlights` | −100 … +100 | 0 | |
| Luz | `light.shadows` | −100 … +100 | 0 | |
| Luz | `light.whites` | −100 … +100 | 0 | |
| Luz | `light.blacks` | −100 … +100 | 0 | |
| Cor | `color.temperature` | 2000 … 12000 | 6500 | kelvin |
| Cor | `color.tint` | −100 … +100 | 0 | |
| Cor | `color.vibrance` | −100 … +100 | 0 | |
| Cor | `color.saturation` | −100 … +100 | 0 | |
| Presença | `presence.sharpness` | 0 … 100 | 0 | |
| Presença | `presence.clarity` | −100 … +100 | 0 | |
| Presença | `presence.vignette` | −100 … +100 | 0 | |

Com todos os parâmetros no valor neutro a saída é igual à entrada (a menos de
arredondamento de ±1 em 8 bits). `presence.noise`, `hsl`, `curve`, `lut` e
`crop` existem na receita, mas ainda não são aplicados (etapas seguintes).

## Ordem

1. Linearizar
2. Balanço de branco (temperatura, matiz)
3. Exposição
4. Tom: brancos/pretos → sombras/realces → contraste
5. Cor: vibração e saturação
6. Presença: nitidez e clareza (espaciais)
7. Vinheta
8. Codificar em sRGB de 8 bits

### 1. Linearizar (curva sRGB exata)

```
lin(c) = c ≤ 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055)^2.4
```

### 2. Balanço de branco

A temperatura segue a semântica do Lightroom: ela informa a luz da cena, e o
ajuste a neutraliza. Valores menores deixam a imagem mais fria; valores maiores,
mais quente. 6500 K não altera nada.

Cromaticidade do corpo negro em `T` kelvin (aproximação de Kim et al., 2002,
válida para 1667–25000 K; `T` é limitado a essa faixa):

```
x(T) = −0.2661239e9/T³ − 0.2343589e6/T² + 0.8776956e3/T + 0.179910     se T ≤ 4000
       −3.0258469e9/T³ + 2.1070379e6/T² + 0.2226347e3/T + 0.240390     se T > 4000

y(x) = −1.1063814·x³ − 1.34811020·x² + 2.18555832·x − 0.20219683       se T ≤ 2222
       −0.9549476·x³ − 1.37418593·x² + 2.09137015·x − 0.16748867       se 2222 < T ≤ 4000
        3.0817580·x³ − 5.87338670·x² + 3.75112997·x − 0.37001483       se T > 4000
```

Branco da luz `T` em RGB linear: `XYZ = (x/y, 1, (1 − x − y)/y)` e

```
W(T) = M · XYZ,  M = | 3.2404542  −1.5371385  −0.4985314 |
                     |−0.9692660   1.8760108   0.0415560 |
                     | 0.0556434  −0.2040259   1.0572252 |
```

Ganhos por canal, com o matiz `t` atuando no verde (positivo = magenta):

```
g = W(6500) / W(T)                 (divisão por canal)
g.g = g.g · 2^(−0.5 · t/100)
g = g / Y(g)                       (preserva a luminância de um cinza)
rgb ← rgb · g
```

Os ganhos são calculados uma vez por receita (na CPU) e passados ao shader.

### 3. Exposição

```
rgb ← rgb · 2^exposure
```

### 4. Tom

Atua só na luminância, mantendo a cor (`relum`). Com `L = Y(rgb)` e `p = enc(L)`:

```
Brancos (w) e pretos (k) — pontos de branco e de preto:
  Wp = 1 − 0.25 · w/100
  Bp = −0.10 · k/100
  p1 = (p − Bp) / (Wp − Bp)

Sombras (s) e realces (h) — curvas de Bernstein com pico em 1/3 e 2/3:
  q  = clamp(p1, 0, 1)
  p2 = p1 + 0.25·(s/100)·6.75·q·(1 − q)² + 0.25·(h/100)·6.75·q²·(1 − q)

Contraste (c) — curva em S com pivô em p = 0.5 (≈ 18 % de cinza):
  q2 = clamp(p2, 0, 1)
  p3 = p2 + (c/100)·4·(q2 − 0.5)·q2·(1 − q2)

rgb ← relum(rgb, L, dec(p3))
```

Valores acima de 1 (por exemplo, depois de exposição positiva) não são
comprimidos pelos realces; eles são cortados na saída (passo 8).

### 5. Cor

Com `L = Y(rgb)`, `mx = max(r, g, b)`, `mn = min(r, g, b)`:

```
sat = mx > 1e-6 ? (mx − mn)/mx : 0
fv  = 1 + (vibrance/100) · (1 − sat)²     (vibração protege cores já saturadas)
fs  = 1 + saturation/100
rgb ← L + (rgb − L) · fv · fs
rgb ← max(rgb, 0)
```

### 6. Presença (nitidez e clareza)

Usa a imagem resultante do passo 5, `I5`. Com `L = Y(I5)` e `p = enc(L)` por pixel,
e `G_σ(p)` sendo o desfoque gaussiano de `p` com desvio `σ` em pixels (núcleo
`exp(−d²/(2σ²))` normalizado, raio `ceil(3σ)`, bordas replicadas):

```
σs = 1  · lado/2048        (nitidez: 1 px na prévia de 2048 px)
σc = 20 · lado/2048        (clareza)

q  = clamp(p, 0, 1)
m  = 4·q·(1 − q)           (clareza atua mais nos tons médios)
p' = p + 1.5·(sharpness/100)·(p − G_σs(p))
       + 0.6·(clarity/100)·m·(p − G_σc(p))

rgb ← relum(I5, L, dec(p'))
```

Os raios são relativos ao tamanho da imagem, para a prévia de 2048 px e o
arquivo em resolução total terem a mesma aparência.

Atalho permitido para `G_σc` (usado na prévia): calcular numa versão reduzida
por um fator `f = clamp(floor(σc/2.5), 1, 4)` — média de blocos `f×f`, desfoque
com `σc/f` e interpolação bilinear de volta. Na prévia de 2048 px, `f = 4`. A
diferença para o gaussiano exato é pequena porque a clareza só usa as baixas
frequências (medida em `tests/gl/shaders.spec.ts`).

### 7. Vinheta

```
a  = W/H
dx = (u − 0.5)·a,  dy = v − 0.5
r  = sqrt(dx² + dy²) / sqrt((a/2)² + 0.25)       (0 no centro, 1 nos cantos)
wv = smoothstep(0.25, 1.0, r)
rgb ← rgb · 2^(1.5 · (vignette/100) · wv)
```

Vinheta negativa escurece as bordas (até −1.5 EV nos cantos); positiva clareia.

### 8. Codificar

```
c  = clamp(c, 0, 1)
c' = c ≤ 0.0031308 ? 12.92·c : 1.055·c^(1/2.4) − 0.055
c8 = round(255 · c')
```

## Antes/depois

O "antes" é a imagem com a receita neutra, ou seja, os passos 1 e 8 apenas.

## Histograma

Calculado sobre a saída de 8 bits (passo 8), numa versão reduzida da prévia
(256 px no lado maior): 256 faixas para R, G, B e para a luminância
`round(0.2126·R + 0.7152·G + 0.0722·B)` dos valores de 8 bits.
