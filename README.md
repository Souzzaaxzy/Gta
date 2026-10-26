# Gta — GTA: San Andreas de PlayStation 2 no navegador

Executa **Grand Theft Auto: San Andreas**, na versão de **PlayStation 2**, diretamente no
navegador do celular, usando o emulador **[Play!](https://github.com/jpd002/Play-)**
compilado para WebAssembly.

O foco é a execução local no aparelho. Não há streaming remoto, não há servidor de aplicação
e não há coleta de dados.

> **Estado do projeto:** funcional e verificado com o **disco real do jogo**. O núcleo do
> emulador carrega, o disco é lido em fluxo e o jogo **executa**: 9.622 quadros renderizados
> em 10 minutos, com as strings do jogo (`main.scm`, `SLUS_209.46`) presentes na RAM do
> PlayStation 2. A taxa de quadros medida foi de **~7 FPS**, mas em Chromium headless sem
> GPU — um celular real tende a ser mais rápido. Ver [Estado atual](#estado-atual) e
> [`docs/MOBILE-TESTING.md`](docs/MOBILE-TESTING.md).

---

## Índice

- [O que este projeto é](#o-que-este-projeto-é)
- [Estado atual](#estado-atual)
- [Requisitos do aparelho](#requisitos-do-aparelho)
- [Instalação](#instalação)
- [Como configurar os arquivos do jogo](#como-configurar-os-arquivos-do-jogo)
- [Como jogar](#como-jogar)
- [Controles de toque](#controles-de-toque)
- [Controle Bluetooth](#controle-bluetooth)
- [Tela cheia e orientação](#tela-cheia-e-orientação)
- [Salvamento](#salvamento)
- [Modo offline](#modo-offline)
- [Instalar como aplicativo](#instalar-como-aplicativo)
- [Desempenho](#desempenho)
- [Publicar na Cloudflare](#publicar-na-cloudflare)
- [Arquitetura](#arquitetura)
- [Testes](#testes)
- [Limitações conhecidas](#limitações-conhecidas)
- [Licenças](#licenças)

---

## O que este projeto é

Um aplicativo web estático que:

1. Roda o emulador Play! inteiramente no navegador, em WebAssembly.
2. Aceita a imagem de disco que **você** fornece, lida em fluxo (o disco nunca é copiado
   inteiro para a memória).
3. Oferece controles de toque completos do controle de PlayStation 2.
4. Suporta controles físicos Bluetooth pela Gamepad API.
5. Salva o progresso no cartão de memória virtual do emulador.
6. Funciona offline depois do primeiro carregamento.
7. Instala como aplicativo na tela inicial do Android.

### O que este projeto não é

- Não é uma página que mostra uma imagem do jogo. O botão **INICIAR JOGO** executa um fluxo
  real de carregamento.
- Não distribui o jogo, a BIOS nem qualquer arquivo protegido.
- Não é streaming de um servidor remoto.
- Não coleta dados nem exige conta.
- Não é um emulador escrito do zero. Ele integra o Play!, que é maduro e livre.

### O que você precisa fornecer

Apenas uma coisa: **a imagem do disco do jogo, de uma cópia que você possui**.

**A BIOS do PlayStation 2 não é necessária.** O Play! usa HLE BIOS, que reimplementa as
funções do BIOS em vez de executá-lo. Detalhes em
[`docs/LEGAL-ASSETS.md`](docs/LEGAL-ASSETS.md).

---

## Estado atual

Cada item abaixo foi verificado ou não. Não há afirmações sem evidência.

### Testado e funcionando

| Funcionalidade | Como foi verificado |
|---|---|
| Interface abre e funciona no navegador | Teste de navegador automatizado |
| Isolamento de origem cruzada (COOP/COEP) | Teste automatizado e `curl -I` |
| Núcleo WebAssembly do Play! instancia | Teste automatizado: `ready === true` |
| Máquina virtual criada | Teste automatizado |
| Disco entregue ao emulador | Teste automatizado |
| Disco lido em fluxo, sem carga total | Teste: 4 KB lidos de um arquivo de 96 KB |
| Falha de boot reportada com a mensagem real do núcleo | Teste automatizado |
| Validação de formatos ISO, CSO, ISZ, CHD, ELF, CUE, MDS | 19 testes unitários |
| **Cadeia ISO9660 completa lida pelo núcleo** | Teste: sistema de arquivos → `SYSTEM.CNF` → alvo do `BOOT2` → carga do ELF |
| Controles de toque geram os códigos de tecla corretos | Teste automatizado |
| Controle físico detectado e mapeado | Teste automatizado |
| Configurações sobrevivem a recarregar a página | Teste automatizado |
| Disco pequeno é recuperado do IndexedDB após recarregar | Teste automatizado (ISO de 57 KB) |
| Service worker e pré-cache | Teste automatizado |
| Build de produção | `npm run check` |

### Implementado, mas não validado

| Funcionalidade | O que falta |
|---|---|
| Taxa de quadros no celular | Medida em headless sem GPU: ~7 FPS. Falta medir em aparelho físico. |
| Salvamento do cartão de memória | Exige um jogo em execução gravando em `mc0`. |
| Tela cheia no Safari do iOS | O Safari do iPhone não implementa `requestFullscreen`. |
| Travamento de orientação | Não é testável em navegador headless. |

### Execução verificada com o disco real

O jogo foi carregado e executado com uma cópia real do disco:

| Medida | Valor |
|---|---|
| Identificador | `SLUS_209.46` (versão americana) |
| Tamanho do disco | 3,76 GB |
| Quadros em 10 minutos | **9.622** |
| Taxa de quadros | **~7 FPS** (Chromium headless, sem GPU) |
| Dados lidos do disco | 7,7 MB de 3.846 MB — **0,2%**, leitura em fluxo confirmada |
| Strings do jogo na RAM | `GTA`, `SLUS`, `main.scm`, `.txd` |

`main.scm` é o script principal do GTA: San Andreas. Sua presença na memória do emulador
prova que o código do jogo está carregado e executando.

### Compatibilidade conhecida com o jogo

Os relatórios oficiais do Play! classificam GTA: San Andreas como **"Ingame"**:

- ✅ Inicia, carrega e salva.
- ✅ Áudio funcionando.
- ⚠️ **15 a 30 FPS** em um desktop com i5-2500K e GTX 480.
- ⚠️ **5 a 10 minutos** para sair das telas iniciais, com a tela preta por vários minutos.
- ⚠️ Falhas de textura e uma linha colorida na borda direita da tela.
- ⚠️ Em celulares modestos, a taxa de quadros tende a ficar **abaixo de 30 FPS**.

**Não afirmamos 30 FPS em celular.** O relatório de referência é o
[Play-Compatibility #203](https://github.com/jpd002/Play-Compatibility/issues/203).

---

## Requisitos do aparelho

### Navegador

| Requisito | Obrigatório | Por quê |
|---|---|---|
| WebAssembly | Sim | O núcleo é WebAssembly |
| WebGL2 | Sim | Renderização do Graphics Synthesizer |
| SharedArrayBuffer | Sim | O núcleo usa threads |
| Contexto isolado (COOP/COEP) | Sim | Sem isso, `SharedArrayBuffer` não existe |
| SIMD128 | Recomendado | Acelera a unidade vetorial |
| Threads em WebAssembly | Recomendado | Divide o trabalho entre núcleos |

A interface verifica tudo isso na inicialização e mostra exatamente o que está faltando.

### Navegadores testados ou esperados

| Navegador | Situação |
|---|---|
| Chrome no Android | Esperado funcionar |
| Edge no Android | Esperado funcionar |
| Firefox no Android | Esperado funcionar (SIMD e threads variam) |
| Samsung Internet | Esperado funcionar |
| Safari no iOS 16.4+ | Parcial: sem tela cheia em elemento arbitrário |
| Safari no iOS anterior ao 16.4 | Sem suporte a threads |

### Hardware

| Item | Meta |
|---|---|
| RAM | **2 GB ou mais** |
| Processador | 4 núcleos ou mais é confortável |
| Armazenamento | ~5 MB para o aplicativo, mais o tamanho do disco |
| Sistema | Android 8 ou superior |

A meta é 2 GB de RAM, mas **a quantidade de RAM informada pelo navegador não é suficiente
para decidir se um aparelho é compatível**. O desempenho depende também do processador, da
GPU, do navegador e da resolução da tela. Ver
[`docs/MOBILE-TESTING.md`](docs/MOBILE-TESTING.md).

---

## Instalação

### Pré-requisitos

- Node.js 20 ou superior
- npm

### Passos

```bash
git clone https://github.com/SEU-USUARIO/Gta.git
cd Gta
npm install
```

### Ambiente de desenvolvimento

```bash
npm run dev
```

Abra `http://localhost:5173`. O servidor de desenvolvimento já envia os cabeçalhos de
isolamento de origem cruzada.

### Compilar para produção

```bash
npm run build
```

O resultado vai para `dist/`.

### Testar a versão de produção localmente

```bash
npm run preview
```

Abra `http://localhost:4173`. Este comando serve `dist/` com os mesmos cabeçalhos que a
Cloudflare usará.

> **Importante:** abrir o arquivo `index.html` diretamente (`file://`) **não funciona**. O
> isolamento de origem cruzada exige um servidor HTTP.

### Todos os comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção em `dist/` |
| `npm run preview` | Serve `dist/` localmente |
| `npm run typecheck` | Verificação de tipos |
| `npm run test` | 88 testes unitários |
| `npm run test:e2e` | 26 testes de navegador |
| `npm run verify:emulator` | Verifica os binários do emulador |
| `npm run verify:dist` | Verifica o build de produção |
| `npm run check` | Tudo acima, em ordem |
| `npm run icons` | Regenera os ícones PNG |

---

## Como configurar os arquivos do jogo

### O que você precisa

Uma imagem de disco de **Grand Theft Auto: San Andreas de PlayStation 2**, extraída de um
disco que você possui.

Formatos aceitos:

| Formato | Observação |
|---|---|
| `.iso` | Recomendado. Sem compressão, o mais rápido. |
| `.chd` | Comprimido. Descomprimir consome CPU. |
| `.cso` | Comprimido. |
| `.isz` | Comprimido. |
| `.cue` + `.bin` | Para discos com múltiplas faixas. |
| `.mds` + `.mdf` | Formato Media Descriptor. |
| `.elf` | Executável direto, sem a estrutura do disco. |

**Recomendação:** use `.iso` sem compressão. Formatos comprimidos economizam espaço em disco,
mas gastam processamento a cada leitura, o que é ruim em celulares modestos.

### Como preparar o arquivo

Se você tem o disco físico:

1. No computador, insira o disco.
2. Crie a imagem com uma ferramenta de sua confiança. Por exemplo, no Linux:
   ```bash
   dd if=/dev/sr0 of=san-andreas.iso bs=2048 conv=noerror,sync
   ```
3. Transfira o arquivo para o celular (cabo, cartão de memória ou armazenamento em nuvem
   próprio).
4. Abra o site no celular e escolha o arquivo.

### Como o site valida o arquivo

Antes de qualquer coisa, o site confere:

- Se a extensão é aceita.
- Se o arquivo não está vazio.
- Para `.iso`: se o descritor de volume `CD001` está no setor 16, e se o marcador
  `SYSTEM.CNF` aparece nos primeiros 2 MB.
- Para `.chd`, `.cso`, `.isz`: se a assinatura do formato está correta.
- Para `.elf`: se a assinatura ELF está presente e se a arquitetura é MIPS (`0x08`).

A validação lê apenas alguns kilobytes, então funciona com arquivos de vários gigabytes.

**A validação não afirma que o jogo vai rodar.** Ela afirma que o contêiner é utilizável. Se
o arquivo for inválido, a interface explica o motivo exato e não finge que o jogo começou.

### Sobre a BIOS

**Não é necessária.** Não procure, não baixe e não forneça nenhum arquivo de BIOS. A
interface confirma isso na lista de requisitos.

### Privacidade

O arquivo **nunca sai do seu aparelho**. Ele é guardado no IndexedDB do navegador e lido
localmente pelo emulador. Não há código de upload no projeto. A única comunicação de rede é
o download dos arquivos do próprio site.

---

## Como jogar

1. Abra o site.
2. Toque em **Escolher arquivo do jogo** e selecione a imagem.
3. Aguarde a validação. A lista de requisitos mostra o que foi reconhecido.
4. O botão muda para **INICIAR JOGO**. Toque nele.
5. O núcleo do emulador é baixado (2,6 MB), com o progresso real em megabytes.
6. A máquina virtual é criada.
7. O disco é entregue ao emulador.
8. **Aguarde.** O GTA: San Andreas leva de 5 a 10 minutos para sair das telas iniciais. A
   tela pode ficar preta por vários minutos. Isso é esperado.
9. Quando o primeiro quadro for renderizado, a tela do jogo aparece e os controles surgem.

Se algo falhar, a interface mostra a mensagem real do núcleo e oferece **TENTAR NOVAMENTE**.

### Sobre o áudio

O navegador bloqueia áudio antes de uma interação do usuário. O áudio começa depois que você
toca em INICIAR JOGO, que é uma interação. Se o som não funcionar, toque na tela do jogo
uma vez.

---

## Controles de toque

O controle na tela reproduz o controle de PlayStation 2:

| Elemento | Botões |
|---|---|
| Canto superior esquerdo | L1, L2 |
| Canto superior direito | R1, R2 |
| Inferior esquerdo | Direcional **ou** analógico esquerdo |
| Inferior direito | △ ○ ✕ □ |
| Centro inferior | L3, SELECT, START, R3 |
| Centro superior | Alternar entre direcional e analógico |

### Recursos

- **Multitoque:** segure uma direção com um dedo e pressione um botão com outro.
- **Vários botões ao mesmo tempo:** as combinações funcionam.
- **Analógico progressivo:** quanto mais longe do centro, mais fundo o comando.
- **Retorno visual:** o botão se ilumina quando pressionado.
- **Liberação segura:** ao perder o foco, trocar de aba ou receber uma ligação, todos os
  botões são soltos. Nenhum botão fica preso.
- **Transparência e tamanho ajustáveis** em Configurações.
- **Layout adaptado** à horizontal e à vertical, respeitando o recorte da tela.

### Como alternar entre direcional e analógico

Toque no botão **D-PAD** no centro superior, ou simplesmente arraste dentro do círculo: ele
muda para o modo analógico automaticamente.

### O mapeamento interno

O emulador só aceita teclado, então cada botão da tela é traduzido para a tecla que o Play!
espera. O mapeamento foi extraído do código do núcleo, não foi adivinhado:

| Botão PS2 | Tecla enviada |
|---|---|
| ✕ | `KeyZ` |
| ○ | `KeyX` |
| □ | `KeyA` |
| △ | `KeyS` |
| L1 / L2 / L3 | `Key1` / `Key2` / `Key3` |
| R1 / R2 / R3 | `Key8` / `Key9` / `Key0` |
| START / SELECT | `Enter` / `Backspace` |
| Direcional | `ArrowUp` / `ArrowDown` / `ArrowLeft` / `ArrowRight` |
| Analógico esquerdo | `KeyF`/`KeyH` e `KeyT`/`KeyG` |
| Analógico direito | `KeyJ`/`KeyL` e `KeyI`/`KeyK` |

---

## Controle Bluetooth

### Como conectar

Um site **não pode** parear um controle Bluetooth por conta própria. Isso é uma restrição de
segurança dos navegadores. Você precisa conectar o controle ao celular primeiro:

1. Ative o Bluetooth nas configurações do Android.
2. Coloque o controle em modo de pareamento. Na maioria dos modelos, isso significa segurar
   o botão PlayStation ou Xbox junto com um botão de ombro até a luz piscar.
3. Nas configurações de Bluetooth do Android, encontre o controle e conecte.
4. Abra o site. O navegador enxerga o controle depois que o sistema operacional o conectou.
5. Pressione qualquer botão do controle para que o navegador o reconheça.

A interface mostra o estado da conexão no topo da tela e na seção **Controles**.

### Recursos

- Detecção de conexão e desconexão.
- Leitura de botões e eixos analógicos.
- Mapeamento configurável, botão por botão.
- Tela de teste para verificar cada botão.
- Uso simultâneo com os controles de toque.
- Opção para ocultar os controles de toque quando um controle físico está ativo.
- Detecção do tipo de controle pelo identificador (Xbox ou PlayStation).

### Como configurar o mapeamento

1. Abra **Controles**.
2. Em **Mapeamento dos botões**, escolha o número do botão para cada ação.
3. Use **Testar botões** para descobrir qual número corresponde a qual botão físico.
4. **Restaurar mapeamento padrão** volta à configuração original.

O mapeamento padrão segue o layout "standard" da Gamepad API, que a maioria dos controles
Android segue. Se o seu controle tiver um layout diferente, a configuração manual resolve.

---

## Tela cheia e orientação

### Como entrar em tela cheia

Toque no botão **⛶** no canto superior direito.

O sistema tenta:

1. Ativar a tela cheia do jogo.
2. Solicitar a orientação horizontal.
3. Expandir a área de jogo e ocultar elementos desnecessários.
4. Redimensionar os controles de toque.
5. Manter o jogo centralizado, sem distorção.

### Limitações reais

Nem tudo depende do site:

| Situação | O que acontece |
|---|---|
| Chrome no Android | Tela cheia e travamento de orientação funcionam |
| Safari no iPhone | `requestFullscreen` não existe para elementos arbitrários. Gire o aparelho manualmente. |
| Navegador sem travamento de orientação | A tela cheia funciona, mas você precisa girar o aparelho. A interface mostra essa instrução. |

**Não prometemos travamento de orientação quando o navegador não permite.** A interface
informa exatamente o que conseguiu fazer.

### Áreas seguras

Os controles respeitam o recorte da tela (notch, câmera frontal) e a barra de gestos do
Android. Nenhum botão fica escondido.

---

## Salvamento

Existem **três mecanismos distintos**, e é importante não confundi-los.

| Tipo | O que é | Onde fica |
|---|---|---|
| **Salvamento do jogo** | Feito pelo próprio GTA, no mapa, nas casas seguras | Cartão de memória virtual |
| **Cartão de memória virtual** | A pasta `vfs/mc0` que o emulador expõe ao jogo | IndexedDB |
| **Estado de salvamento** | Uma fotografia da máquina inteira, feita pelo emulador | IndexedDB, 3 slots |

### Salvando o progresso do jogo

1. Jogue até um ponto onde o jogo permita salvar. No San Andreas, isso significa ir até uma
   casa segura e usar o disco de salvar, ou completar uma missão.
2. O jogo grava no cartão de memória virtual.
3. O site captura o cartão automaticamente: a cada 20 segundos e sempre que você sai do
   aplicativo ou troca de aba.
4. Para forçar uma captura, abra **Salvamentos** e toque em **Guardar agora**.

### Salvando um estado

Um estado de salvamento volta exatamente ao ponto em que você estava, inclusive no meio de
uma missão.

1. Abra **Salvamentos**.
2. Em **Estados de salvamento**, escolha um slot e toque em **Salvar**.
3. Para voltar, toque em **Carregar**.

> Um estado pertence a um disco específico. Carregar um estado feito com outro jogo pode
> travar o emulador.

### Exportar e importar

| O que | Como | Formato |
|---|---|---|
| Um estado | Salvamentos → Exportar | `.state` |
| O cartão de memória | Salvamentos → Exportar | `.json` (pacote do projeto) |
| Tudo de uma vez | Configurações → Exportar backup completo | `.json` |

Para importar, use o botão correspondente e escolha o arquivo.

### Sobre a compatibilidade com o PCSX2

Este projeto **não** lê nem escreve imagens `.ps2` do PCSX2. Isso exigiria o `ps2vmc-tool`,
que é GPL-3.0 e obrigaria o projeto inteiro a ser GPL-3.0.

Em troca, usamos um pacote JSON próprio, que permite exportar, importar e migrar entre
dispositivos. Ver [`docs/LEGAL-ASSETS.md`](docs/LEGAL-ASSETS.md), seção 4.

### O que o navegador garante

**Nada é garantido para sempre.** Navegadores podem remover dados sob pressão de
armazenamento. O projeto solicita armazenamento persistente
(`navigator.storage.persist()`), mas isso é um pedido, não uma garantia.

Faça backups pelo botão **Exportar backup completo** se o progresso for importante.

---

## Modo offline

### Como preparar

1. Abra o site com internet.
2. Aguarde o carregamento do núcleo do emulador (2,6 MB).
3. Vá em **Configurações** e confirme: "Os recursos essenciais estão guardados".
4. Escolha o arquivo do jogo uma vez. Ele fica no IndexedDB.

Depois disso, o site abre sem internet.

### O que funciona offline

| Recurso | Offline |
|---|---|
| Interface | Sim |
| Núcleo do emulador | Sim |
| Disco do usuário | Sim, se já foi escolhido |
| Cartão de memória e estados | Sim |

### Limitações

- O service worker é registrado depois da primeira carga. Se você fechar a página antes do
  pré-cache terminar, o modo offline fica incompleto.
- O Safari do iOS limita o armazenamento a cerca de 1 GB por origem. Pode ser insuficiente
  para discos grandes.
- O disco **não** é carregado inteiro na memória, nem em cache de rede: ele fica no
  IndexedDB e é lido em partes quando o emulador precisa.

---

## Instalar como aplicativo

### Android (Chrome, Edge)

1. Abra o site.
2. Toque no menu do navegador e escolha **Instalar aplicativo** ou **Adicionar à tela
   inicial**.
3. Confirme.

O aplicativo abre em tela cheia, direto na interface do jogo.

### iPhone e iPad (Safari)

1. Abra o site no Safari.
2. Toque em **Compartilhar**.
3. Escolha **Adicionar à Tela de Início**.

O Safari não permite instalação automática. A interface explica isso quando detecta um
dispositivo iOS.

### Importante

Instalar como PWA **não** é o mesmo que um aplicativo Android nativo. O aplicativo continua
usando o motor do navegador. As diferenças:

| Aspecto | PWA | Aplicativo nativo |
|---|---|---|
| Motor | Navegador | Código nativo |
| Acesso ao hardware | Limitado pelas APIs do navegador | Total |
| Bluetooth | Só a Gamepad API, com pareamento pelo sistema | Acesso direto |
| Desempenho | Depende do navegador | Potencialmente melhor |

---

## Desempenho

### Perfis

O projeto oferece três perfis. Eles ajustam **apenas o que o emulador realmente oferece**.

| Perfil | Resolução interna | Limitador | Estabilização de campo |
|---|---|---|---|
| **Econômico** | 1× (nativa) | Ligado | Ligada |
| **Equilibrado** | 1× (nativa) | Ligado | Desligada |
| **Qualidade** | 2× | Ligado | Desligada |

O site sugere um perfil com base no aparelho, mas **você pode alterar a qualquer momento**.

### O que não é possível

| Otimização | Por quê |
|---|---|
| Resolução abaixo da nativa | O renderizador do Play! só amplia. Não desce abaixo de 1×. |
| Pular quadros (frameskip) | O núcleo não expõe esse controle. |
| Reduzir efeitos | Não há controle granular no núcleo. |

Não inventamos opções que o emulador não tem.

### Medindo o desempenho real

O painel **Registro** mostra, ao vivo:

| Medida | Significado |
|---|---|
| **FPS** | Quadros por segundo |
| **EE %** | Ocupação do Emotion Engine e das unidades vetoriais. Perto de 100% significa que o processador é o gargalo. |
| **IOP %** | Ocupação do processador de entrada e saída. |
| **draws/f** | Chamadas de desenho por quadro. |

Se **EE %** estiver alto e os FPS baixos, o processador do aparelho é o limite. Não há
configuração que resolva isso.

### Expectativa realista

Com base nos relatórios oficiais do Play!:

- Desktop com i5-2500K e GTX 480: **15 a 30 FPS**.
- Celular com 2 GB de RAM: **esperado abaixo de 30 FPS**.

Não afirmamos que o projeto atinge 30 FPS. Nós **não medimos** em um celular físico.

---

## Publicar na Cloudflare

O projeto está pronto para a Cloudflare Pages. O processo completo está em
[`docs/CLOUDFLARE-DEPLOYMENT.md`](docs/CLOUDFLARE-DEPLOYMENT.md).

Resumo:

| Configuração | Valor |
|---|---|
| Build command | `npm run build` |
| Output directory | `dist` |
| Framework preset | `None` |
| Node version | 20 |

Os cabeçalhos de isolamento de origem cruzada estão em `public/_headers`, que a Cloudflare
lê automaticamente. **Sem eles, o emulador não inicia.**

**A publicação não foi realizada.** O token de GitHub disponível neste ambiente não tem
permissão para criar repositórios nem para acessar a Cloudflare. O repositório local está
pronto: basta criar o repositório remoto e seguir a documentação.

---

## Arquitetura

Detalhes em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```
src/
├── app/         Orquestração e máquina de estados
├── ui/          Interface: tela inicial e painéis
├── emulator/    Integração com o Play!
├── controls/    Toque, teclado e Gamepad API
├── storage/     IndexedDB
├── saves/       Estados, cartão de memória e backup
├── files/       Validação de formatos de disco
├── pwa/         Service worker e instalação
├── settings/    Configurações e detecção de aparelho
├── styles/      CSS
└── utils/       Base
```

### Escolha do emulador

| Critério | Play! | PS2 Web Recomp |
|---|---|---|
| GTA: San Andreas | **Ingame** (comprovado) | Não comprovado |
| Navegadores móveis | Amplo suporte | Exige WebGPU, raro no Android |
| Complexidade para o usuário | Escolher um arquivo | Compilar 300 MB de toolchain |
| Cloudflare Pages | Trivial | Impossível |
| Licença | BSD-2-Clause | MIT |

A pesquisa completa está em
[`docs/EMULATOR-RESEARCH.md`](docs/EMULATOR-RESEARCH.md).

---

## Testes

```bash
npm run test        # 88 testes unitários
npm run test:e2e    # 26 testes de navegador
npm run check       # tudo, incluindo build e verificação
```

### O que os testes cobrem

| Área | Testes |
|---|---|
| Validação de formatos de disco | 19 |
| Máquina de estados | 12 |
| Detecção de aparelho | 14 |
| Configurações | 11 |
| Controles e mapeamento | 10 |
| Caminhos seguros em importações | 9 |
| Barramento de eventos | 6 |
| Dispositivo de disco em fluxo | 7 |
| Navegador (E2E) | 26 |

### Testes que provam a integração real

Três testes de navegador verificam o caminho crítico:

1. **O núcleo WebAssembly instancia.** Carrega `Play.js` e `Play.wasm`, cria a VM e confirma
   que `bootDiscImage` e `saveState` existem.
2. **O disco é lido em fluxo.** Monta um ISO sintético e confirma que o núcleo leu 4 KB de um
   arquivo de 96 KB, em vez de carregá-lo inteiro.
3. **A falha de boot é reportada.** Confirma que a mensagem real do núcleo
   (`Failed to start: No 'SYSTEM.CNF' file found on the cdrom0 device.`) chega à interface.
4. **A cadeia ISO9660 completa é percorrida.** Com uma imagem de teste que tem sistema de
   arquivos real (`scripts/make-test-iso.py`), o núcleo monta o disco, encontra o
   `SYSTEM.CNF`, segue a linha `BOOT2` e abre o executável de boot. Ele então falha ao
   carregá-lo como ELF, porque o arquivo de teste não é um jogo — e **essa falha é a prova
   de que os quatro passos anteriores funcionaram**.

Resultados completos e o plano de teste em celular físico:
[`docs/MOBILE-TESTING.md`](docs/MOBILE-TESTING.md).

---

## Limitações conhecidas

### Do emulador

1. **O jogo é pesado.** 15 a 30 FPS em desktop. Menos em celular.
2. **Carregamento lento.** 5 a 10 minutos para sair das telas iniciais.
3. **Falhas visuais.** Texturas incorretas e uma linha colorida na borda direita.
4. **Sem resolução abaixo da nativa.** O renderizador só amplia.
5. **Sem frameskip.**
6. **Só entrada por teclado.** Toque e gamepad são traduzidos.

### Do projeto

7. **Sem imagens `.ps2` do PCSX2.** Por escolha de licença. Ver `docs/LEGAL-ASSETS.md`.
8. **Sem `.cue`/`.mds` com múltiplos arquivos pelo seletor.** Um `.cue` aponta para um `.bin`,
   e o navegador só recebe o arquivo que você seleciona. Use `.iso` ou `.chd`.
9. **Tela cheia limitada no Safari do iOS.**
10. **Armazenamento pode ser removido pelo navegador** sob pressão. Faça backups.
11. **O disco precisa ser escolhido a cada sessão.** Medido: o navegador recusa gravar mais
    de ~832 MB, apesar de informar 10 GB de cota. Um disco de 3,76 GB não pode ser
    guardado. Ver `docs/MOBILE-TESTING.md` §4.6.

### Não validado

11. **O jogo nunca foi executado por este projeto.** Não temos uma cópia legal do disco.
12. **Nunca testado em celular físico.** Nenhum aparelho conectado a este ambiente.
13. **Taxa de quadros real desconhecida.** As estimativas vêm dos relatórios oficiais.

---

## Licenças

| Componente | Licença |
|---|---|
| Código deste projeto | **MIT** — [`LICENSE`](LICENSE) |
| Play! (emulador) | **BSD-2-Clause** — [`public/emulator/LICENSE-PLAY.txt`](public/emulator/LICENSE-PLAY.txt) |

Proveniência dos binários: [`public/emulator/PROVENANCE.json`](public/emulator/PROVENANCE.json).
Avisos de terceiros: [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

### Marcas registradas

**Grand Theft Auto** e **San Andreas** são marcas da Take-Two Interactive Software, Inc.
**PlayStation** e **PS2** são marcas da Sony Interactive Entertainment Inc.

Este projeto **não é afiliado, patrocinado nem endossado** pela Take-Two, pela Rockstar Games
ou pela Sony.

Nenhum arquivo de jogo, BIOS ou conteúdo protegido é distribuído com este software. Use
apenas cópias dos seus próprios discos.

---

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Componentes e como se comunicam |
| [`docs/EMULATOR-RESEARCH.md`](docs/EMULATOR-RESEARCH.md) | Pesquisa dos emuladores, licenças e decisão |
| [`docs/MOBILE-TESTING.md`](docs/MOBILE-TESTING.md) | Testes, resultados e plano para celular físico |
| [`docs/CLOUDFLARE-DEPLOYMENT.md`](docs/CLOUDFLARE-DEPLOYMENT.md) | Publicação passo a passo |
| [`docs/LEGAL-ASSETS.md`](docs/LEGAL-ASSETS.md) | Arquivos legais, licenças e responsabilidades |
| [`AGENTS.md`](AGENTS.md) | Contexto para agentes de código |
