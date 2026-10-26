# Testes em celular e resultados

Este documento registra o que foi testado, o que foi observado e o que ainda depende de um
aparelho físico. Nenhum resultado foi inventado.

---

## 1. Resumo do estado

| Categoria | Quantidade |
|---|---|
| Testado e funcionando | 16 itens |
| Testado parcialmente | 4 itens |
| Implementado, mas não testado | 3 itens |
| Bloqueado (falta hardware ou arquivo) | 4 itens |

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

**24 testes, 2 arquivos, todos passando.** Rodam no Chromium em emulação de Pixel 7
(412×915, com toque), contra o **build de produção** servido com os cabeçalhos reais.

| Arquivo | Testes | O que verifica |
|---|---|---|
| `app.spec.ts` | 21 | Shell, isolamento, MIME, manifest, service worker, arquivos, painéis, persistência, controles, gamepad, núcleo |
| `disc-boot.spec.ts` | 3 | Caminho real de carregamento de disco |

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

---

## 3. Estado por funcionalidade

### Testado e funcionando

| Funcionalidade | Evidência |
|---|---|
| Interface abre e renderiza | E2E `shell › loads…` |
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
| **Taxa de quadros real do GTA: San Andreas** | Exige o disco do jogo, que não temos. |
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

### 4.4 Resultados esperados, com base na literatura

Do relatório oficial do Play! (#203), em um desktop com i5-2500K e GTX 480: **15 a 30 FPS**.
Um celular com 2 GB de RAM tem menos capacidade de processamento que esse desktop. Portanto:

- É razoável esperar **menos de 30 FPS**, possivelmente bem menos.
- O perfil **Econômico** é o mais indicado para esses aparelhos.
- Reduzir a resolução interna para 1× é obrigatório: o núcleo não desce abaixo do nativo.

Estas são expectativas, não medições. Devem ser substituídas por números reais assim que
houver um aparelho.

---

## 5. Como reproduzir os testes deste documento

```bash
npm install
npm run verify:emulator     # confere os binários do núcleo
npm run typecheck
npm run test                # 88 testes unitários
npm run test:e2e:install    # instala o Chromium (uma vez)
npm run test:e2e            # 24 testes de navegador
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
