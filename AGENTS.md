# AGENTS.md — contexto do projeto Gta

Memória persistente do repositório. Leia antes de trabalhar.

## O que é

`Gta` — shell web (PWA, TypeScript + Vite, estático, Cloudflare Pages) que executa
**Grand Theft Auto: San Andreas de PlayStation 2** no navegador do celular usando o
emulador **Play!** compilado para WebAssembly.

Nenhum jogo, BIOS ou arquivo proprietário é distribuído. O usuário fornece o próprio
dump legal.

## Fatos verificados (não re-descobrir)

- **Emulador escolhido:** Play! (`jpd002/Play-`), BSD-2-Clause. Build web Emscripten.
- **BIOS:** Play! usa **HLE BIOS** → **não exige arquivo de BIOS**. Confirmado no
  README/CREDITS do `Rickow/lecteur-ps2` e no código (`HLE` por padrão).
- **Binários usados:** `public/emulator/Play.js` + `Play.wasm`, vindos de
  `Rickow/lecteur-ps2` (repo GPL-3.0, mas os binários são BSD-2-Clause + patch MIT).
  Upstream Play! commit `83700b2c31e593bc94e845b4b31b797be84dda59`, Emscripten 4.0.1.
  Proveniência e patch em `public/emulator/`.
- **Threads:** build *threaded* → exige **cross-origin isolation**
  (`COOP: same-origin`, `COEP: require-corp`, `CORP: same-origin`) e MIME
  `application/wasm`. Sem isso `SharedArrayBuffer` não existe e o core não sobe.
- **Formatos de disco:** `.iso .cso .isz .chd .elf` (+ cue/mds). Leitura em streaming
  via `blob.slice` (device customizado) — **não carrega o disco inteiro em RAM**.
- **Play! só lê teclado** no `#outputCanvas` (Emscripten key callbacks). Toda entrada
  (toque, gamepad) é traduzida para `KeyboardEvent` com o campo `code`.
- **Mapeamento de teclas (autoritativo, de `Source/ui_js/Main.cpp`):**
  `KeyZ`=CROSS(X), `KeyX`=CIRCLE(O), `KeyA`=SQUARE(□), `KeyS`=TRIANGLE(△),
  `Key1`=L1, `Key2`=L2, `Key3`=L3, `Key8`=R1, `Key9`=R2, `Key0`=R3,
  `Enter`=START, `Backspace`=SELECT,
  `ArrowUp/Down/Left/Right`=D-pad,
  `KeyF/KeyH`=LX-, LX+, `KeyT/KeyG`=LY-, LY+, `KeyJ/KeyL`=RX-, RX+, `KeyI/KeyK`=RY-, RY+.
- **API JS do core:** `ccall('initVm')`, `bootDiscImage(name)`, `bootElf(name)`,
  `getFrames()`, `clearStats()`, `saveState(path)`, `loadState(path)`,
  `setResolutionFactor(1|2)`, `setFrameLimiter(bool)`, `setDeinterlace(bool)`,
  `getEeUsage()`, `getIopUsage()`, `getDrawCalls()`, `FS` (MEMFS), `discImageDevice`.
- **Cartão de memória:** Play! registra `mc0` como **diretório** (`vfs/mc0`), não como
  imagem `.ps2`. O `.ps2` (8 MiB) do PCSX2 é outro formato (superblock/FAT/ECC).
- **Compatibilidade GTA SA:** Play-Compatibility #203 (SLUS-20946) e #432 (SLES-52541)
  → estado **"Ingame"**: inicia, carrega e salva; **lento** (15–30 fps em desktop
  i5-2500K + GTX 480), 5–10 min para entrar no jogo, glitches de textura
  (path3masking), travamento conhecido na tela de carregamento da missão Big Smoke em
  builds antigas. **Não afirmar 30 fps no celular.**
- **ps2-web-recomp (`snuri00`):** MIT, WebGPU, recompilação estática por jogo. Rejeitado
  para este caso: exige recompilar o disco do usuário (AOT, ~300 MB/jogo, Emscripten) e
  **WebGPU**, indisponível na maioria dos navegadores Android; só GT4/GoW2 comprovados.
- **GitHub:** o token disponível **não** tem permissão para criar repositórios
  (`Resource not accessible by integration`). Publicação remota é passo manual do usuário.

## Comandos

```bash
npm install
npm run dev            # dev server (já envia COOP/COEP)
npm run build          # dist/ pronto para Cloudflare Pages
npm run preview        # serve dist/ com os headers corretos
npm run test           # vitest (unitário)
npm run test:e2e       # playwright
npm run verify:emulator
npm run typecheck
```

## Estado final verificado (2026-10-26)

- `npm run check` → exit 0 (verify:emulator → typecheck → 88 unit → build → verify:dist)
- `npx playwright test` → 24/24 passando no Chromium (Pixel 7 emulado)
- Build: 3,02 MB total, 18 arquivos. Núcleo `Play.wasm` = 2,57 MB.
- Repositório local: 81 arquivos, branch `main`, 2 commits. **Sem remote.**

### Erros reais encontrados e corrigidos (não repetir)

1. **Transições de estado ilegais.** `booting → loading-core` e
   `awaiting-files → initializing` não estavam declaradas. Só apareceram ao executar o
   fluxo real no navegador. A máquina de estados agora permite
   `awaiting-files → {verifying, loading-core, initializing, incompatible, error}`.
2. **Recursão infinita no observador de falha de boot.** O observador registrava
   `"O emulador não conseguiu carregar o disco: …"` e o próprio texto casava com o padrão,
   gerando milhares de linhas. Correção: cancelar a inscrição **antes** de registrar, com
   uma flag `stopped`, e usar um padrão que só casa com as mensagens do núcleo
   (`CORE_BOOT_FAILURE_PATTERN`).
3. **`jsdom` não implementa `Blob.prototype.slice().arrayBuffer()`.** `tests/setup.ts`
   instala o `Blob`/`File` nativos do Node sobre o `globalThis`. Sem isso, todos os testes
   de formato de disco falham.
4. **`WebAssembly.validate` rejeita views de `SharedArrayBuffer`.** Copiar para um
   `ArrayBuffer` comum antes de validar (`src/settings/capabilities.ts`).
5. **`Play.js` não contém os nomes das funções embind.** Eles vivem no registro embind
   dentro do `Play.wasm`. O verificador precisa procurar em ambos: `initVm`/`ccall`/
   `em-pthread` no `.js`, e `bootDiscImage`/`saveState`/etc. no `.wasm`.
6. **O núcleo reporta falha de boot imprimindo, não lançando.** Sem
   `App.watchForBootFailure()`, a interface esperaria quadros que nunca chegam.

### Fatos que exigem cuidado

- `initVm()` **precisa** ser chamado dentro de um gesto do usuário (exigência do iOS).
- O canvas `#outputCanvas` **nunca** deve ser desmontado: o contexto WebGL2 pertence a ele.
- `public/_headers` é obrigatório. Sem COOP/COEP não há `SharedArrayBuffer`.
- Testar em celular físico exige HTTPS (túnel) porque `http://` por IP não é contexto
  seguro no Android.
- O token de GitHub deste ambiente autentica como `Souzzaaxzy` mas **não** tem a permissão
  `CreateRepository` (403 / "Resource not accessible by integration"). Criação de
  repositório é passo manual do usuário.
