# Aurora Investments

Junta num só sítio as posições abertas das várias corretoras (Revolut, XTB, Trade Republic…), incluindo cripto, e vê o teu património e os ganhos ao vivo.

App web estática (HTML + CSS + JavaScript, sem build) e instalável como app (PWA). Os dados ficam **só no teu dispositivo** (`localStorage`). Faz backups regulares em **⚙ → Dados e segurança** — também servem para levar os dados para outro dispositivo.

## Funcionalidades

- **Cripto ao vivo**: CoinGecko, com a Binance como reserva quando a CoinGecko limita pedidos.
- **Ações e ETFs ao vivo**: Yahoo Finance, através do teu atalho Cloudflare ou de intermediários públicos, com a Twelve Data como reserva opcional. Inclui:
  - pesquisa nas ~650 ações/ETFs da base local;
  - pesquisa global no Yahoo, para qualquer ticker do mundo;
  - preço pré-preenchido ao escolher a ação.
- **Câmbio do BCE** (Frankfurter) para EUR, USD, GBP, CHF, DKK e outras.
- **Taxa de conversão da XTB** (0,5%) aplicada na compra e na venda; a Revolut e a Trade Republic ficam isentas.
- **Várias entradas por posição**, com o preço médio recalculado.
- **Venda total ou parcial** (¼, ½, tudo ou qualquer quantidade) pelo método **FIFO** — as compras mais antigas saem primeiro, como manda o IRS.
- **Anular uma venda** (as unidades voltam à posição) para corrigir erros.
- Histórico de vendas com lucro realizado; fundos/cash com depósitos, juros e levantamentos.
- **Proteção dos dados**: pedido de armazenamento persistente ao browser, lembrete de backup (primeiro aos 3 dias, depois a cada 30), backup pela folha de partilha do telemóvel (Drive, email…) e **repor os dados** de antes de importar ou apagar tudo.
- **Alertas de preço** com notificações.
- **Gráfico da evolução do património** (1M / 3M / 1A / Tudo).
- Funciona offline com os últimos dados (service worker).

## Usar

A app usa módulos ES, por isso tem de ser servida por HTTP (não abre com duplo clique no ficheiro).

- **GitHub Pages**: *Settings → Pages → Deploy from a branch →* `main` / `(root)`.
- **Localmente**:
  ```bash
  npm start            # ou: python3 -m http.server 5173
  ```
  Depois abre <http://localhost:5173>.

### Cotações de ações fiáveis (recomendado)

O Yahoo não permite pedidos diretos do browser. Cria o teu atalho grátis na Cloudflare em ~3 minutos: vê [`worker/README.md`](worker/README.md). Depois cola o endereço em **⚙ Definições → Cotações**.

Sem atalho, a app usa intermediários públicos (allorigins, corsproxy, codetabs), que funcionam mas às vezes falham.

## Estrutura

```
index.html              estrutura da página
css/styles.css          estilos
manifest.webmanifest    PWA
sw.js                   service worker (offline)
icons/                  ícones da app
js/
  main.js               arranque, eventos e atualizações automáticas
  config.js             constantes (corretoras, moedas, cores, intervalos)
  store.js              estado, gravação, migração de dados antigos, importar/exportar, desfazer
  backup.js             lembrete de backup, armazenamento persistente, guardar ficheiro
  format.js             formatação de valores, datas e números
  fx.js                 câmbio e conversões
  calc.js               cálculos de posições, P/L, taxas e totais
  history.js            histórico diário do património (em EUR)
  alerts.js             alertas de preço
  net.js                pedidos com timeout e concorrência limitada
  stocks.js             pesquisa e símbolos da base de ações
  data/stocks.js        base local de ações e ETFs (símbolo Yahoo único)
  quotes/               cotações: crypto.js, stocks.js e index.js (orquestração)
  ui/                   render, modais, formulário de entradas, tema, fundo animado
  pwa.js                instalação e service worker
worker/                 Cloudflare Worker (atalho de cotações)
tests/                  testes (node --test)
```

## Testes

```bash
npm test
```

Os testes cobrem os cálculos (taxas, conversões, P/L, vendas FIFO, alertas, histórico), os backups, a migração dos dados da versão anterior, os parsers das APIs com respostas simuladas, a base de ações e o Worker.
