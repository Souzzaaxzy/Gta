# Ambiente e configuração

Este arquivo documenta como trabalhar neste repositório. Ele é carregado automaticamente
por agentes de código.

Para o contexto do projeto em si, leia [`AGENTS.md`](AGENTS.md).

## Comandos essenciais

```bash
npm install
npm run dev            # servidor de desenvolvimento (já envia COOP/COEP)
npm run build          # build de produção em dist/
npm run preview        # serve dist/ com os cabeçalhos corretos
npm run test           # 88 testes unitários
npm run test:e2e       # 24 testes de navegador (exige Chromium instalado)
npm run check          # tudo: verificação, tipos, testes, build, verificação do build
```

## Antes de commitar

Rode `npm run check`. Ele executa, em ordem:

1. `verify:emulator` — confere os binários do núcleo e os hashes registrados.
2. `typecheck` — verificação de tipos.
3. `test` — testes unitários.
4. `build` — build de produção.
5. `verify:dist` — confere o build e recusa arquivos proibidos.

## Estilo de código

- TypeScript estrito. `noUnusedLocals` e `noUnusedParameters` estão ligados.
- Sem dependências de execução. O `package.json` tem apenas `devDependencies`.
- Sem framework de interface. A renderização vem de um `AppSnapshot` imutável.
- Comentários apenas quando o código expressa algo não óbvio: uma invariante, uma exigência
  do navegador, uma restrição do núcleo. Não narre o que o código já diz.
- Identificadores em inglês. Texto da interface e comentários explicativos em português.
- Erros sempre tratados e explicados ao usuário. Nunca engolir uma exceção em silêncio.

## Regras que não podem ser quebradas

1. **Nunca incluir jogo, BIOS ou arquivo proprietário.** O `.gitignore` bloqueia as
   extensões. `verify:dist` também recusa.
2. **Nunca usar `localStorage` para dados grandes.** Discos, cartões e estados vão para o
   IndexedDB. `localStorage` é só para as configurações.
3. **Nunca afirmar que algo funciona sem verificar.** Se não foi testado, documente como não
   testado. O `docs/MOBILE-TESTING.md` classifica cada funcionalidade.
4. **Nunca fingir progresso.** O estado `running` só é atingido quando o núcleo realmente
   renderiza um quadro.
5. **Sempre liberar os botões** ao perder foco, trocar de aba ou receber interrupção.
6. **Nunca incluir código GPL.** O projeto é MIT. O `ps2mc.wasm` é GPL-3.0 e está
   deliberadamente ausente.

## Pontos delicados

### O núcleo só aceita teclado

O Play! registra callbacks de teclado no `#outputCanvas`. Não existe API de gamepad no
núcleo. Toque e controle físico são traduzidos para `KeyboardEvent`. O mapeamento está em
`src/controls/keymap.ts` e é verificado por teste contra `Source/ui_js/Main.cpp` do Play!.

### `initVm()` precisa de um gesto do usuário

No Safari do iOS, criar o contexto WebGL fora de um gesto produz um contexto inválido.
`initVm()` é chamado dentro do manipulador do clique em INICIAR JOGO. Não mova essa chamada
para fora do gesto.

### O núcleo não lança exceções ao falhar

Quando o Play! não consegue montar ou iniciar um disco, ele **imprime** e retorna. O
`App.watchForBootFailure()` observa essas mensagens. Se o padrão mudar numa atualização do
núcleo, o teste `disc-boot.spec.ts` falha.

### Isolamento de origem cruzada

Sem `COOP: same-origin` e `COEP: require-corp`, `SharedArrayBuffer` não existe e o núcleo não
inicia. Os cabeçalhos estão em `public/_headers` (produção) e em `vite.config.ts` (servidores
locais). Se você adicionar um servidor novo, precisa repeti-los.

### O canvas fica sempre montado

O contexto WebGL2 pertence ao elemento. Recriá-lo significa recriar a VM. Não desmonte o
`#outputCanvas`.

### Atualizar os binários do núcleo

Depois de trocar `public/emulator/Play.js` ou `Play.wasm`:

```bash
npm run verify:emulator -- --update
npm run test
```

O primeiro comando grava os novos hashes em `PROVENANCE.json`. O segundo confirma que o
núcleo continua expondo `bootDiscImage` e `saveState`.

## Estrutura

Ver [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Mantenha a separação entre `ui/`,
`emulator/`, `controls/`, `storage/`, `saves/`, `files/`, `pwa/`, `settings/` e `utils/`.
Não coloque lógica de emulação na interface nem lógica de interface no adaptador.
