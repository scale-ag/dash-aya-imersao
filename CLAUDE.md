# CLAUDE.md — Dashboard Mayara Sansana · Imersão AYA (captação de leads)

> Lido automaticamente pelo Claude Code ao abrir o repositório. Mantenha atualizado.
> Repositório: `scale-ag/dash-aya-imersao` · Pages: `https://scale-ag.github.io/dash-aya-imersao/`

## Configuração do cliente

- **Cliente:** Mayara Sansana · **Produto:** Imersão AYA · captação por **landing page + Typeform**.
- **Modelo:** mesmo layout/abas de `scale-ag/dash-giaco-sdc-form7`
  (**Visão Geral · Meta Ads · Insights de IA** — ids internos `geral`/`meta`/`rel`),
  adaptado a funil de **landing page** (com Page Views) e **qualificação (MQL)**.
- **Leads:** planilha `1Kjzuri6ftG0ih6_P5GPnJLJOXexXVUe9u77N1Hl5-XE` ("Imersão AYA - Inscrições"), **1ª aba** (`GID_LEADS = None`; a aba gid 0 vem vazia).
- **Meta Ads:** planilha `1CNkrp663XYeyi6pEH3_nn_nkAzLfdVTQwE9VlCthen4` ("Mayara sansana - AYA"), aba `Queries | AYA`, gid `0`.
  Se o gid configurado não tiver o cabeçalho esperado, o build tenta a 1ª aba e,
  se ainda assim não achar, **falha** (o Pages mantém a última versão boa).
- `TAX_FACTOR = 1.13806` (toggle "Imposto Meta" ligado por padrão).
- O sandbox do agente costuma não alcançar `docs.google.com`; o runner do Actions alcança.

---

## Funil (landing page)

`Gasto → Impressões → Alcance → Cliques → Page Views → Leads → MQLs`, com
**CPM · Frequência · CTR · CPC · Connect Rate (PV ÷ Cliques) · CPV · ConvLP (Leads ÷ PV) ·
CPL · Tx MQL (MQLs ÷ Leads) · CPMQL**.

- **Page Views** = coluna `Landing Page Views` da aba de Queries.
- **Alcance** é a soma das linhas diárias por anúncio (o Meta não deduplica entre
  dias/anúncios), então a Frequência é uma média aproximada.
- **CPL/CPMQL só existem com gasto > 0** (`derive()` em `app.js`, `derived()` em
  `relatorio_lib.py`): lead sem mídia correspondente aparece com "-" (nunca "R$ 0,00").
- A coluna `Leads` da aba de Queries (contagem do Meta) **não** é usada — a fonte de
  verdade é a planilha de inscrições.
- **Todas** as campanhas da aba de Queries entram no gasto (inclusive a de
  distribuição/seguidores `E1-DIST`). Para ver só captação, filtre a campanha na aba Meta Ads.

## Regra de LEAD VÁLIDO (`build.py` → `lead_discard_reason`) — definida pelo gestor

1. `utm_medium` = `trafego-pago` (origem **pago**, `src="meta"`) ou `social`
   (origem **orgânica**, `src="social"`). Qualquer outro valor (vazio, macro
   `{{...}}`, etc.) são os testes feitos para validar a planilha → descartado;
2. nome, e-mail e WhatsApp preenchidos;
3. não é teste: e-mail em `TEST_EMAILS` (cadastros da equipe — ex. `ericktales18@gmail.com`,
   que fez testes **com** `utm_medium=trafego-pago`), nome/e-mail começando com
   `teste`/`test`, domínio de teste;
4. respostas com o mesmo `Token` do Typeform contam 1 vez.

**Visão Geral e Insights** = pago + social. **Meta Ads** = só pago (`metaScope`).

### MQL (lead qualificado)
Faturamento médio mensal (coluna **H**, "Qual é o faturamento médio mensal da
empresa?") **acima de R$ 50 mil** = faixa cujo **piso ≥ R$ 50 mil**
(`De R$ 50 mil a R$ 100 mil` em diante) — `faturamento_piso()`/`MQL_MIN_FATURAMENTO`.
Faixa não reconhecida conta como não-MQL e aparece como ATENÇÃO no log do build.

### Casamento leads × Meta Ads (pelas UTMs)
`utm_campaign` = `Campaign Name` · `utm_term` = `Ad Set Name` · `utm_content` = `Ad Name`
(sem diferenciar maiúsculas e ignorando espaços duplicados). `trk=1` quando a tripla
existe na aba de Queries. UTM vazia ou com macro não substituída (`{{campaign.name}}`)
vira `(sem UTM de campanha/conjunto/anúncio)`.

### Fuso horário
`Submitted At` do Typeform vem em **UTC sem offset** (`06/11/2026 10:41:19`,
dd/mm/aaaa). `parse_lead_datetime()` converte de `LEADS_TZ` (UTC) para `ACCOUNT_TZ`
(America/Sao_Paulo) antes de pegar o dia/hora. O `Day` do Meta entra como está.

## Arquitetura / arquivos

```
build/build.py            # lê os 2 CSVs (read-only), aplica a regra de lead válido/MQL, emite REGISTROS BRUTOS (leads[]/meta[]); render() costura os arquivos abaixo
build/template.html       # esqueleto HTML. Placeholders __STYLES__, __APP_JS__, __DATA_JSON__, __BUILD_ID__, __GENERATED_BRT__
build/identidade-visual.css  # TODAS as cores (tema claro/escuro)
build/estilos.css         # layout/componentes
build/app.js              # lógica + renderização (KPIs, funil, tabelas, filtro cruzado, period-picker, heatmap, Insights)
build/relatorios.json     # Insights de Tráfego por período — VERSIONADO; hoje {} (Routine não criada)
build/relatorios_dados.json      # números brutos por período (insumo da Routine) — não lido pelo site. Hoje {}.
build/relatorio_lib.py           # datas/agregação compartilhadas (usada por coletar_dados_relatorio.py)
build/coletar_dados_relatorio.py # gera relatorios_dados.json (só números) — roda no briefing.yml (agendamento DESLIGADO)
build/GUIA-RELATORIOS.md            # formato dos Insights
build/GUIA-INTERPRETACAO-METRICAS.md # regras de diagnóstico por métrica
.github/workflows/deploy.yml    # roda build.py e publica no Pages (workflow_dispatch + schedule + push)
.github/workflows/briefing.yml  # roda coletar_dados_relatorio.py (só workflow_dispatch por enquanto)
dist/index.html           # saída gerada (gitignored; o Actions reconstrói)
SETUP-CRON.md             # valores exatos do cron-job.org
```

Registro de lead: `{d,h,src,orig,camp,adset,ad,trk,q,fat,fatv,papel,comp,desafio,nm,em,ph}`.
Registro de meta: `{d,camp,adset,ad,sp,im,cl,rc,pv}`.

## Especificação funcional

1. **Visão Geral** — funil (7 etapas); evolução diária (Leads/MQLs barras · Gasto · CPL · CPMQL)
   + tabela diária com heatmap (`DAILY_COLS`: Data · Dia · Gasto · CPM · CTR · Connect · ConvLP ·
   Leads · CPL · Tx MQL · MQLs · CPMQL); 10 KPIs secundários; 8 distribuições (faturamento
   com MQL em verde, conjunto, papel na empresa, desafio comercial, MQLs por anúncio/conjunto,
   origem, comportamento do faturamento em 12 meses).
2. **Meta Ads** — só tráfego pago; funil; combinação diária; indicadores por dia (CPM/CTR ·
   Connect/ConvLP · CPL/CPMQL); leads por anúncio; donut ConvLP; compilado de anúncios; 3 tabelas
   hierárquicas Campanha → Conjunto → Anúncio com gráfico de CPL por dia; lista de leads (mascarada).
3. **Metas & Pacing** (`pace`) — metas do briefing (`build.py::PLANO`): 100 vagas (super 150),
   Fase 1 03/11–31/12 (70/105), Fase 2 01/01–05/02 (30/45), verba R$ 70.000 de 03/11 a 23/02,
   custo por venda alvo = verba ÷ vagas. **Não segue o filtro de período** (sempre início do plano → hoje).
   Verba planejada = `orcamento_mensal` ou, se `None`, linear por dia (R$ 619,47). Curva de vagas =
   média simples por fase. Ritmos/projeções = média dos últimos 7 dias **fechados** (hoje entra só no
   acumulado). Vendas: **sem fonte** (`VENDAS_FONTE = None`, `vendas: []`) — "Vendido" fica "-".
   "Quanto investir por dia": saldo da verba ÷ dias restantes no formato do plano (com e sem imposto),
   KPIs, curvas acumuladas (verba · vagas · leads/MQLs), metas por fase, verba por mês, pacing diário.
4. **Insights de IA** — espelha a Visão Geral + Metas (CPL, CPMQL, volume mínimo, N dias) +
   Top Anúncios (ordem: MQLs → leads → CPL; status pelo CPL) + Insights de Tráfego.

**Regras das tabelas:** cabeçalho sticky; ordenação tri‑state; colunas redimensionáveis;
"Total Geral" fixo; **nenhum valor/dimensão truncado** (tabela fit ganha rolagem lateral se
faltar espaço — `fitColWidth`); seleção com toggle + Ctrl; filtro cruzado bidirecional.

`localStorage`: `dm_metas:<repo>` e `dm_colw:<repo>`; `dm_theme` é global.

## Rodar/testar local

```bash
python build/build.py --leads-file leads.csv --meta-file queries.csv --out dist/index.html
```

## Publicação — problemas conhecidos
1. **cron-job.org só funciona na `main`** (`workflow_dispatch` só existe na branch padrão).
2. **Pages** precisa estar em Settings → Pages → Source = **GitHub Actions**.
3. **Token exposto:** se um token foi colado no chat, **revogar e gerar um novo**.
