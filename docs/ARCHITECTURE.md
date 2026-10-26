# Arquitetura

## Visão geral

O projeto é um aplicativo estático. Não há servidor de aplicação, banco de dados nem
backend. Tudo o que acontece roda no navegador do usuário, incluindo a emulação.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Navegador do usuário                                                 │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ Interface (src/ui)                                             │  │
│  │  Home · Painel lateral · Controles de toque · Toasts           │  │
│  └───────────────┬────────────────────────────────────────────────┘  │
│                  │ observa AppSnapshot                                │
│  ┌───────────────▼────────────────────────────────────────────────┐  │
│  │ Aplicação (src/app)                                            │  │
│  │  App · AppStateStore (máquina de estados) · fullscreen         │  │
│  └──┬────────┬─────────┬──────────┬──────────┬───────────────────┘  │
│     │        │         │          │          │                       │
│  ┌──▼───┐ ┌──▼────┐ ┌──▼─────┐ ┌──▼─────┐ ┌──▼──────┐                │
│  │files │ │emulad.│ │controls│ │ saves  │ │  pwa    │                │
│  └──┬───┘ └──┬────┘ └──┬─────┘ └──┬─────┘ └──┬──────┘                │
│     │        │         │          │          │                       │
│  ┌──▼────────▼─────────▼──────────▼──────────▼──────┐                │
│  │ storage (IndexedDB) · settings · utils           │                │
│  └──────────────────────────────────────────────────┘                │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ Web Worker do Emscripten                                       │  │
│  │  Play.wasm  ← EE · VU0/VU1 · IOP · GS · SPU2                   │  │
│  │      ▲                                                          │  │
│  │      │ discImageDevice.read(dest, offset, length)               │  │
│  │      └── blob.slice().arrayBuffer()  ← File do usuário          │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

Nenhum dado do usuário sai do aparelho. Não há telemetria, contas nem chamadas de rede
além do carregamento dos próprios arquivos do site.

---

## Camadas

### `src/app` — orquestração

| Arquivo | Responsabilidade |
|---|---|
| `app.ts` | Liga todos os subsistemas. Dono do fluxo de inicialização, de `loadCore()`, de `startGame()`, do salvamento e do ciclo de estatísticas. |
| `app-state.ts` | Declara cada estado da interface e as transições permitidas entre eles. |
| `app-state-store.ts` | Executa a máquina de estados e recusa transições não declaradas. |
| `fullscreen.ts` | Fullscreen API e Screen Orientation API, com tratamento de recusa. |

O `AppStateStore` é o guardião da honestidade da interface. Uma transição para `running`
sem passar por `verifying → loading-core → initializing → starting-game` é impossível: o
método `transition()` recusa e registra um erro no console. Foi assim que dois erros reais
foram encontrados durante o desenvolvimento.

### `src/emulator` — integração com o Play!

| Arquivo | Responsabilidade |
|---|---|
| `types.ts` | Contrato `EmulatorAdapter`. Isola o resto do projeto do núcleo escolhido. |
| `play-module.ts` | Tipagem do módulo Emscripten, limitada aos símbolos que usamos. |
| `play-adapter.ts` | Implementação. Carrega o núcleo, cria a VM, entrega o disco, coleta estatísticas, salva e restaura estados. |

Ponto crítico: `createDiscImageDevice()`. O núcleo chama `read()` de dentro do
WebAssembly e depois gira em `isDone()`. A leitura é assíncrona (`blob.slice`), então o
método retorna imediatamente e sinaliza a conclusão quando os bytes chegam. O disco nunca é
copiado inteiro para a memória.

O dispositivo também mantém contadores (`readCount`, `bytesRead`, `failedReads`), o que
permite provar, por teste, que a leitura é realmente incremental.

### `src/controls` — entrada

| Arquivo | Responsabilidade |
|---|---|
| `keymap.ts` | Tradução de botões PS2 para os códigos de tecla do núcleo. Verificado contra `Source/ui_js/Main.cpp` do Play!. |
| `input-bridge.ts` | Despacha `KeyboardEvent` no canvas, com contagem de referência por tecla. |
| `touch-pad.ts` | Controles na tela. Multitoque, captura de ponteiro, liberação em todos os caminhos. |
| `gamepad.ts` | Gamepad API: leitura por polling, detecção de conexão, conversão de eixos. |

Fluxo da entrada:

```
toque na tela  ─┐
                ├─→ InputBridge.press(code) ─→ KeyboardEvent(code) em #outputCanvas
controle físico ┘                                     │
                                                      ▼
                                          emscripten_set_keydown_callback
                                                      │
                                                      ▼
                                              CInputProviderEmscripten
                                                      │
                                                      ▼
                                                  controle PS2
```

A contagem de referência resolve um problema real: a mesma tecla pode ser mantida pelo
toque e pelo controle físico ao mesmo tempo. Soltar uma das fontes não pode soltar a tecla.

### `src/files` — arquivos do usuário

| Arquivo | Responsabilidade |
|---|---|
| `disc-formats.ts` | Reconhecimento e validação de ISO, CSO, ISZ, CHD, CUE, MDS, BIN e ELF. |
| `game-files.ts` | Monta o disco, guarda o `File` no IndexedDB e o recupera depois de recarregar. |

A validação lê apenas alguns pequenos intervalos, então funciona com arquivos de vários
gigabytes:

- ISO: procura o descritor `CD001` no setor 16 e o marcador `SYSTEM.CNF` nos primeiros 2 MB.
- CHD/CSO/ISZ: confere a assinatura.
- ELF: confere a assinatura e a arquitetura (precisa ser MIPS, `0x08`).
- CUE/MDS: confere a estrutura e avisa sobre o arquivo companheiro.

A validação **não** afirma que o jogo vai rodar. Ela afirma que o contêiner é utilizável.

### `src/saves` — persistência de progresso

| Arquivo | Responsabilidade |
|---|---|
| `save-states.ts` | Três slots de estado do emulador, em IndexedDB, com exportação e importação. |
| `memory-card.ts` | Captura e restaura a árvore `vfs/mc0` do sistema de arquivos em memória. |
| `backup.ts` | Backup completo em um arquivo JSON, com validação antes de gravar. |

Três mecanismos distintos, tratados separadamente:

1. **Salvamento do jogo** — feito pelo GTA em um cartão de memória virtual, dentro do jogo.
2. **Cartão de memória virtual** — a árvore `vfs/mc0`, capturada periodicamente e restaurada
   antes do boot.
3. **Estado de salvamento** — uma fotografia da máquina inteira, produzida pelo emulador.

A interface explica a diferença, porque confundi-los é a origem mais comum de "meu progresso
sumiu".

### `src/storage` — armazenamento

`idb.ts` encapsula IndexedDB. Quatro stores: `kv`, `files`, `savestates`, `memorycard`.

`localStorage` é usado apenas para as configurações, que são pequenas e precisam ser lidas
de forma síncrona na inicialização. Imagens de disco, cartões e estados **nunca** vão para
lá: o limite é de poucos megabytes.

### `src/pwa` — offline e instalação

| Arquivo | Responsabilidade |
|---|---|
| `sw.ts` | Service worker. Pré-cache do shell e do núcleo, com relato de progresso. |
| `service-worker.ts` | Registro, atualização e verificação de prontidão offline. |
| `install-prompt.ts` | `beforeinstallprompt` no Chromium; instruções manuais no Safari do iOS. |

O service worker **não** toca nos dados do usuário. Discos, cartões e estados estão no
IndexedDB, que não é acessível a partir dele.

### `src/settings` — configuração e detecção

`capabilities.ts` detecta o aparelho e decide se ele é compatível. Não confia apenas em
`navigator.deviceMemory`: testa WebAssembly, SIMD128, threads, WebGL2 e isolamento de
origem cruzada, e usa a memória apenas como uma dica entre várias.

### `src/utils` — base

`event-bus.ts`, `log-buffer.ts`, `format.ts`, `misc.ts`. Sem dependências externas.

---

## Fluxo de inicialização

```
boot()
  ├─ detectCapabilities()          → RAM, núcleos, SIMD, threads, WebGL2
  ├─ evaluateCompatibility()       → bloqueadores e avisos
  ├─ applyProfile()                → perfil sugerido, se o usuário não escolheu
  ├─ serviceWorker.register()      → pré-cache em segundo plano
  ├─ gameFiles.restore()           → disco guardado da sessão anterior
  └─ estado: incompatible | awaiting-files
```

## Fluxo de INICIAR JOGO

```
startGame()
  ├─ verifica disco presente e aparelho compatível
  ├─ loadCore()
  │    ├─ fetch Play.wasm, com progresso real em MB
  │    ├─ importa Play.js
  │    ├─ instancia o módulo Emscripten
  │    ├─ ccall('initVm')        ← dentro do gesto do usuário (exigência do iOS)
  │    └─ estado: initializing
  ├─ memoryCard.restore()          → devolve a árvore mc0 antes do boot
  ├─ watchForBootFailure()         → observa as mensagens do núcleo
  ├─ estado: starting-game
  ├─ adapter.boot({ file, name })
  │    ├─ cria o discImageDevice
  │    ├─ module.discImageDevice = device
  │    └─ bootDiscImage(name)      → o núcleo passa a ler o disco em fluxo
  └─ aguarda o primeiro quadro
       ├─ getFrames() > 0  → estado: running, controles aparecem
       └─ "Failed to start" → estado: error, com a mensagem do núcleo
```

Nenhum passo é simulado. O estado `running` só é atingido quando o núcleo realmente
renderiza um quadro.

---

## Decisões de projeto

### Por que não usar um framework de interface

A interface é pequena e o emulador já consome CPU e memória. Um framework acrescentaria
centenas de kilobytes e trabalho de reconciliação durante o jogo. A renderização é feita a
partir de um `AppSnapshot` imutável, o que dá a mesma garantia de consistência com custo
muito menor.

### Por que o canvas fica sempre montado

O contexto WebGL2 pertence ao elemento. Recriá-lo a cada troca de tela significaria recriar
a VM. O canvas permanece no DOM, atrás da tela inicial.

### Por que a tradução de entrada passa pelo teclado

O núcleo do Play! não expõe API de entrada: ele registra callbacks de teclado no canvas.
Traduzir para eventos de teclado é a única forma de enviar comandos, e é o que o próprio
projeto Lecteur PS2 faz. Verificado no código do núcleo, não presumido.

### Por que não incluir o `ps2mc.wasm`

Ele é GPL-3.0 e tornaria todo o projeto GPL-3.0. O custo é perder a leitura de imagens
`.ps2` do PCSX2. O benefício é manter o projeto sob MIT, o que é mais útil para quem for
reutilizá-lo. Ver `docs/LEGAL-ASSETS.md`.

### Por que as transições de estado são validadas

Porque foi assim que dois erros reais apareceram. O teste automatizado
`tests/unit/app-state.test.ts` verifica que toda transição declarada aponta para um estado
existente, e que não é possível chegar a `running` sem ter verificado um disco.
