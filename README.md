# Aurora Investments

Junta num só sítio as posições abertas das várias corretoras (Revolut, XTB, Trade Republic…), incluindo cripto, e vê o teu património e os ganhos ao vivo.

App web estática (HTML + CSS + JavaScript, sem build) e instalável como app (PWA). Os dados ficam **só no teu dispositivo** (`localStorage`). Faz backups regulares em **⚙ → Dados e segurança** — também servem para levar os dados para outro dispositivo.

## Funcionalidades

- **Cripto ao vivo**: CoinGecko, com a Binance como reserva quando a CoinGecko limita pedidos.
- **Ações e ETFs ao vivo**: Yahoo Finance, através do teu atalho Cloudflare ou de intermediários públicos, com a Twelve Data como reserva opcional. Inclui:
  - pesquisa nas ~1800 ações/ETFs da base local: S&P 500, S&P 600, Nasdaq-100, as principais bolsas europeias (DAX/MDAX/SDAX/TecDAX, CAC 40, FTSE 100, IBEX 35, FTSE MIB, AEX, BEL 20, SMI, nórdicas, Áustria, Irlanda, PSI) e ADRs/ações populares, todas com setor e país;
  - pesquisa global no Yahoo, para qualquer ticker do mundo;
  - preço pré-preenchido ao escolher a ação.
- **Câmbio do BCE** (Frankfurter) para EUR, USD, GBP, CHF, DKK e outras.
- **Taxa de conversão da XTB** (0,5%) aplicada na compra e na venda; a Revolut e a Trade Republic ficam isentas.
- **Várias entradas por posição**, com o preço médio recalculado.
- **Venda total ou parcial** (¼, ½, tudo ou qualquer quantidade) pelo método **FIFO** — as compras mais antigas saem primeiro, como manda o IRS.
- **Anular uma venda** (as unidades voltam à posição) para corrigir erros.
- Histórico de vendas com lucro realizado; fundos/cash com depósitos, juros e levantamentos.
- **Para onde vai o dinheiro**: ao vender escolhes o destino — fica na corretora (saldo por investir, criado automaticamente), vai para um fundo (ex: fundo de emergência na Trade Republic) ou sai da app. Ao comprar ou reforçar podes pagar com esses saldos, para o património não contar o mesmo dinheiro duas vezes. A app lembra a última escolha de cada corretora; anular uma venda ou apagar uma posição desfaz os movimentos.
- **Transferir dinheiro entre contas**: do saldo de uma corretora para o fundo de emergência ou para outra corretora para investir (ex: fechas cripto na Revolut e passas o dinheiro para a XTB). Converte moedas (podes indicar o valor exato que chegou), cria o saldo da corretora de destino se ainda não existir e apagar uma transferência desfaz os dois lados.
- **Proteção dos dados**: pedido de armazenamento persistente ao browser, lembrete de backup (primeiro aos 3 dias, depois a cada 30), backup pela folha de partilha do telemóvel (Drive, email…), **cifrado com palavra-passe** por omissão (AES-256-GCM; com a sincronização ligada usa a frase-passe dela e repõe sem perguntar) e **repor os dados** de antes de importar ou apagar tudo.
- **Dividendos**: valor bruto, imposto retido na fonte e moeda, por ação (aberta ou já vendida), e para onde foi o dinheiro (saldo da corretora, um fundo ou fora da app); total e **retorno total** em cada posição, lista no Histórico e resumo dos últimos 12 meses no Painel.
- **Relatório para o IRS**, por ano — mais-valias: uma linha por cada compra vendida (FIFO), valores em € (câmbio do BCE da data para contas noutra moeda), dias detido, totais de ações/ETFs e cripto (< 365 dias tributada; ≥ 365 dias excluída), imposto estimado à taxa de 28%; dividendos em € com o imposto retido no estrangeiro e o imposto adicional estimado; exportação CSV para Excel. É uma ajuda — não substitui o guia da corretora nem um contabilista.
- **Distribuição por setor, país e moeda** no Painel, com aviso de concentração (≥ 40% num setor, país ou fora do euro). As ~1800 ações da base já vêm classificadas; as restantes ganham o país pela bolsa e podes completar ou corrigir o setor e o país à mão.
- **Rentabilidade real** no Painel: ganho total (inclui vendas e dividendos), rentabilidade **por ano (TIR)** que conta com o dia de cada compra e venda, e comparação com o **S&P 500** — o mesmo dinheiro, nas mesmas datas, num ETF em euros (SXR8.DE). Antes de 1 ano mostra a rentabilidade do período (anualizar poucos meses engana).
- **Importar o extrato da XTB** (Excel exportado da xStation): cria as posições abertas e as vendas com a data e o custo de cada compra (prontas para o relatório do IRS) e os dividendos com o imposto retido. Pré-visualização antes de aplicar, não duplica ao importar de novo, pode substituir o que registaste à mão e dá para desfazer. CFDs ficam de fora. O ficheiro é lido só no dispositivo (leitor de .xlsx próprio, sem bibliotecas externas).
- **Bloqueio com PIN** (4 a 8 algarismos, guardado só como hash PBKDF2) e, onde o dispositivo o permite, **impressão digital / Face ID** (WebAuthn). Bloqueia ao abrir e ao voltar à app (logo, 1, 5 ou 15 min), espera progressiva depois de 5 erros e "Esqueci-me do PIN" (apaga os dados do dispositivo; depois repões um backup). É uma proteção contra quem pegue no telemóvel — não cifra os dados.
- **Planos de poupança**: compra mensal de valor fixo numa posição (ex: 100 € de VWCE no dia 2). No dia, o Painel avisa para registar a compra — valor e preço pré-preenchidos, unidades estimadas e editáveis, pagamento com um saldo — ou saltar o mês. A app não compra nada sozinha.
- **Meta**: objetivo de património, valor por mês e rentabilidade estimada (ou a tua TIR); progresso, data estimada para lá chegares, cenários a ±2% e a regra dos 4%.
- **Rebalancear**: alocação alvo por ativo (o mesmo ETF em várias corretoras conta junto) e quanto pôr em cada um no próximo investimento para te aproximares do alvo sem vender.
- **Rentabilidade sem a inflação**: o ganho em poder de compra, descontando a inflação de Portugal (IHPC mensal do BCE).
- **Sincronização entre dispositivos** cifrada de ponta a ponta, através do teu Worker da Cloudflare (ver abaixo).
- **Estado das bolsas**: faixa com as bolsas das tuas ações — aberta, pré-mercado, pós-mercado ou fechada, até quando e quando abre — na tua hora, com a mudança de hora de cada país, feriados principais e meios-dias (o Yahoo corrige o horário do próprio dia). Toca para ver o horário de todas as bolsas.
- **Pré e pós-mercado dos EUA** (como no Investing): fora do horário normal aparece no topo um painel com as tuas ações dos EUA — preço do pré/pós-mercado, variação e quanto mexe em cada posição e no total. Para ETFs europeus do S&P 500 ou do Nasdaq 100 (ex.: VUAA, CSPX, EQQQ) mostra os **futuros** do índice, que indicam como podem abrir. O valor da carteira continua a contar com o preço do horário normal.
- **A seguir (watchlist)**: ações, ETFs e cripto que ainda não tens — preço ao vivo, variação do dia, pré/pós-mercado, variação desde que começaste a seguir, nota e **preço-alvo** (descer até / subir até) com aviso quando lá chega. "Comprar" abre a nova posição já preenchida e tira o ativo da lista. Sincroniza e entra no backup.
- **Diário de trades**: em cada posição, a **tese** (porque compraste), o **alvo** e o **stop** — com a distância ao preço atual, quanto ganhas face ao que arriscas e, se quiseres, alertas nesses preços. Ao vender, a app mostra o plano e pede uma nota. No Histórico, estatísticas por ano / 12 meses / tudo: taxa de acerto, ganho e perda médios, rácio ganho ÷ perda, profit factor, resultado por trade, tempo médio (ganhos vs perdas), melhor e pior — e avisos como "seguras as perdas mais tempo do que os ganhos" (a partir de 5 vendas).
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

### Worker da Cloudflare: cotações fiáveis + sincronização (recomendado)

Um único Worker grátis na Cloudflare, criado com 1 clique — [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/CipherVault-PT/SelfFinancialManager/tree/main/worker) (detalhes em [`worker/README.md`](worker/README.md) ou, na app, **⚙ → Sincronização → Como criar**):

- **Cotações**: o Yahoo não permite pedidos diretos do browser; com o teu Worker todas as ações ficam ao vivo de forma fiável. Sem ele, a app usa intermediários públicos (allorigins, corsproxy, codetabs), que às vezes falham.
- **Sincronização**: os mesmos dados no telemóvel e no computador, automaticamente. Os dados vão **cifrados no dispositivo** com a tua frase-passe (AES-256-GCM, PBKDF2) — nem a Cloudflare os consegue ler. Se mudares dados nos dois lados ao mesmo tempo, a app pergunta qual versão manter.

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
  backup.js             lembrete de backup, cifra do backup, armazenamento persistente, guardar ficheiro
  lock.js               bloqueio: PIN (PBKDF2), tentativas, impressão digital/Face ID (WebAuthn)
  format.js             formatação de valores, datas e números
  fx.js                 câmbio e conversões
  calc.js               cálculos de posições, P/L, taxas e totais
  cash.js               dinheiro entre vendas, compras e fundos/saldos das corretoras
  history.js            histórico diário do património (em EUR)
  dividends.js          dividendos (registo, totais por posição, estatísticas)
  allocation.js         distribuição por setor, país e moeda; concentração
  performance.js        rentabilidade: TIR (XIRR) e comparação com o S&P 500
  inflation.js          inflação de Portugal (IHPC do BCE) e rentabilidade real
  markets.js            horário das bolsas, feriados, fusos horários e pré/pós-mercado
  watchlist.js          lista "A seguir": cotação, alvo e avisos
  journal.js            diário de trades: dias na carteira, estatísticas e observações
  plans.js              planos de poupança mensais
  goals.js              metas: projeção com juros compostos, regra dos 4%
  rebalance.js          alocação alvo e sugestão de onde investir
  import/               extratos: xlsx.js (leitor de Excel), xtb.js (formato XTB), apply.js (pré-visualizar e aplicar)
  tax.js                relatório IRS: mais-valias FIFO e dividendos (câmbio histórico, resumo anual, CSV)
  alerts.js             alertas de preço
  net.js                pedidos com timeout e concorrência limitada
  stocks.js             pesquisa e símbolos da base de ações
  data/stocks.js        base local de ações e ETFs (símbolo Yahoo único)
  data/stocks-world.js  restantes ações dos EUA e da Europa (gerado a partir das listas dos índices)
  data/classification.js setores, países e classificação das ações europeias e temáticas
  quotes/               cotações: crypto.js, stocks.js e index.js (orquestração)
  ui/                   render, modais, formulário de entradas, tema, fundo animado
  pwa.js                instalação e service worker
  sync/                 sincronização: crypto.js (cifra) e engine.js (enviar, receber, conflitos)
worker/                 Cloudflare Worker (cotações + cofre cifrado) + wrangler.jsonc para o botão "Deploy to Cloudflare"
tests/                  testes (node --test)
```

## Ideias

Ideias faladas mas ainda por fazer (ou postas de parte) estão em [`IDEIAS.md`](IDEIAS.md).

## Testes

```bash
npm test
```

Os testes cobrem os cálculos (taxas, conversões, P/L, vendas FIFO, alertas, histórico), o relatório IRS, os dividendos, a rentabilidade (TIR e comparação com o índice), a importação de extratos (Excel gerado nos testes), o PIN do bloqueio, o destino do dinheiro das vendas e compras, as transferências, os planos de poupança, as metas, o rebalanceamento, a inflação, a sincronização (dois dispositivos contra o Worker com um cofre simulado), a distribuição (incluindo que todas as ações da base têm setor e país), os backups (incluindo os cifrados: palavra errada, ficheiro adulterado), o horário das bolsas (feriados, mudança de hora, pré/pós-mercado), a lista "A seguir", o diário de trades, a migração dos dados da versão anterior, os parsers das APIs com respostas simuladas, a base de ações e o Worker.
