# Ajustes: fórmulas e ordem de aplicação

Este documento é a **definição** dos ajustes das etapas 3a e 3b. A prévia em WebGL
(`src/gl/shaders.ts`) e a implementação de referência em CPU
(`src/lib/adjust.ts`) seguem exatamente estas fórmulas. A etapa 4 vai
reproduzi-las no Rust para a exportação ter a mesma cor da prévia.

Se uma fórmula mudar, mude aqui primeiro, depois nos dois lados, e atualize os
testes (`src/lib/*.test.ts` e `tests/gl/shaders.spec.ts`, que roda no Chromium e
no WebKit).

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
| HSL | `hsl.<cor>.h` / `.s` / `.l` | −100 … +100 | 0 | cores: `red`, `orange`, `yellow`, `green`, `aqua`, `blue`, `purple`, `magenta` |
| Curva | `curve.rgb`, `curve.r`, `curve.g`, `curve.b` | pontos `[x, y]`, 0 … 255 | `[[0,0],[255,255]]` | |
| LUT | `lut.id`, `lut.intensity` | intensidade 0 … 1 | `lut: null` | |
| Corte | `crop.x`, `crop.y`, `crop.w`, `crop.h` | 0 … 1 (frações de W e H) | `0, 0, 1, 1` | |
| Corte | `crop.angle` | −45 … +45 | 0 | graus |
| Corte | `crop.ratio` | `null` (livre), `"original"`, `"original-flip"`, `"a:b"` | `null` | só para a interface |

Com todos os parâmetros no valor neutro a saída é igual à entrada (a menos de
arredondamento de ±1 em 8 bits). `presence.noise` existe na receita mas ainda
não é aplicado.

## Ordem

1. Linearizar
2. Balanço de branco (temperatura, matiz)
3. Exposição
4. Tom: brancos/pretos → sombras/realces → contraste
5. Cor: vibração e saturação
6. HSL por cor
7. Curva de tons (RGB, depois por canal)
8. Presença: nitidez e clareza (espaciais)
9. Vinheta
10. Codificar em sRGB (sem arredondar)
11. LUT `.cube`
12. Quantizar em 8 bits
13. Corte e endireitar (geométrico, no fim da cadeia)

Os passos 1–12 trabalham sempre sobre a prévia inteira; o corte só escolhe e
gira o recorte final, então mudar o corte não altera nenhum outro ajuste (a
vinheta, por exemplo, é relativa à foto inteira).

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
comprimidos pelos realces; eles são cortados na saída (passo 10).

### 5. Cor

Com `L = Y(rgb)`, `mx = max(r, g, b)`, `mn = min(r, g, b)`:

```
sat = mx > 1e-6 ? (mx − mn)/mx : 0
fv  = 1 + (vibrance/100) · (1 − sat)²     (vibração protege cores já saturadas)
fs  = 1 + saturation/100
rgb ← L + (rgb − L) · fv · fs
rgb ← max(rgb, 0)
```

### 6. HSL por cor

Atua na matiz, saturação e brilho de faixas de cor, em HSV calculado sobre o RGB
linear (todos os canais ≥ 0 depois do passo 5). Se todos os 24 valores forem 0,
o passo não é aplicado.

```
mx = max(r,g,b),  mn = min(r,g,b),  d = mx − mn
V = mx
S = mx > 1e-6 ? d/mx : 0
H = d < 1e-9 ? 0 :
    mx = r ? 60·(g − b)/d          (somar 360 se negativo)
    mx = g ? 60·((b − r)/d + 2)
           : 60·((r − g)/d + 4)          (H em [0, 360))
```

Centros das 8 cores, em graus: vermelho 0, laranja 30, amarelo 60, verde 120,
aqua 180, azul 240, roxo 270, magenta 300 (e de novo vermelho em 360). Cada
matiz `H` fica entre dois centros vizinhos `c_i ≤ H < c_{i+1}`; os pesos são uma
partição da unidade com transição suave (derivada contínua, sem faixas):

```
t   = (H − c_i)/(c_{i+1} − c_i)
w_i = 1 − smoothstep(0, 1, t),   w_{i+1} = smoothstep(0, 1, t),   demais = 0
```

Com `(h_j, s_j, l_j)` os valores da cor `j` e `k = smoothstep(0.02, 0.2, S)`
(cinzas não mudam, porque a matiz deles não é estável):

```
dH = Σ w_j · h_j/100 · 30°        (até ±30°, em direção às cores vizinhas)
dS = Σ w_j · s_j/100
dL = Σ w_j · l_j/100

H' = (H + k·dH) mod 360
S' = clamp(S · (1 + k·dS), 0, 1)
V' = V · 2^(k·dL)                 (até ±1 EV)
rgb ← hsv2rgb(H', S', V')
```

`hsv2rgb`: `C = V'·S'`, `h = H'/60`, `X = C·(1 − |h mod 2 − 1|)`, `m = V' − C`;
setor `floor(h) mod 6` = 0…5 → `(C,X,0) (X,C,0) (0,C,X) (0,X,C) (X,0,C) (C,0,X)`,
mais `m` em cada canal.

### 7. Curva de tons

Quatro curvas definidas por pontos `(x, y)` em 0…255: `rgb` (aplicada aos três
canais) e `r`, `g`, `b`. Atuam sobre os valores **codificados em sRGB**. Se as
quatro forem a identidade `[[0,0],[255,255]]`, o passo não é aplicado (e valores
acima de 1 não são cortados).

```
e  = srgb(clamp(c, 0, 1))                  (passo 10, sem arredondar)
e' = C_canal(C_rgb(255·e)) / 255           (por canal)
c  ← lin(clamp(e', 0, 1))
```

Cada curva é uma interpolação cúbica de Hermite **monotônica por partes**
(PCHIP de Fritsch–Butland), que nunca ultrapassa os pontos vizinhos:

```
pontos ordenados por x, x estritamente crescente (duplicados: fica o último)
h_k = x_{k+1} − x_k,  d_k = (y_{k+1} − y_k)/h_k
m_0 = d_0,  m_{n−1} = d_{n−2}
m_k = 0                                   se d_{k−1}·d_k ≤ 0
m_k = (w1 + w2)/(w1/d_{k−1} + w2/d_k)     senão, com w1 = 2h_k + h_{k−1}, w2 = h_k + 2h_{k−1}

para x_k ≤ x ≤ x_{k+1}, t = (x − x_k)/h_k:
C(x) = (2t³ − 3t² + 1)·y_k + (t³ − 2t² + t)·h_k·m_k + (−2t³ + 3t²)·y_{k+1} + (t³ − t²)·h_k·m_{k+1}
fora de [x_0, x_{n−1}]: C = y_0 ou y_{n−1};  resultado limitado a [0, 255]
```

Atalho permitido (usado na prévia): tabelar `C_canal∘C_rgb` em 1024 amostras
uniformes e interpolar linearmente.

### 8. Presença (nitidez e clareza)

Usa a imagem resultante do passo 7, `I7`. Com `L = Y(I7)` e `p = enc(L)` por pixel,
e `G_σ(p)` sendo o desfoque gaussiano de `p` com desvio `σ` em pixels (núcleo
`exp(−d²/(2σ²))` normalizado, raio `ceil(3σ)`, bordas replicadas):

```
σs = 1  · lado/2048        (nitidez: 1 px na prévia de 2048 px)
σc = 20 · lado/2048        (clareza)

q  = clamp(p, 0, 1)
m  = 4·q·(1 − q)           (clareza atua mais nos tons médios)
p' = p + 1.5·(sharpness/100)·(p − G_σs(p))
       + 0.6·(clarity/100)·m·(p − G_σc(p))

rgb ← relum(I7, L, dec(p'))
```

Os raios são relativos ao tamanho da imagem, para a prévia de 2048 px e o
arquivo em resolução total terem a mesma aparência.

Atalho permitido para `G_σc` (usado na prévia): calcular numa versão reduzida
por um fator `f = clamp(floor(σc/2.5), 1, 4)` — média de blocos `f×f`, desfoque
com `σc/f` e interpolação bilinear de volta. Na prévia de 2048 px, `f = 4`. A
diferença para o gaussiano exato é pequena porque a clareza só usa as baixas
frequências (medida em `tests/gl/shaders.spec.ts`).

### 9. Vinheta

```
a  = W/H
dx = (u − 0.5)·a,  dy = v − 0.5
r  = sqrt(dx² + dy²) / sqrt((a/2)² + 0.25)       (0 no centro, 1 nos cantos)
wv = smoothstep(0.25, 1.0, r)
rgb ← rgb · 2^(1.5 · (vignette/100) · wv)
```

Vinheta negativa escurece as bordas (até −1.5 EV nos cantos); positiva clareia.

### 10. Codificar

```
c  = clamp(c, 0, 1)
e  = c ≤ 0.0031308 ? 12.92·c : 1.055·c^(1/2.4) − 0.055      (srgb(c))
```

### 11. LUT `.cube`

Formato Adobe/Resolve `.cube`: `LUT_1D_SIZE n` (2 … 4096) ou `LUT_3D_SIZE n` (2 … 65),
`DOMAIN_MIN`/`DOMAIN_MAX` opcionais (padrão 0 e 1), seguidos das linhas `r g b`.
No 3D, o vermelho varia mais rápido: a linha `i + n·j + n²·k` é a entrada
`(i, j, k)` para `(r, g, b)`. A LUT recebe e devolve valores codificados em sRGB.

```
u_c  = clamp((e_c − min_c)/(max_c − min_c), 0, 1)
1D:  por canal, interpolação linear em u_c·(n − 1)
3D:  interpolação trilinear em u·(n − 1)
     (índice i0 = min(floor(p), n − 2), fração p − i0, por eixo)
e  ← clamp(e + intensity · (LUT(e) − e), 0, 1)
```

### 12. Quantizar

```
c8 = round(255 · e)
```

### 13. Corte e endireitar

Sobre a imagem de 8 bits do passo 12 (`W × H`), com o retângulo `(x, y, w, h)` em
frações de `W` e `H` e o ângulo `θ` em graus (positivo gira a foto no sentido
anti-horário). A saída tem `Wc = max(1, round(w·W))` por `Hc = max(1, round(h·H))`
pixels. Para o pixel `(i, j)` da saída:

```
Fx = x·W + (i + 0.5)·(w·W/Wc) − W/2        (ponto no quadro girado, relativo ao centro)
Fy = y·H + (j + 0.5)·(h·H/Hc) − H/2
sx = cos θ·Fx − sin θ·Fy                   (mesmo ponto na foto sem girar)
sy = sin θ·Fx + cos θ·Fy
px = W/2 + sx − 0.5,  py = H/2 + sy − 0.5  (centros dos pixels em inteiros)
```

Se `(px, py)` estiver fora de `[−0.5, W − 0.5] × [−0.5, H − 0.5]`, o pixel é preto.
Senão, interpolação bilinear dos 4 pixels vizinhos (índices limitados às bordas),
por canal, e `round` para 8 bits. Com o corte neutro (`0, 0, 1, 1`, `θ = 0`) a saída
é igual à entrada.

A interface mantém o retângulo **dentro da foto girada**: os quatro cantos,
levados à foto sem girar pela fórmula acima, ficam em `[0, W] × [0, H]`. Ao mudar
o ângulo, o retângulo encolhe em torno do próprio centro (mantendo a proporção)
até caber — é o "corte automático das bordas vazias". `crop.ratio` só guarda a
escolha de proporção da interface (`a:b` = largura:altura em pixels).

## Antes/depois

O "antes" é a foto inteira com a receita neutra, ou seja, os passos 1, 10 e 12
apenas (sem corte).

## Histograma

Calculado sobre a saída final (depois do corte), numa versão reduzida
(256 px no lado maior): 256 faixas para R, G, B e para a luminância
`round(0.2126·R + 0.7152·G + 0.0722·B)` dos valores de 8 bits.
