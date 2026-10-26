# Pesquisa sobre emuladores de PlayStation 2 no navegador

Este documento registra a investigação que levou à escolha do núcleo de emulação do
projeto. Todo dado aqui foi verificado em fonte primária: código-fonte, API do GitHub e
relatórios oficiais de compatibilidade. Nada foi presumido.

---

## 1. Objetivo

Executar **Grand Theft Auto: San Andreas de PlayStation 2** no navegador de um celular
Android com pelo menos 2 GB de RAM, com o usuário fornecendo a imagem do próprio disco.

Restrições que eliminaram várias alternativas logo de início:

- Sem streaming remoto. A execução precisa acontecer no aparelho.
- Sem distribuir jogo, BIOS ou qualquer arquivo protegido.
- Sem servidor permanente. O site precisa ser estático, publicável na Cloudflare Pages.
- Precisa funcionar em navegador de celular comum, não em um computador de desenvolvimento.

---

## 2. Tecnologia investigada 1: Lecteur PS2

Repositório: <https://github.com/Rickow/lecteur-ps2>

### 2.1 O que é

Um invólucro web, com interface para iPhone, em volta do build web oficial do emulador
**[Play!](https://github.com/jpd002/Play-)**. O repositório é pequeno (1,1 MB) e contém:

| Arquivo | Papel | Tamanho |
|---|---|---|
| `Play.js` | Frontend Emscripten do Play! | 202 KB |
| `Play.wasm` | Núcleo de emulação (EE/VU/IOP/GS) | 2,57 MB |
| `ps2mc.js` + `ps2mc.wasm` | Motor de cartão de memória (`ps2vmc-tool`) | 14 KB + 37 KB |
| `lecteur-ps2.html` | Interface completa, em um único arquivo | 50 KB |
| `coi-sw.js` | Service worker que injeta COOP/COEP | 2,4 KB |
| `_headers`, `deploy/` | Configuração de publicação | — |

### 2.2 Arquitetura

1. `Play.js` é um módulo ES que exporta uma função de inicialização Emscripten.
2. É um **build com threads**: usa `pthreads`, logo exige `SharedArrayBuffer`.
3. `SharedArrayBuffer` só existe em documento **isolado por origem cruzada**, o que exige
   os cabeçalhos `Cross-Origin-Opener-Policy: same-origin` e
   `Cross-Origin-Embedder-Policy: require-corp`.
4. `initVm()` cria a máquina virtual e o contexto WebGL2, procurando o canvas pelo
   seletor `#outputCanvas`.
5. `bootDiscImage(nome)` monta o disco e inicia a execução.

### 2.3 Como carrega jogos

Ponto central da arquitetura. O núcleo **não recebe o arquivo inteiro**. Ele chama, do
lado WebAssembly:

```c
// Source/Js_DiscImageDeviceStream.cpp (Play! upstream)
MAIN_THREAD_EM_ASM({
    Module.discImageDevice.read($0, position, $3);   // buffer, offset, length
}, buffer, positionLow, positionHigh, size);
while(!MAIN_THREAD_EM_ASM_INT({ return Module.discImageDevice.isDone(); })) {
    usleep(100);
}
```

O lado JavaScript fornece um objeto `discImageDevice` com quatro métodos:

| Método | Papel |
|---|---|
| `getFileSize()` | tamanho total, em dois inteiros de 32 bits |
| `read(destino, offset, tamanho)` | lê um intervalo e escreve em `HEAPU8` |
| `isDone()` | `true` quando a leitura assíncrona terminou |
| `setFile(file)` | define o arquivo de origem |

A leitura é feita com `blob.slice(offset, offset + tamanho).arrayBuffer()`, ou seja, **o
disco é lido sob demanda e nunca entra inteiro na memória RAM**. Isso é decisivo para um
celular com 2 GB de RAM e um disco de 4 a 8 GB.

### 2.4 Formatos de disco aceitos

Confirmado em `Source/DiskUtils.cpp` (`CreateOpticalMediaFromPath`):

| Extensão | Tratamento | Comprimido |
|---|---|---|
| `.iso` | fluxo direto | não |
| `.cso` | `CCsoImageStream` | sim |
| `.isz` | `CIszImageStream` | sim |
| `.chd` | `CreateOpticalMediaFromChd` (libchdr) | sim |
| `.cue` | folha de cues, aponta para `.bin` | não |
| `.mds` | descritor, aponta para `.mdf` | não |
| `.elf` | executável direto, via `bootElf()` | não |

### 2.5 BIOS

**Não é necessária.** O Play! usa **HLE BIOS** (emulação de alto nível): ele reimplementa
as funções do BIOS em vez de executá-lo. Verificado em três lugares:

- README do projeto: "The **HLE BIOS is built in**: no BIOS file to provide."
- `CREDITS.md`: "**No BIOS** — the emulator runs in **HLE** by default; nothing copyrighted
  is distributed here."
- O código do Play! não contém nenhuma referência a caminho de BIOS nas preferências
  padrão; `PS2VM.cpp` registra `rom0`, `mc0`, `mc1` e `cdrom0`, mas nenhum arquivo de BIOS.

Isto resolve o obstáculo jurídico mais sério do projeto: o usuário só precisa do disco.

### 2.6 Controles

Ponto que exigiu leitura do código do núcleo. O Play! **só lê teclado**, e apenas no
elemento `#outputCanvas`:

```c
// Source/ui_js/Main.cpp
emscripten_set_keydown_callback("#outputCanvas", nullptr, false, &keyboardCallback);
emscripten_set_keyup_callback("#outputCanvas", nullptr, false, &keyboardCallback);
```

O mapeamento padrão é definido em `Source/ui_js/Main.cpp`:

| Controle PS2 | `KeyboardEvent.code` |
|---|---|
| Cruz (✕) | `KeyZ` |
| Círculo (○) | `KeyX` |
| Quadrado (□) | `KeyA` |
| Triângulo (△) | `KeyS` |
| L1 / L2 / L3 | `Key1` / `Key2` / `Key3` |
| R1 / R2 / R3 | `Key8` / `Key9` / `Key0` |
| START / SELECT | `Enter` / `Backspace` |
| Direcional | `ArrowUp` / `ArrowDown` / `ArrowLeft` / `ArrowRight` |
| Analógico esquerdo X | `KeyF` (negativo) / `KeyH` (positivo) |
| Analógico esquerdo Y | `KeyT` (negativo) / `KeyG` (positivo) |
| Analógico direito X | `KeyJ` / `KeyL` |
| Analógico direito Y | `KeyI` / `KeyK` |

Consequência para este projeto: toque e controle físico **precisam ser traduzidos para
eventos de teclado** despachados no canvas. Não existe API de gamepad no núcleo.

### 2.7 Salvamento

O Play! registra `mc0` como **diretório**, não como imagem `.ps2`:

```c
// Source/PS2VM.cpp
iopOs->GetIoman()->RegisterDevice("mc0",
    std::make_shared<Iop::Ioman::CPreferenceDirectoryDevice>(PREF_PS2_MC0_DIRECTORY));
```

Portanto o cartão de memória é uma árvore de pastas e arquivos (cada salvamento é uma pasta
com `icon.sys`). Para persistir, é preciso copiar essa árvore para fora do sistema de
arquivos em memória e devolvê-la antes do próximo boot.

O projeto Lecteur PS2 converte essa árvore para o formato `.ps2` de 8 MiB do PCSX2 usando o
`ps2vmc-tool` compilado para WebAssembly (`ps2mc.wasm`), que é **GPL-3.0**.

Além disso, o build usado aqui expõe `saveState(path)` / `loadState(path)`: um estado de
salvamento do emulador inteiro, independente do salvamento interno do jogo.

### 2.8 Licenciamento

Este ponto foi decisivo e exige precisão.

| Componente | Licença | Consequência |
|---|---|---|
| **Play!** (`Play.js`, `Play.wasm`) | **BSD-2-Clause** | Pode ser redistribuído, com o aviso de copyright |
| `ps2mc.wasm` (`ps2vmc-tool`) | **GPL-3.0** | Contamina a distribuição combinada |
| Código original do Lecteur PS2 | **MIT** (dupla com GPL do repo) | Pode ser usado sob MIT |
| Repositório como um todo | **GPL-3.0** | Por causa do `ps2mc.wasm` |

O Play! é BSD-2-Clause e portanto livremente redistribuível, mantendo o aviso. O wrapper
original é oferecido sob MIT. **Apenas o `ps2mc.wasm` força o GPL.**

**Decisão tomada:** este projeto usa os binários do Play! (BSD-2-Clause) e **não** inclui o
`ps2mc.wasm`. Assim o projeto inteiro pode ser distribuído sob **MIT**, sem obrigação de
abrir o código de quem o reutilize. Em troca, abrimos mão da interoperabilidade direta com
o formato `.ps2` do PCSX2 e implementamos nosso próprio formato de pacote para o cartão de
memória.

### 2.9 Limitações

- **Desempenho.** O próprio README do Lecteur PS2 diz: "PS2 in a browser is heavy — expect
  'playable, not smooth' on recent iPhones, with occasional glitches."
- **Sem redução de resolução.** Confirmado no `CHANGELOG.md`: "Play!'s web renderer already
  runs at native resolution (its factor only upscales, no sub-native)". O fator de
  resolução só pode ser 1× ou 2×. Não existe modo sub-nativo.
- **Sem frameskip.** "there is no clean GS frameskip hook".
- **Sem alavanca mágica de desempenho.** O JIT da VU já emite SIMD128.

---

## 3. Tecnologia investigada 2: PS2 Web Recomp

Repositório: <https://github.com/snuri00/ps2-web-recomp>

### 3.1 O que é

Recompilação estática. O código de máquina do Emotion Engine é traduzido **antes da
execução** para C++, que é compilado para WebAssembly. A CPU principal nunca é
interpretada. O restante do console é emulado por um runtime que desenha com **WebGPU**.

Estado: 1.304 estrelas, licença MIT, 107 arquivos, 13 MB de código.

### 3.2 Como funciona

`scripts/port.sh` recebe uma imagem de disco e faz o trabalho completo:

1. Lê o programa de boot indicado em `SYSTEM.CNF` do disco.
2. Traduz o código de máquina para C++ com `eerecomp`.
3. Executa o jogo em modo headless algumas vezes para descobrir funções alcançadas por
   ponteiro que a análise estática não viu.
4. Registra os microprogramas da VU e os compila antecipadamente.
5. Compila a página e o executor nativo.

Requisitos: git, CMake, Ninja, compilador C++20, Python 3, 7-Zip. Na primeira execução
instala o Emscripten SDK. **Cerca de 300 MB de disco por jogo.** O processo leva cerca de
3,5 minutos em um notebook de 8 núcleos.

### 3.3 Por que foi rejeitado para este projeto

| Critério | Situação | Veredito |
|---|---|---|
| **Compatibilidade com GTA SA** | Só Gran Turismo 4 e God of War II foram comprovados. O README diz: "two games have been brought up so far. Another game will most likely stop at a system call or an IOP library function nobody implemented yet." | Não comprovada, provavelmente bloqueada |
| **Navegador móvel** | "The page needs WebGPU for the GPU renderer. Chrome and Edge have it on Windows and macOS." No Linux é desligado por padrão. A maioria dos navegadores Android **não tem WebGPU**. | **Bloqueador** |
| **Sem WebGPU** | "Without WebGPU the software renderer takes over, which is fine for menus and far too slow for 3D." | **Bloqueador** |
| **Arquitetura** | Exige compilar o disco do usuário na máquina dele, com toolchain nativa de ~300 MB por jogo. | Incompatível com "site estático, usuário só escolhe o arquivo" |
| **Distribuição legal** | "The generated C++ and the built WebAssembly are translations of the game's executable, so they belong to the game's owners: keep them on your own machine and do not publish them." | Não pode ser publicado |
| **Celular de 2 GB** | Compilação AOT local no celular é inviável. | **Bloqueador** |

O projeto é excelente e tecnicamente impressionante, mas resolve um problema diferente:
um usuário técnico, em um computador, portando um jogo específico. Não é o que este projeto
precisa.

**Conclusão:** rejeitado. A barreira do WebGPU em navegadores Android, sozinha, já o
desqualifica para a meta de 2 GB de RAM.

---

## 4. Alternativas adicionais consideradas

| Alternativa | Situação | Veredito |
|---|---|---|
| **PCSX2 compilado para WASM** | Não existe. Depende de JIT nativo por plataforma (x86-64/ARM64), de plugins nativos e de aceleração de GPU por Vulkan/D3D12. Nenhuma dessas peças tem equivalente direto no navegador. | Inviável |
| **Escrever um emulador de PS2 do zero** | Anos de trabalho. O próprio Play! é um projeto de mais de uma década. | Fora de escopo e sem sentido, já que existe alternativa livre |
| **Streaming remoto** | Exigiria um servidor com GPU, violaria a prioridade de execução local e criaria custo contínuo. | Rejeitado como solução principal; registrado como alternativa futura |
| **Versão de PC do jogo** | Não foi autorizado pelo usuário. | Rejeitado |

---

## 5. Compatibilidade com GTA: San Andreas

Esta é a parte que exige honestidade. Os dados vêm dos relatórios oficiais de
compatibilidade do projeto Play!.

### 5.1 Relatório oficial

- **Play-Compatibility #203** — `[SLUS-20946] Grand Theft Auto: San Andreas` (versão
  americana), estado **Ingame**, última atualização em 25/03/2022.
- **Play-Compatibility #432** — `[SLES-52541] Grand Theft Auto: San Andreas` (versão
  europeia), estado **Ingame**.

### 5.2 O que funciona

- Inicia e entra no jogo.
- "Able to start new game, load, and save without issue."
- Áudio funcionando: música, efeitos e vozes.
- Vídeos (FMV) são reproduzidos.

### 5.3 O que não funciona bem

- **Desempenho.** "Runs at 15-30fps with occasional momentary hitches down to 5-10fps as
  well as spikes up to 40fps" — em um desktop com i5-2500K e GTX 480.
- **Tempo de carregamento.** "Game spends 5-10 min loading ingame after intros".
- **Falhas visuais.** "Texture issues [path3masking?]" e "Discolored line ~2 pixels wide
  going top to bottom down the rightmost part of the screen".
- **Travamento conhecido.** Em builds antigas: "Play! crashes to desktop on the loading
  screen for Big Smoke". O relatório indica que parte disso foi resolvida com o merge do
  branch `gow` em 2019, mas não há confirmação para todas as versões.
- **Áudio em cutscene.** Dessincronização no início, com falas perdidas.
- **Celular.** Issue #963 do Play!: "GTA: San Andreas runs at 15 fps and sound keeps cutting
  out (iPad 6th generation)".
- **Celular Android.** Issue #486: em um Xperia Z5, travava poucos segundos após a
  cinemática. Um usuário relatou conseguir evitar olhando para a direita com o analógico
  direito.

### 5.4 Conclusão honesta

GTA: San Andreas **roda** no Play!, mas é um dos títulos mais pesados do catálogo. Em um
celular Android com 2 GB de RAM, a taxa de quadros ficará **abaixo de 30 FPS**, e a
experiência provavelmente será pior do que a relatada em desktop.

**Este projeto não testou o jogo em um celular físico.** Não temos o disco nem o aparelho.
O que podemos afirmar com evidência:

1. O núcleo do Play! carrega e inicializa no navegador. Verificado por teste automatizado.
2. O disco é entregue ao núcleo e lido em fluxo. Verificado por teste automatizado.
3. Os controles chegam ao núcleo com os códigos de tecla corretos. Verificado por teste.
4. GTA: San Andreas é classificado como "Ingame" pelo projeto Play!.

O que **não** podemos afirmar: a taxa de quadros real em um celular de 2 GB.

---

## 6. Decisão final

**Núcleo escolhido: Play!** (BSD-2-Clause), integrado diretamente.

| Critério | Play! | PS2 Web Recomp |
|---|---|---|
| Compatibilidade com GTA SA | **Ingame** (comprovada por relatórios) | Não comprovada |
| Desempenho em Android | Baixo, mas funcional | Bloqueado: exige WebGPU |
| Consumo de memória | Baixo (disco lido em fluxo) | Alto (código recompilado em memória) |
| Navegadores móveis | Chrome, Edge, Firefox, Safari 16.4+ | Só Chrome/Edge com WebGPU |
| Controles físicos | Sim, via tradução para teclado | Sim, API nativa de gamepad |
| Salvamento | Cartão de memória (diretório) + save states | Cartão de memória no navegador |
| Execução offline | Sim (PWA + Cache API + IndexedDB) | Sim, mas exige compilação local |
| Integração com Cloudflare Pages | Trivial (estático) | Impossível (compilação local) |
| Licenciamento | BSD-2-Clause | MIT |
| Complexidade para o usuário | Baixa: escolher um arquivo | Alta: toolchain nativa de 300 MB |
| Manutenção | Play! é ativo | Projeto recente, 2 jogos suportados |

**Decisão:** Play!, com os binários BSD-2-Clause obtidos do repositório Lecteur PS2,
proveniência registrada em `public/emulator/PROVENANCE.json` e verificada por script.

O `ps2mc.wasm` (GPL-3.0) **não** é incluído, para que o projeto permaneça MIT.

---

## 7. Reconstruir o núcleo

Os binários em `public/emulator/` são um build do Play! com um pequeno patch de frontend.
Para reconstruí-los do zero:

### 7.1 Pré-requisitos

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install 4.0.1 && ./emsdk activate 4.0.1
source ./emsdk_env.sh
```

### 7.2 Obter o Play! e aplicar o patch

```bash
git clone https://github.com/jpd002/Play-.git
cd Play-
git checkout 83700b2c31e593bc94e845b4b31b797be84dda59
git apply /caminho/para/public/emulator/patches/play-lecteur-ps2.patch
```

O patch adiciona, em `Source/ui_js/Main.cpp`:

- `saveState(path)` e `loadState(path)` — estados de salvamento.
- `setResolutionFactor(fator)` — resolução interna 1× ou 2×.
- `setFrameLimiter(ligado)` — limitador de quadros.
- `setDeinterlace(ligado)` — estabilização de campo, com a mudança correspondente em
  `Source/gs/GSHandler.{cpp,h}`.
- `getEeUsage()`, `getIopUsage()`, `getDrawCalls()` — instrumentação por quadro.

### 7.3 Compilar

```bash
mkdir build && cd build
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release -DBUILD_UI_JS=ON
emmake make -j$(nproc)
```

O resultado é `Play.js` e `Play.wasm`. Copie-os para `public/emulator/` e atualize os
hashes:

```bash
npm run verify:emulator -- --update
```

### 7.4 Verificar

```bash
npm run verify:emulator
```

O script confere os tamanhos, as assinaturas, os símbolos no WebAssembly e os hashes.

---

## 8. Referências

- Play! — <https://github.com/jpd002/Play-> (BSD-2-Clause)
- Play-Compatibility #203 (SLUS-20946) — <https://github.com/jpd002/Play-Compatibility/issues/203>
- Play-Compatibility #432 (SLES-52541) — <https://github.com/jpd002/Play-Compatibility/issues/432>
- Play! issue #486 (GTA SA, Europa) — <https://github.com/jpd002/Play-/issues/486>
- Play! issue #963 (GTA SA, 15 fps em iPad) — <https://github.com/jpd002/Play-/issues/963>
- Lecteur PS2 — <https://github.com/Rickow/lecteur-ps2>
- PS2 Web Recomp — <https://github.com/snuri00/ps2-web-recomp>
- Emscripten — <https://emscripten.org/>
