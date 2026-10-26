# Dependências e artefatos de terceiros

Este projeto **não tem dependências de execução**. Tudo o que o site precisa é compilado
para dentro de `dist/`. As dependências abaixo são usadas apenas durante o desenvolvimento.

## Binários distribuídos no build

| Componente | Versão | Licença | Onde |
|---|---|---|---|
| **Play!** (PlayStation 2 emulator) | build web do commit `83700b2`, Emscripten 4.0.1 | **BSD-2-Clause** | `public/emulator/Play.js`, `public/emulator/Play.wasm` |
| Aviso de copyright do Play! | — | — | `public/emulator/LICENSE-PLAY.txt` |
| Patch de frontend | — | MIT | `public/emulator/patches/play-lecteur-ps2.patch` |

O aviso de copyright exigido pela licença BSD de duas cláusulas é preservado integralmente e
também reproduzido em `LICENSE`.

Proveniência completa: `public/emulator/PROVENANCE.json`.
Verificação automatizada: `npm run verify:emulator`.

## Dependências de desenvolvimento

| Pacote | Versão | Licença | Uso |
|---|---|---|---|
| [vite](https://github.com/vitejs/vite) | ^6.0.3 | MIT | Compilação e servidor de desenvolvimento |
| [typescript](https://github.com/microsoft/TypeScript) | ^5.7.2 | Apache-2.0 | Verificação de tipos |
| [vitest](https://github.com/vitest-dev/vitest) | ^2.1.8 | MIT | Testes unitários |
| [jsdom](https://github.com/jsdom/jsdom) | ^25.0.1 | MIT | Ambiente DOM nos testes |
| [@playwright/test](https://github.com/microsoft/playwright) | ^1.49.0 | Apache-2.0 | Testes de navegador |
| [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped) | ^22.10.0 | MIT | Tipos do Node.js |

Nenhuma dessas dependências é distribuída no build de produção. Elas não impõem obrigações
sobre quem usa o site publicado.

## Componentes deliberadamente NÃO incluídos

| Componente | Licença | Motivo da exclusão |
|---|---|---|
| `ps2mc.wasm` ([ps2vmc-tool](https://github.com/bucanero/ps2vmc-tool)) | GPL-3.0 | Contaminaria a licença do projeto. Ver `docs/LEGAL-ASSETS.md`, seção 4. |
| Código gerado pelo PS2 Web Recomp | — | É uma tradução do executável do jogo, portanto pertence aos donos do jogo |
| Imagem de disco do jogo | — | Direitos autorais |
| BIOS do PlayStation 2 | — | Direitos autorais; e não é necessária, pois o Play! usa HLE BIOS |

## Componentes de terceiros dentro do Play!

O binário do Play! incorpora bibliotecas de terceiros. A lista abaixo vem da documentação
do projeto Play! e do `CREDITS.md` do Lecteur PS2. Todas são distribuídas dentro do
`Play.wasm` e não exigem ação adicional de quem usa este projeto.

| Componente | Licença | Uso dentro do Play! |
|---|---|---|
| Play!-CodeGen | BSD-2-Clause | JIT portátil; o backend WebAssembly emite SIMD128 |
| Play!-Framework | BSD-2-Clause | Framework base |
| [Emscripten](https://emscripten.org/) | MIT / NCSA | Toolchain C/C++ para WebAssembly |
| [libchdr](https://github.com/rtissera/libchdr) | BSD-3-Clause | Leitura de imagens CHD |
| [zstd](https://github.com/facebook/zstd) | BSD-3-Clause | Compressão |
| zlib | zlib | Compressão |
| bzip2 | bzip2 | Compressão |
| [nlohmann/json](https://github.com/nlohmann/json) | MIT | JSON |
| [SQLite](https://sqlite.org/) | Domínio público | Banco embutido |

## Como auditar

```bash
# Lista as dependências instaladas
npm ls --all

# Verifica a proveniência e a integridade dos binários do emulador
npm run verify:emulator

# Confirma que o build não contém arquivos proibidos
npm run build && npm run verify:dist
```

`verify:dist` falha se encontrar qualquer arquivo `.iso`, `.cso`, `.isz`, `.chd`, `.bin`,
`.ps2`, `.state`, `.env` ou cujo nome contenha "bios".
