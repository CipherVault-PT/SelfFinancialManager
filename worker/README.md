# Worker da Aurora (Cloudflare)

Um único Worker, grátis, faz duas coisas:

1. **Cotações fiáveis** — o Yahoo Finance não deixa o browser pedir cotações diretamente (CORS). Sem Worker, a app usa
   intermediários públicos, que às vezes falham. Com o teu, todas as ações e ETFs ficam ao vivo.
2. **Sincronização entre dispositivos** — guarda **um ficheiro cifrado** com os teus dados num cofre (KV). A app cifra
   tudo no dispositivo (AES-256-GCM, chave derivada da tua frase-passe com PBKDF2): **nem o Worker nem a Cloudflare
   conseguem ler os dados**.

O plano gratuito chega e sobra (100 000 pedidos por dia; a app faz dezenas).

## Criar com 1 clique (também no telemóvel)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/CipherVault-PT/SelfFinancialManager/tree/main/worker)

1. Carrega no botão, entra na Cloudflare (ou cria conta grátis) e liga o GitHub quando pedir — a Cloudflare guarda lá
   uma cópia desta pasta e instala o Worker a partir dela.
2. Deixa o nome `aurora` e carrega em **Create and deploy**. O cofre (KV com o nome `SYNC`) é criado e ligado sozinho
   ([`wrangler.jsonc`](./wrangler.jsonc)).
3. Copia o endereço do Worker (ex: `https://aurora.o-teu-nome.workers.dev`) e confirma em `/status` que aparece
   `"app":"aurora"` e `"sync":true`.
4. Na app: **⚙ → Sincronização → Ligar** → o endereço e uma frase-passe (10+ caracteres; o ideal são 4 palavras).
   As cotações passam a usar o mesmo Worker. Nos outros dispositivos: **o mesmo endereço e a mesma frase-passe**.

## Criar à mão (sem GitHub, de preferência no computador)

1. **Cofre**: em <https://dash.cloudflare.com>, **Storage & Databases → KV → Create** → nome `aurora-sync`.
2. **Worker**: **Workers & Pages → Create → Create Worker** → nome `aurora` → **Deploy**.
3. Carrega em **Edit code**, apaga o código de exemplo e cola o conteúdo de [`aurora-worker.js`](./aurora-worker.js)
   (na app: ⚙ → Sincronização → Como criar → **Copiar o código do Worker**) → **Deploy**.
   No telemóvel, o editor da Cloudflare costuma recusar colar — usa o botão acima ou um computador.
4. **Ligar o cofre ao Worker**: no Worker, **Settings → Bindings → Add → KV namespace** → nome da variável `SYNC`,
   namespace `aurora-sync` → **Deploy**.
5. Na app, como no passo 4 acima.

## Como funciona a sincronização

- Cada alteração é enviada uns segundos depois; ao abrir a app (e a cada 3 minutos) vê se há novidades.
- O Worker guarda versões: só aceita uma gravação se ninguém tiver gravado entretanto. Se os dois dispositivos mudaram
  dados ao mesmo tempo, a app pergunta qual versão manter — a outra fica em **⚙ → Repor os dados de antes**.
- O histórico diário do património junta-se sozinho.
- O Worker guarda também a versão anterior (`prev` no KV), por segurança.

## Segurança

- **Frase-passe**: só existe nos teus dispositivos. Dela saem a chave de cifra e uma chave de acesso; o Worker guarda
  apenas o SHA-256 da chave de acesso. **Se a esqueceres, a cópia na nuvem não se recupera** (os dados de cada
  dispositivo continuam lá) — guarda-a num gestor de passwords.
- Depois de 10 tentativas erradas, o Worker bloqueia esse IP durante 15 minutos.
- Cotações: só aceita pedidos para o Yahoo Finance e o BCE — não serve de proxy aberto. Respostas em cache 30 s.
- Para apagar tudo da nuvem: na app, **⚙ → Sincronização → Apagar a cópia na nuvem** (ou apaga as chaves no KV).

## Endpoints

| Método | Caminho | Para quê |
| --- | --- | --- |
| GET | `/?url=…` | Cotação do Yahoo / série do BCE |
| GET | `/status` | Estado (cotações, cofre ligado, cofre criado) |
| GET | `/sync/meta` | Sal e iterações do cofre |
| POST | `/sync/init` | Criar o cofre (ou mudar a frase-passe, com a chave atual) |
| GET | `/sync?since=v` | Dados cifrados (204 se não mudou) |
| PUT | `/sync` | Gravar nova versão (409 se houver uma mais recente) |
| DELETE | `/sync` | Apagar o cofre |
