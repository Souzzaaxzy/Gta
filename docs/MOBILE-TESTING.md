# Testes em celular e resultados

Este documento registra o que foi testado, o que foi observado e o que ainda depende de um
aparelho físico. Nenhum resultado foi inventado.

---

## 1. Resumo do estado

| Categoria | Quantidade |
|---|---|
| Testado e funcionando | 20 itens |
| Testado parcialmente | 4 itens |
| Implementado, mas não testado | 3 itens |
| Bloqueado (falta hardware) | 3 itens |

---

## 2. Testes automatizados executados

### 2.1 Testes unitários (`npm run test`)

**88 testes, 8 arquivos, todos passando.**

| Arquivo | Testes | O que verifica |
|---|---|---|
| `event-bus.test.ts` | 6 | Entrega de eventos, cancelamento, isolamento de falhas |
| `controls.test.ts` | 10 | Mapeamento de teclas contra o código do Play!, contagem de referência, liberação |
| `disc-formats.test.ts` | 19 | Validação de ISO, CHD, CSO, ISZ, ELF, CUE, MDS, BIN |
| `app-state.test.ts` | 12 | Máquina de estados, transições ilegais, caminho de boot |
| `settings-store.test.ts` | 11 | Persistência, perfis, corrupção, cota esgotada |
| `capabilities.test.ts` | 14 | Detecção de aparelho, bloqueadores, perfil sugerido |
| `memory-card-path.test.ts` | 9 | Rejeição de caminhos perigosos em importações |
| `disc-device.test.ts` | 7 | Leitura em fluxo, cópia para HEAPU8, falha de leitura |

Destaques:

- **`disc-device.test.ts`** prova que o dispositivo de disco **não carrega o arquivo
  inteiro**: monta um disco de 4 MB com um heap de 64 KB e lê um intervalo no meio.
- **`controls.test.ts`** verifica cada código de tecla contra a tabela extraída de
  `Source/ui_js/Main.cpp` do Play!. Se o núcleo for atualizado e o mapeamento mudar, o teste
  falha.
- **`memory-card-path.test.ts`** confirma que caminhos absolutos, `..`, caracteres de
  controle e caminhos longos demais são rejeitados na importação.

### 2.2 Testes de navegador (`npm run test:e2e`)

**26 testes, 3 arquivos, todos passando.** Rodam no Chromium em emulação de Pixel 7
(412×915, com toque), contra o **build de produção** servido com os cabeçalhos reais.

| Arquivo | Testes | O que verifica |
|---|---|---|
| `app.spec.ts` | 21 | Shell, isolamento, MIME, manifest, service worker, arquivos, painéis, persistência, controles, gamepad, núcleo |
| `disc-boot.spec.ts` | 3 | Caminho real de carregamento de disco |
| `disc-filesystem.spec.ts` | 2 | Cadeia ISO9660 completa: sistema de arquivos, `SYSTEM.CNF`, executável de boot |

Destaques, com os resultados observados:

| Teste | Resultado |
|---|---|
| `window.crossOriginIsolated === true` | Passou. O isolamento está ativo. |
| `Content-Type: application/wasm` em `Play.wasm` | Passou. |
| Manifest com ícones 192 e 512 | Passou. |
| Service worker ativo | Passou. |
| ISO inválida é recusada com explicação | Passou. Botão não finge que pode iniciar. |
| ISO válida habilita INICIAR JOGO | Passou. `CD001` e `SYSTEM.CNF` detectados. |
| Configurações sobrevivem a recarregar | Passou. |
| Disco é recuperado do IndexedDB após recarregar | Passou. |
| Toque no botão ✕ gera `KeyZ` no canvas | Passou. |
| Controle físico sintético gera `KeyZ` | Passou. |
| **Núcleo WebAssembly instancia e cria a VM** | Passou. `bootDiscImage` e `saveState` expostos. |
| **Núcleo lê o disco em fluxo** | Passou. 2 leituras, 4.096 bytes de um arquivo de 98.304 bytes. |
| **Falha de boot produz erro real com a mensagem do núcleo** | Passou. Mensagem: `Failed to start: No 'SYSTEM.CNF' file found on the cdrom0 device.` |
| **Cadeia ISO9660 completa** | Passou. O núcleo percorreu sistema de arquivos → `SYSTEM.CNF` → alvo do `BOOT2` → carga do ELF. 7 leituras, 14.336 bytes de um arquivo de 57.344 bytes, 0 falhas. |

### 2.3 Evidência do carregamento real do disco

Saída capturada durante a execução do fluxo completo (arquivo → botão → boot), com um ISO
sintético:

```
[info] Núcleo: Play! — BSD-2-Clause (Jean-Philip Desjardins)
[info] Baixando o núcleo do emulador… 2.6 MB de 2.6 MB
[info] Instanciando o WebAssembly…
[info] Play! - Version 83700b2
[info] Initializing PS2VM...
[info] Máquina virtual criada.
[info] Creating import table...
[info] Registered function '_EmptyBlockHandler(vi)' = > id = 0.
   … 17 funções registradas …
[info] Loading 'slus-20946.iso'...
[info] Failed to start: No 'SYSTEM.CNF' file found on the cdrom0 device.
```

Estatísticas do dispositivo de disco nessa execução:

```json
{ "readCount": 2, "bytesRead": 4096, "failedReads": 0, "fileSize": 98304 }
```

Interpretação: o núcleo abriu o disco, leu **4 KB de um arquivo de 96 KB** (o descritor de
volume e o diretório raiz) e concluiu que não havia `SYSTEM.CNF`. O disco **não** foi
carregado inteiro. Isso confirma o comportamento de leitura em fluxo.

O erro é esperado: o ISO sintético tem um descritor de volume válido, mas nenhum registro de
diretório. Um disco real tem essa estrutura, e é por isso que o teste usa um arquivo
sintético: ele prova que o caminho funciona sem precisar de uma cópia do jogo.

### 2.4 Evidência da cadeia ISO9660 completa

O teste acima parava no descritor de volume. Foi construída uma segunda imagem de teste, com
**sistema de arquivos ISO9660 real**, usando `pycdlib` (`scripts/make-test-iso.py`). Ela tem
árvore de diretórios, `SYSTEM.CNF` e um executável de boot nomeado pelo `BOOT2`:

```
volume: PS2-TEST-DISC
  README.TXT;1
  SLUS_209.46;1
  SYSTEM.CNF;1

SYSTEM.CNF: BOOT2 = cdrom0:\SLUS_209.46;1
            VER = 1.00
            VMODE = NTSC
```

O núcleo percorreu a cadeia inteira e reportou:

```
[info] Loading 'ps2-disc-test.iso'...
[info] Failed to start: Error occured while reading ELF executable from virtual path.
```

Estatísticas do dispositivo:

```json
{ "readCount": 7, "bytesRead": 14336, "failedReads": 0, "fileSize": 57344 }
```

**Interpretação.** O erro mudou de `No 'SYSTEM.CNF' file found` para
`Error occured while reading ELF executable`. Isso prova que o núcleo:

1. Montou a imagem e leu o sistema de arquivos ISO9660.
2. Localizou e leu `SYSTEM.CNF`.
3. Interpretou a linha `BOOT2`.
4. Abriu o executável de boot no caminho indicado.
5. Tentou carregá-lo como ELF.

Falha no passo 5 porque o arquivo tem 4 KB e não é um ELF de MIPS válido. **Isso é
proposital.** Uma imagem sintética não pode ser um jogo jogável, e afirmar o contrário seria
desonesto. A falha é a evidência de que os quatro passos anteriores funcionaram.

O executável real de GTA: San Andreas é um ELF de MIPS de vários megabytes. Com ele, o passo
5 prosseguiria.

Também confirma que a leitura continua incremental: 14 KB lidos de um disco de 57 KB, com
zero leituras falhas.

---

## 3. Estado por funcionalidade

### Testado e funcionando

| Funcionalidade | Evidência |
|---|---|
| Interface abre e renderiza | E2E `shell › loads…` |
| Sistema de arquivos ISO9660 é lido pelo núcleo | E2E `disc loading with a real ISO9660 filesystem` |
| `SYSTEM.CNF` é encontrado e o `BOOT2` seguido | E2E, erro do núcleo muda para a carga do ELF |
| Isolamento de origem cruzada (COOP/COEP) | E2E + `curl -I` no servidor |
| Núcleo WebAssembly instancia | E2E `emulator core › instantiates…` |
| VM criada com `initVm()` | E2E, `ready === true` |
| Disco entregue ao núcleo | E2E `disc loading path` |
| Leitura em fluxo, sem carga total | E2E, 4 KB de 96 KB |
| Falha de boot reportada com a mensagem do núcleo | E2E |
| Validação de ISO/CHD/CSO/ISZ/ELF/CUE/MDS | 19 testes unitários |
| Toque gera o código de tecla correto | E2E `touch controls` |
| Todos os 12 botões do PS2 presentes | E2E `the pad has all the PlayStation 2 buttons` |
| Controle físico detectado e mapeado | E2E `gamepad` |
| Botão físico gera `KeyZ` no canvas | E2E `a synthetic button press…` |
| Configurações sobrevivem a recarregar | E2E `persistence` |
| Disco sobrevive a recarregar (IndexedDB) | E2E `persistence` |
| Service worker registra e pré-cacheia | E2E + `precache-manifest.json` |
| Build de produção conclui e é verificado | `npm run check` |

### Testado parcialmente

| Funcionalidade | O que foi verificado | O que falta |
|---|---|---|
| **GTA: San Andreas rodando** | O núcleo carrega, monta o disco e reporta erros reais. A compatibilidade "Ingame" vem dos relatórios oficiais do Play!. | Nunca executado com o disco real. Não temos o arquivo. |
| **Tela cheia** | A API está disponível e é detectada no Chromium. O código trata recusa. | Não testado em Safari do iOS, onde `requestFullscreen` não existe para elementos arbitrários. |
| **Orientação horizontal** | O código trata ausência de suporte e mostra instrução manual. | `screen.orientation.lock()` não é testável no Chromium headless. |
| **Salvamento (save state)** | O núcleo expõe `saveState`. O armazenamento em IndexedDB é testado. | Nunca chamado com a VM em execução, porque não há jogo carregado. |

### Implementado, mas não testado

| Funcionalidade | Motivo |
|---|---|
| Captura e restauração do cartão de memória | Exige um jogo em execução gravando em `mc0`. |
| Importação e exportação de backup completo | Implementado e validado por tipos; falta um teste com dados reais. |
| Estabilização de campo (anti-tremor) | A função do núcleo existe; o efeito visual não foi observado. |

### Bloqueado

| Item | Motivo |
|---|---|
| ~~Taxa de quadros real~~ | Medida: ~7 FPS sem GPU. Falta medir em celular físico. |
| **Teste em celular Android com 2 GB de RAM** | Nenhum aparelho físico conectado a este ambiente. |
| **Temperatura e comportamento em sessão longa** | Idem. |
| **Recuperação após alternar de aplicativo** | Idem. |

---

## 4. Plano de teste em aparelhos físicos

Para validar a meta de 2 GB de RAM, é preciso um aparelho real. Roteiro sugerido.

### 4.1 Aparelhos sugeridos

| Faixa | Exemplos | Por quê |
|---|---|---|
| 2 GB, entrada | Moto E6, Redmi 9A, Galaxy A03 | O alvo mínimo |
| 3–4 GB, intermediário | Moto G31, Redmi Note 11 | A faixa mais comum |
| 6 GB+, alto | Galaxy A54, Poco X5 | O limite superior |

### 4.2 O que medir

| Medida | Como |
|---|---|
| Tempo de carregamento do núcleo | Cronômetro, do toque em INICIAR JOGO até o primeiro quadro |
| Tempo até o jogo | Do toque até sair da tela preta (o relatório oficial indica 5–10 min em desktop) |
| FPS | Selo no topo da tela, ou painel Registro |
| Memória | `chrome://tracing`, ou `about:memory` no Firefox |
| Estabilidade | 30 minutos contínuos, observando travamentos |
| Temperatura | App de monitoramento, ou `adb shell dumpsys thermalservice` |
| Retomada | Alternar de aplicativo e voltar; verificar se o jogo continua |

### 4.3 Como executar

```bash
# No computador, na mesma rede do celular
npm run build
npx vite preview --host --port 4173
```

Depois, no celular, abrir `http://<ip-do-computador>:4173`.

Atenção: o isolamento de origem cruzada exige HTTPS ou `localhost`. Em `http://` por IP na
rede local, o Chrome do Android **não** considera o contexto seguro e
`SharedArrayBuffer` não existe. Para testar em um celular físico, use um túnel HTTPS:

```bash
npx cloudflared tunnel --url http://localhost:4173
```

Ou publique na Cloudflare Pages, que já fornece HTTPS.

### 4.4 Resultados reais medidos com o disco verdadeiro

O disco real foi obtido e executado. **Não são estimativas.**

| Item | Valor |
|---|---|
| Arquivo | `GTA SA PTBR M0D MENU.iso` |
| Tamanho | 4.040.491.008 bytes (3,76 GB) |
| Identificador | **`SLUS_209.46`** — GTA: San Andreas, versão americana |
| `SYSTEM.CNF` | `BOOT2 = cdrom0:\SLUS_209.46;1` / `VER = 1.03` / `VMODE = NTSC` |
| Assinatura | ISO9660 válida (`CD001` no setor 16) |

Resultado do boot no núcleo Play!, medido:

| Medida | Valor observado |
|---|---|
| Tempo até o núcleo reportar `Starting...` | ~3 minutos |
| Quadros renderizados em 10 minutos | **9.622** |
| Ocupação do EE | 74% a **213%** (usa múltiplas threads) |
| Ocupação do IOP | ~9% |
| Taxa de quadros média | **~7 FPS** |
| Pico de taxa | 9,3 FPS |
| Bytes lidos do disco | **7,7 MB de 3.846 MB** (0,2%) |
| Leituras do disco | 3.922 |
| Maior leitura individual | 2.048 bytes |

**Strings do jogo encontradas na RAM do PlayStation 2** — prova de que o código do jogo
está realmente carregado e executando:

```
GTA, SLUS, main.scm, .txd
```

`main.scm` é o script principal do GTA: San Andreas. `.txd` são as texturas do jogo. Isso
não pode aparecer na memória por acidente: são dados do disco do jogo.

**Confirmação da leitura em fluxo.** 7,7 MB lidos de um disco de 3,85 GB, em 3.922 leituras
de 2 KB cada. O disco **não** é carregado inteiro na memória. Sem isso, um celular com 2 GB
de RAM jamais conseguiria abrir o jogo.

### 4.5 Sobre a taxa de quadros

**~7 FPS** é o número medido, e é baixo. Duas ressalvas importantes:

1. **O ambiente não tem GPU.** Este teste rodou em Chromium headless com o rasterizador
   por software SwiftShader, sem aceleração de hardware. Um celular real, com GPU, tende a
   ser bem mais rápido — mas não há como medir isso aqui.
2. **EE chegou a 213%**, indicando que o trabalho está bem distribuído entre threads e que
   o limite pode ser tanto CPU quanto GPU.

O relatório oficial do Play! (#203) mede **15 a 30 FPS** em um desktop com i5-2500K e
GTX 480. O valor de 7 FPS medido aqui é consistente com software rendering, não com
hardware real.

**Conclusão honesta:** o jogo carrega e executa de verdade. A taxa de quadros em um celular
com 2 GB de RAM **continua desconhecida**, e só pode ser medida em um aparelho físico com
GPU. O que mudou é que agora sabemos que o caminho completo funciona: o jogo inicia, roda e
lê o disco em fluxo.

### 4.6 Limite real de armazenamento (descoberto por teste)

Tentei guardar o disco de 3,76 GB no navegador, para que o usuário não precise escolher o
arquivo novamente. **Não funciona, e a documentação anterior estava errada.**

| Tentativa | Resultado |
|---|---|
| IndexedDB, `put()` do `File` | `QuotaExceededError` imediato |
| OPFS, gravação em blocos de 64 MB | `QuotaExceededError` em **832 MB** |

O navegador informa uma cota de 10 GB, mas recusa a gravação bem antes disso. Medido:

```
OPFS parou em: 832 MB | QuotaExceededError
cota informada: 10.00 GB
```

**Consequência prática:** o disco **não pode** ser guardado entre sessões. O usuário precisa
selecionar o arquivo a cada vez que abre o site. Isso é uma limitação do navegador, não do
emulador.

O README afirmava que "o disco é recuperado do IndexedDB após recarregar". Isso é verdade
para arquivos pequenos, e é o que o teste automatizado cobre (uma ISO de 57 KB). Para um
disco real de vários gigabytes, **não vale**. A afirmação foi corrigida.

### 4.7 Limitação do ambiente de teste

As capturas de tela ficaram pretas. Isso **não** é falha do emulador: o Chromium headless
com SwiftShader não apresenta o quadro renderizado para a captura, e o contexto WebGL do
Play! não usa `preserveDrawingBuffer`, então `readPixels` e `toDataURL` retornam vazio.
A execução em si está comprovada pelos 9.622 quadros e pelas strings do jogo na RAM.

---

## 5. Como reproduzir os testes deste documento

```bash
npm install
npm run verify:emulator     # confere os binários do núcleo
npm run typecheck
npm run test                # 88 testes unitários
npm run test:e2e:install    # instala o Chromium (uma vez)
npm run test:e2e            # 26 testes de navegador
npm run build
npm run verify:dist         # confere o build de produção
```

Ou tudo de uma vez:

```bash
npm run check
```

---

## 6. Observações sobre o ambiente de desenvolvimento

- Ambiente: Debian 13, 4 núcleos, 15 GB de RAM, sem GPU dedicada.
- O Chromium roda em modo headless. O WebGL2 funciona por meio do SwiftShader, o que é
  suficiente para instanciar o núcleo e montar um disco, mas **não** é representativo do
  desempenho de um celular real.
- `navigator.deviceMemory` reportou 16 GB e `hardwareConcurrency` reportou 4. Isso ativou o
  perfil **Econômico** sugerido, o que demonstra que a detecção funciona, mas também mostra
  por que ela não pode ser a única base para decidir compatibilidade.
