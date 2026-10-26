# Arquivos legais e licenças

Este documento explica o que o usuário precisa fornecer, o que o projeto distribui e o que
não pode ser distribuído.

**Resumo:** este repositório não contém nenhum jogo, nenhuma BIOS e nenhum arquivo
proprietário. O usuário fornece a imagem do próprio disco. O código do projeto é MIT; os
binários do emulador são BSD-2-Clause.

---

## 1. O que o usuário precisa fornecer

### 1.1 Imagem de disco do jogo — obrigatório

| Item | Detalhe |
|---|---|
| **O que é** | Uma cópia do disco de PlayStation 2 de **Grand Theft Auto: San Andreas** |
| **Por que é necessário** | O emulador executa o jogo; o jogo não está incluído |
| **Formatos aceitos** | `.iso`, `.cso`, `.isz`, `.chd`, `.cue`+`.bin`, `.mds`+`.mdf`, `.elf` |
| **Tamanho típico** | 4 a 8 GB sem compressão |
| **Como obter legalmente** | Extraindo uma imagem do seu próprio disco físico, com ferramentas como `dd`, ImgBurn ou similar. A cópia é legal na maioria das jurisdições quando feita a partir de um disco que você possui, para uso pessoal. Verifique a lei do seu país. |
| **O que NÃO fazer** | Baixar de sites de ROMs, torrents ou qualquer fonte não autorizada. |

Identificadores conhecidos das versões:

| Região | Identificador | Relatório de compatibilidade do Play! |
|---|---|---|
| América do Norte | `SLUS-20946` | [#203](https://github.com/jpd002/Play-Compatibility/issues/203) |
| Europa | `SLES-52541` | [#432](https://github.com/jpd002/Play-Compatibility/issues/432) |

### 1.2 BIOS do PlayStation 2 — **não é necessário**

Este é um ponto importante. O Play! usa **HLE BIOS**: ele reimplementa as funções do BIOS
em alto nível, em vez de executá-lo. Verificado em três fontes independentes:

1. README do Lecteur PS2: *"The **HLE BIOS is built in**: no BIOS file to provide."*
2. `CREDITS.md`: *"**No BIOS** — the emulator runs in **HLE** by default; nothing copyrighted
   is distributed here."*
3. `PS2VM.cpp` do Play!: registra os dispositivos `rom0`, `host`, `mc0`, `mc1`, `cdrom0` e
   `hdd0`, mas nenhuma preferência aponta para um arquivo de BIOS.

**Você não precisa e não deve procurar um arquivo de BIOS.** A interface do projeto informa
isso explicitamente na lista de requisitos.

### 1.3 Nada mais

Não há arquivos auxiliares, chaves, licenças ou configurações adicionais a fornecer.

---

## 2. O que este repositório distribui

### 2.1 Código original do projeto

| Item | Licença |
|---|---|
| Todo o código em `src/`, `scripts/`, `tests/` | **MIT** |
| Documentação em `docs/` | **MIT** |
| Ícone em `public/icons/icon.svg` e os PNGs derivados | **MIT** (arte original) |

O ícone é uma arte original: um sol e duas palmeiras, criados para este projeto. Não é arte
promocional do jogo.

### 2.2 Binários do emulador

| Arquivo | Origem | Licença |
|---|---|---|
| `public/emulator/Play.js` | Build web oficial do Play! | **BSD-2-Clause** |
| `public/emulator/Play.wasm` | Build web oficial do Play! | **BSD-2-Clause** |
| `public/emulator/LICENSE-PLAY.txt` | Aviso de copyright original | — |
| `public/emulator/PROVENANCE.json` | Registro de proveniência | MIT |
| `public/emulator/patches/play-lecteur-ps2.patch` | Patch de frontend | MIT |

O aviso de copyright do Play! é preservado integralmente em
`public/emulator/LICENSE-PLAY.txt`, conforme exigido pela licença BSD de duas cláusulas:

> Copyright (c) 2006-2026, Jean-Philip Desjardins
> All rights reserved.
>
> Redistribution and use in source and binary forms, with or without modification, are
> permitted provided that the following conditions are met: [...]

A proveniência completa, incluindo o commit exato do Play! e a versão do Emscripten, está em
`public/emulator/PROVENANCE.json` e é verificada por `npm run verify:emulator`.

### 2.3 Dependências de desenvolvimento

Nenhuma delas é distribuída no build. São usadas apenas durante o desenvolvimento.

| Pacote | Licença | Uso |
|---|---|---|
| Vite | MIT | Compilação |
| TypeScript | Apache-2.0 | Verificação de tipos |
| Vitest | MIT | Testes unitários |
| Playwright | Apache-2.0 | Testes de navegador |

O projeto não tem dependências de execução. O `package.json` lista apenas
`devDependencies`: tudo o que o site precisa é compilado para dentro de `dist/`.

---

## 3. O que NÃO está incluído, e por quê

| Item | Motivo |
|---|---|
| Imagem de disco do jogo | Direitos autorais da Rockstar Games / Take-Two |
| BIOS do PlayStation 2 | Direitos autorais da Sony; além disso, **não é necessário** |
| Arte promocional do jogo | Direitos autorais; o projeto usa arte original |
| Músicas ou sons do jogo | Direitos autorais; vêm do disco do usuário |
| `ps2mc.wasm` (`ps2vmc-tool`) | **GPL-3.0**, contaminaria a licença do projeto. Ver a seção 4. |
| Código gerado pelo PS2 Web Recomp | É uma tradução do executável do jogo, portanto pertence aos donos do jogo |

---

## 4. A decisão sobre o `ps2mc.wasm`

O projeto Lecteur PS2 distribui um módulo WebAssembly, `ps2mc.wasm`, que converte entre a
árvore de arquivos do cartão de memória e a imagem `.ps2` de 8 MiB usada pelo PCSX2. Esse
módulo vem do **[ps2vmc-tool](https://github.com/bucanero/ps2vmc-tool)**, que é **GPL-3.0**.

Distribuí-lo junto com este projeto obrigaria todo o projeto a ser GPL-3.0.

**Decisão:** não incluir o `ps2mc.wasm`. Consequências:

| Ganho | Perda |
|---|---|
| O projeto permanece **MIT**, o que é mais útil para quem for reutilizá-lo | Não é possível importar nem exportar imagens `.ps2` do PCSX2 |
| Não há obrigação de abrir o código de trabalhos derivados | Não há compatibilidade direta com cartões de memória de outras ferramentas |
| Menos código de terceiros para auditar | — |

**Alternativa implementada:** o cartão de memória é persistido em um pacote JSON próprio
(`gta-memcard-bundle`), com validação de caminhos. Ele permite exportar, importar e migrar
entre dispositivos, o que cobre o caso de uso real. O que se perde é a interoperabilidade com
outros emuladores.

**Se você quiser interoperabilidade com o PCSX2:** é possível adicionar o `ps2mc.wasm`, mas
o projeto inteiro passa a ser GPL-3.0. A decisão é sua, e a licença precisa ser alterada em
consequência.

---

## 5. Marcas registradas

- **Grand Theft Auto** e **San Andreas** são marcas da Take-Two Interactive Software, Inc.
- **PlayStation** e **PS2** são marcas da Sony Interactive Entertainment Inc.
- **Rockstar Games** é uma marca da Take-Two Interactive Software, Inc.

Este projeto **não é afiliado, patrocinado nem endossado** pela Take-Two, pela Rockstar
Games ou pela Sony. As marcas são mencionadas apenas para descrever o que o software faz:
executar um jogo de PlayStation 2 fornecido pelo usuário.

A interface exibe este aviso de forma visível na tela inicial.

---

## 6. Responsabilidade do usuário

Ao usar este software, você concorda que:

1. A imagem de disco usada é uma cópia de um jogo que você **possui legalmente**.
2. Você é responsável por cumprir a legislação do seu país sobre cópias de segurança de
   mídia.
3. Você não vai distribuir a imagem do disco nem arquivos extraídos dela.
4. Os arquivos fornecidos por você **permanecem no seu aparelho**. O projeto não os envia
   para nenhum servidor.

Este último ponto é uma garantia técnica, não apenas uma promessa: não há código de upload
no projeto. A única comunicação de rede é o download dos arquivos do próprio site.

---

## 7. Como verificar estas afirmações

```bash
# 1. Confira as licenças presentes no repositório
ls -la LICENSE public/emulator/LICENSE-PLAY.txt

# 2. Confira a proveniência dos binários do emulador
cat public/emulator/PROVENANCE.json

# 3. Verifique os binários (tamanhos, assinaturas, símbolos, hashes)
npm run verify:emulator

# 4. Confirme que o build não contém arquivos proibidos
npm run build && npm run verify:dist
```

`verify:dist` recusa explicitamente qualquer arquivo com extensão `.iso`, `.cso`, `.isz`,
`.chd`, `.bin`, `.ps2`, `.state`, ou cujo nome contenha "bios". Se um arquivo proibido
chegar ao build, o comando falha.

---

## 8. Texto para quem for redistribuir

Se você publicar uma cópia deste projeto, precisa:

1. Manter o arquivo `LICENSE` (MIT).
2. Manter `public/emulator/LICENSE-PLAY.txt`, com o aviso de copyright do Play!.
3. Manter o aviso de marcas registradas na interface.
4. **Não** incluir imagem de disco, BIOS ou arquivos extraídos do jogo.
