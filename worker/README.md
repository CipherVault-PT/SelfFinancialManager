# Atalho de cotações (Cloudflare Worker)

O Yahoo Finance não deixa o browser pedir cotações diretamente (CORS). Sem atalho, a app usa
intermediários públicos gratuitos, que às vezes falham ou ficam lentos. Com o teu próprio Worker
(grátis até 100 000 pedidos/dia), **todas as ações e ETFs ficam ao vivo de forma fiável**.

## Criar em ~3 minutos

1. Cria conta grátis em <https://dash.cloudflare.com/sign-up>.
2. No painel: **Workers & Pages → Create → Create Worker** → dá-lhe um nome (ex: `aurora-cotacoes`) → **Deploy**.
3. Clica em **Edit code**, apaga o código de exemplo e cola o conteúdo de [`yahoo-proxy.js`](./yahoo-proxy.js).
4. Clica em **Deploy** e copia o endereço (ex: `https://aurora-cotacoes.o-teu-nome.workers.dev`).
5. Na app: **⚙ Definições → Cotações → Atalho de cotações**, cola o endereço e carrega em **Testar**.

## Segurança

- O Worker só aceita pedidos para `query1/query2.finance.yahoo.com` — não pode ser usado como proxy aberto.
- Não guarda dados nem precisa de chaves: só passa as cotações públicas e acrescenta os cabeçalhos CORS.
- As respostas ficam em cache 30 s na Cloudflare, para poupar pedidos.
