# Publicação na Cloudflare Pages

Este documento cobre tudo o que é necessário para publicar o projeto. A publicação em si
**não foi realizada** por este ambiente: o token de GitHub disponível não tem permissão para
criar repositórios nem para se conectar à Cloudflare. O projeto está pronto; falta executar
os passos abaixo.

---

## 1. Pré-requisitos

| Item | Observação |
|---|---|
| Conta na Cloudflare | O plano gratuito é suficiente para o site |
| Repositório no GitHub, GitLab ou Bitbucket | A Cloudflare Pages importa de um repositório Git |
| Node.js 20 ou superior | Para compilar localmente |
| O repositório publicado | Ver o passo 2 |

### 1.1 Verificar o build localmente antes de publicar

```bash
npm install
npm run check
```

`npm run check` executa, em ordem: verificação dos binários do emulador, verificação de
tipos, 88 testes unitários, o build de produção e a verificação do resultado. Se ele passa, o
build é publicável.

---

## 2. Como importar o repositório

1. Acesse o painel da Cloudflare e vá em **Workers & Pages**.
2. Clique em **Create** e escolha a aba **Pages**.
3. Clique em **Connect to Git**.
4. Autorize a Cloudflare a acessar sua conta e escolha o repositório `Gta`.
5. Clique em **Begin setup**.

---

## 3. Comando de build

| Campo | Valor |
|---|---|
| **Framework preset** | `None` |
| **Build command** | `npm run build` |
| **Build output directory** | `dist` |
| **Root directory** | *(deixe em branco)* |
| **Node version** | `20` ou superior |

### 3.1 Variável de ambiente necessária

| Nome | Valor | Obrigatória |
|---|---|---|
| `NODE_VERSION` | `20` | Sim, se a Cloudflare usar uma versão anterior por padrão |

Não há outras variáveis. O projeto não usa segredos, chaves de API nem banco de dados.

### 3.2 O que o comando de build faz

```json
"prebuild": "node scripts/generate-icons.mjs",
"build": "npm run typecheck && vite build && vite build --config vite.sw.config.ts && node scripts/build-precache-manifest.mjs"
```

1. `prebuild` gera os ícones PNG a partir do SVG.
2. `typecheck` recusa o build se houver erro de tipos.
3. `vite build` produz o site em `dist/`.
4. `vite build --config vite.sw.config.ts` produz `dist/sw.js`, o service worker.
5. `build-precache-manifest.mjs` gera `dist/precache-manifest.json` e **falha** se o núcleo
   do emulador não estiver presente.

Um build que não contém `Play.wasm` não passa. Isso é intencional.

---

## 4. Cabeçalhos: o ponto mais importante

O núcleo do Play! é um build com threads e precisa de `SharedArrayBuffer`. Os navegadores só
o expõem em documentos **isolados por origem cruzada**. Isso exige três cabeçalhos, e sem
eles o emulador **não inicia**:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

Eles estão declarados em `public/_headers`, que o Vite copia para `dist/_headers`. A
Cloudflare Pages lê esse arquivo automaticamente. **Não é necessário configurar nada no
painel.**

O arquivo também declara o MIME type correto para o WebAssembly:

```
/emulator/Play.wasm
  Content-Type: application/wasm
```

Sem isso, o navegador recusa instanciar o módulo, com a mensagem
"Unexpected response MIME type. Expected 'application/wasm'".

### 4.1 Como confirmar que os cabeçalhos chegaram

Depois de publicar:

```bash
curl -sI https://SEU-DOMINIO/ | grep -i cross-origin
```

Devem aparecer as três linhas. Se não aparecerem, o `_headers` não foi lido: verifique se o
arquivo está em `dist/_headers` após o build.

No navegador, abra o console e digite:

```js
crossOriginIsolated
```

Precisa ser `true`. Se for `false`, o emulador não vai iniciar, e a interface mostrará
"Navegador incompatível" com essa explicação.

---

## 5. Como configurar um domínio

1. No projeto da Cloudflare Pages, vá em **Custom domains**.
2. Clique em **Set up a custom domain**.
3. Digite o domínio ou subdomínio.
4. Se o domínio estiver na Cloudflare, o registro DNS é criado automaticamente.
5. Se estiver em outro provedor, crie um `CNAME` apontando para o endereço indicado.
6. Aguarde a emissão do certificado. O HTTPS é automático e obrigatório: sem HTTPS, o
   isolamento de origem cruzada não funciona.

O subdomínio `*.pages.dev` fornecido pela Cloudflare também serve e já tem HTTPS.

---

## 6. Como testar a publicação

### 6.1 Teste automatizado

```bash
BASE_URL=https://SEU-DOMINIO npx playwright test
```

Ajuste `playwright.config.ts` para usar `BASE_URL` quando definido, ou rode os testes contra
o servidor local com `npm run preview`.

### 6.2 Verificação manual

1. Abra o endereço no celular.
2. Confirme que a tela inicial aparece com o título e o botão.
3. Verifique no console: `crossOriginIsolated` deve ser `true`.
4. Toque em **Escolher arquivo do jogo** e selecione a sua imagem.
5. O indicador deve mostrar "Disco pronto" e o botão deve mudar para **INICIAR JOGO**.
6. Toque em **INICIAR JOGO**.
7. A barra de progresso deve avançar com os megabytes reais do núcleo (2,6 MB).
8. Depois do carregamento, a tela do jogo deve aparecer e os controles devem surgir.

Se aparecer "Navegador incompatível", a mensagem indica exatamente o que faltou.

---

## 7. Como atualizar o site

A Cloudflare Pages publica automaticamente a cada push na branch de produção (normalmente
`main`). Um preview é criado para cada pull request.

```bash
git add .
git commit -m "Descrição da mudança"
git push origin main
```

O build roda e a publicação acontece em cerca de um minuto.

### 7.1 Cache e atualizações

| Arquivo | Política | Motivo |
|---|---|---|
| `/assets/*` | `max-age=31536000, immutable` | Nomes com hash de conteúdo |
| `/emulator/*` | `max-age=31536000, immutable` | Binários versionados |
| `/sw.js` | `no-cache, no-store` | Senão, atualizações nunca chegam |
| `/precache-manifest.json` | `no-cache, no-store` | Define a versão do cache |
| `/index.html` | `no-cache, must-revalidate` | Garante que um novo deploy apareça |

O service worker usa um `buildId` derivado do hash dos arquivos. Um novo deploy gera um novo
cache, e o antigo é removido na ativação.

Quando há uma versão nova, a interface pode oferecer **Atualizar**. O método
`ServiceWorkerController.applyUpdate()` ativa o worker em espera e recarrega a página.

---

## 8. Como investigar falhas de build

| Sintoma | Causa provável | Solução |
|---|---|---|
| `tsc: command not found` | Dependências não instaladas | Confirme que o build command é `npm run build` e que a Cloudflare roda `npm install` |
| Erro de tipo em `tsc --noEmit` | Código inconsistente | Rode `npm run typecheck` localmente |
| `precache: recurso obrigatório ausente em dist: /emulator/Play.wasm` | O núcleo não foi copiado | Confirme que `public/emulator/Play.wasm` existe e não está no `.gitignore` |
| Build passa, mas a página fica em branco | Erro de JavaScript | Abra o console do navegador |
| `SharedArrayBuffer is not defined` | Cabeçalhos COOP/COEP ausentes | Verifique `dist/_headers` e o `curl -I` |
| `Unexpected response MIME type` | MIME do wasm errado | Verifique a regra `/emulator/Play.wasm` em `_headers` |
| O emulador não inicia, sem erro claro | Contexto não isolado | `crossOriginIsolated` no console deve ser `true` |
| `RangeError: Array buffer allocation failed` | Memória insuficiente no aparelho | Feche outros aplicativos; use o perfil Econômico |

### 8.1 Tamanho do build

```
dist/               ~3,1 MB no total
  emulator/         ~2,8 MB   (Play.js + Play.wasm)
  assets/           ~107 KB   (JS + CSS comprimidos)
  icons/            ~135 KB
  sw.js             ~3,2 KB
```

Bem abaixo do limite de 25 MB por arquivo da Cloudflare Pages e do limite de 20.000 arquivos.

---

## 9. Como verificar o funcionamento offline

1. Abra o site com internet.
2. Espere o carregamento terminar. O service worker guarda o shell e o núcleo.
3. Vá em **Configurações** e confirme: "Os recursos essenciais estão guardados".
4. Ative o modo avião.
5. Recarregue a página. O site deve abrir.

### 9.1 O que funciona offline

| Recurso | Offline |
|---|---|
| Interface, CSS, JavaScript | Sim |
| Núcleo do emulador (`Play.js`, `Play.wasm`) | Sim, 2,6 MB em cache |
| Ícones, manifest | Sim |
| Disco do usuário | Sim, no IndexedDB |
| Cartão de memória e estados | Sim, no IndexedDB |

### 9.2 Limitações

- O service worker é registrado **depois** da primeira carga. Se você fechar a página antes
  do pré-cache terminar, o modo offline fica incompleto.
- O navegador pode remover os dados sob pressão de armazenamento. O projeto pede
  armazenamento persistente (`navigator.storage.persist()`), mas isso é uma solicitação, não
  uma garantia.
- O Safari do iOS tem um limite de cerca de 1 GB de armazenamento por origem. Pode ser
  insuficiente para discos grandes.
- Instalar como PWA é diferente de um aplicativo Android nativo: o aplicativo ainda usa o
  motor do navegador.

---

## 10. Cloudflare Workers: não são necessários

O projeto é totalmente estático. Todo o trabalho, incluindo a emulação, acontece no
navegador.

Não há Worker porque:

- Nada precisa ser processado no servidor.
- Os arquivos do usuário **não devem** sair do aparelho.
- Os cabeçalhos COOP/COEP são resolvidos pelo `_headers`, sem código.

**Exceção documentada:** se algum dia o projeto quiser distribuir um disco com autorização
legal, o Cloudflare R2 seria o lugar adequado (armazenamento de objetos, sem custo de
tráfego de saída na Cloudflare). Isso não está implementado e exigiria autorização
específica dos detentores dos direitos.

---

## 11. Custos e limites do plano gratuito

| Recurso | Limite gratuito | Consumo deste projeto |
|---|---|---|
| Builds por mês | 500 | 1 por push |
| Arquivos por deploy | 20.000 | 19 |
| Tamanho por arquivo | 25 MB | 2,6 MB (o maior) |
| Requisições | Ilimitadas | — |
| Largura de banda | Ilimitada | — |

O projeto cabe folgadamente no plano gratuito. O consumo de banda depende do número de
visitas, porque cada novo usuário baixa os 2,6 MB do núcleo uma vez.

---

## 12. Publicação a partir deste repositório

```bash
git init
git add .
git commit -m "GTA: San Andreas de PS2 no navegador"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/Gta.git
git push -u origin main
```

Depois, siga os passos 2 a 6 deste documento.
