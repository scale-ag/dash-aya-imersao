# Dashboard de Captação de Leads · Mayara Sansana · Imersão AYA

Dashboard **100% na nuvem** da captação da **Imersão AYA**, cruzando a mídia paga
(Meta Ads) com as inscrições feitas na landing page (Typeform). Mesmo modelo/abas
da `dash-giaco-sdc-form7` (Visão Geral · Meta Ads · Insights de IA), adaptado a
funil de **landing page** com **qualificação (MQL)**. Build estático (HTML/CSS/JS
puro + Chart.js via CDN) publicado no **GitHub Pages** e reconstruído a cada ~30 min
pelo GitHub Actions (disparado pelo cron-job.org).

**URL pública:** https://scale-ag.github.io/dash-aya-imersao/

Somente leitura das planilhas. O build **nunca** escreve de volta.

---

## O que a dash mostra

Funil: **Gasto → Impressões → Alcance → Cliques → Page Views → Leads → MQLs**, com
CPM, Frequência, CTR, CPC, Connect Rate (PV ÷ Cliques), CPV, ConvLP (Leads ÷ PV),
CPL, Tx MQL (MQLs ÷ Leads) e CPMQL.

1. **Visão Geral** — funil + evolução diária (Leads/MQLs × Gasto × CPL × CPMQL) +
   tabela diária com heatmap, 10 KPIs secundários e 8 distribuições (faturamento,
   conjunto, papel na empresa, desafio comercial, MQLs por anúncio/conjunto, origem,
   comportamento do faturamento). Leads = **tráfego pago + social**.
2. **Meta Ads** — só **tráfego pago**: funil, indicadores por dia, leads por anúncio,
   conversão da LP, compilado de anúncios, tabelas Campanha → Conjunto → Anúncio com
   filtro cruzado e a lista de leads do período (mascarada).
3. **Metas & Pacing** — metas do briefing (100 vagas, super meta 150, fases até 31/12 e 05/02,
   verba de R$ 70.000 até 23/02): pacing diário da verba, vagas esperadas × vendidas, projeção de
   gasto/leads/MQLs no ritmo dos últimos 7 dias e conversão MQL→venda necessária. Metas em
   `build/build.py → PLANO` (inclusive a divisão da verba por mês, quando definida).
4. **Insights de IA** — espelha a Visão Geral + metas editáveis (CPL, CPMQL, volume
   mínimo, N dias) + **Top Anúncios** com status Escalar/Manter/Observar/Cortar.

### Regra de LEAD VÁLIDO (`build/build.py` → `lead_discard_reason`)
1. `utm_medium` = `trafego-pago` ou `social` (o resto são testes da planilha);
2. nome, e-mail e WhatsApp preenchidos;
3. não é teste (e-mails da equipe em `TEST_EMAILS`, nome/e-mail "teste…").

### MQL
Faturamento médio mensal (coluna H) **acima de R$ 50 mil**: faixas
"De R$ 50 mil a R$ 100 mil" em diante.

### Imposto da mídia paga
`TAX_FACTOR = 1.13806` (13,806%) aplicado **somente** ao gasto do Meta Ads. O toggle
"Imposto Meta" **já vem ligado**; desligá-lo mostra o gasto bruto.

## Fontes de dados (Google Sheets, somente leitura)

| Planilha | ID | Aba (gid) | Colunas usadas |
|---|---|---|---|
| Leads — `Imersão AYA - Inscrições` | `1Kjzuri6ftG0ih6_P5GPnJLJOXexXVUe9u77N1Hl5-XE` | 1ª aba | nome · WhatsApp · e-mail · papel na empresa · faturamento médio mensal (H) · comportamento do faturamento · maior desafio · `utm_source` · `utm_medium` · `utm_campaign` · `utm_term` · `utm_content` · `Submitted At` · `Token` |
| Meta Ads — `Mayara sansana - AYA`, aba `Queries \| AYA` | `1CNkrp663XYeyi6pEH3_nn_nkAzLfdVTQwE9VlCthen4` | `0` | `Day` · `Campaign Name` · `Ad Set Name` · `Ad Name` · `Amount Spent` · `Impressions` · `Reach` · `Link Clicks` · `Landing Page Views` |

Casamento: `utm_campaign` = `Campaign Name` · `utm_term` = `Ad Set Name` · `utm_content` = `Ad Name`.

URL de export CSV: `https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=<GID>`

## Rodar/testar local

```bash
python build/build.py --leads-file leads.csv --meta-file queries.csv --out dist/index.html
```

Sem `--leads-file`/`--meta-file` o script busca os CSVs públicos direto do Google Sheets.

## Automação

- `.github/workflows/deploy.yml` — roda `build/build.py` e publica no Pages.
  Dispara por `workflow_dispatch` (cron-job.org a cada 30 min), `schedule` de
  backup e `push` na `main`.
- `.github/workflows/briefing.yml` — coleta os números dos Insights. Agendamento
  **desligado** até existir a Routine do Claude que escreve os textos.

Valores exatos para o cron-job.org: **`SETUP-CRON.md`**.
