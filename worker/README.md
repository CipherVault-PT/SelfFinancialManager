# Worker da Aurora (Cloudflare)

Um único Worker, grátis, faz duas coisas:

1. **Cotações fiáveis** — o Yahoo Finance não deixa o browser pedir cotações diretamente (CORS). Sem Worker, a app usa
   intermediários públicos, que às vezes falham. Com o teu, todas as ações e ETFs ficam ao vivo.
2. **Sincronização entre dispositivos** — guarda **um ficheiro cifrado** com os teus dados num cofre (KV). A app cifra
   tudo no dispositivo (AES-256-GCM, chave derivada da tua frase-passe com PBKDF2): **nem o Worker nem a Cloudflare
   conseguem ler os dados**.

O plano gratuito chega e sobra (100 000 pedidos por dia; a app faz dezenas).

## Criar (~5 minutos, de preferência no computador)

1. Cria conta grátis em <https://dash.cloudflare.com/sign-up> (ou entra na que já tens).
2. **Cofre**: no menu, **Storage & Databases → KV → Create** → nome `aurora-sync`.
3. **Worker**: **Workers & Pages → Create → Create Worker** → nome `aurora` → **Deploy**.
4. Carrega em **Edit code**, apaga o código de exemplo e cola o conteúdo de [`aurora-worker.js`](./aurora-worker.js)
   (na app: ⚙ → Sincronização → Como criar → **Copiar o código do Worker**) → **Deploy**.
5. **Ligar o cofre ao Worker**: no Worker, **Settings → Bindings → Add → KV namespace** → nome da variável `SYNC`,
   namespace `aurora-sync` → **Deploy**.
6. Copia o endereço do Worker (ex: `https://aurora.o-teu-nome.workers.dev`).
7. Na app:
   - **⚙ → Cotações → Atalho**: cola o endereço e carrega em **Testar**;
   - **⚙ → Sincronização → Ligar**: o mesmo endereço e uma frase-passe (10+ caracteres; o ideal são 4 palavras).
   - Nos outros dispositivos: **Ligar** com o **mesmo endereço e a mesma frase-passe**.

Já tinhas o atalho antigo das cotações? Troca o código (passo 4) e faz os passos 2 e 5 — o endereço mantém-se.

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
