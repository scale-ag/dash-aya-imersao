# AGENTS.md — Dash Captação de Leads · Mayara Sansana (Imersão AYA)

> Contexto completo em **`CLAUDE.md`** (mesma pasta) — leia-o antes de mexer no projeto.

## O essencial

- **Repo:** `scale-ag/dash-aya-imersao` · **Pages:** https://scale-ag.github.io/dash-aya-imersao/
- **Modelo:** mesmas abas/layout de `dash-giaco-sdc-form7` (Visão Geral · Meta Ads · Insights de IA).
- **Fontes:** planilha de inscrições (Typeform, 1ª aba) + aba `Queries | AYA` do Meta Ads (gid 0), somente leitura.
- **Funil:** `Gasto → Impressões → Alcance → Cliques → Page Views → Leads → MQLs`.
- **Lead válido:** `utm_medium` = `trafego-pago` (pago) ou `social` (orgânico) **e** cadastro completo **e** não é teste (`TEST_EMAILS`).
- **MQL:** faturamento médio mensal (coluna H) acima de R$ 50 mil (piso da faixa ≥ 50 mil).
- **Casamento:** `utm_campaign`/`utm_term`/`utm_content` = Campaign/Ad Set/Ad Name do Meta.
- **Fuso:** `Submitted At` em UTC → convertido para America/Sao_Paulo.
- **Imposto:** `TAX_FACTOR=1.13806`; toggle "Imposto Meta" ligado por padrão.
- **Build:** `python build/build.py --leads-file leads.csv --meta-file queries.csv --out dist/index.html`.

## Onde mexer

| Quero mudar… | Arquivo |
|---|---|
| IDs/gids das planilhas, regra de lead válido, e-mails de teste, MQL, imposto, fuso | `build/build.py` |
| Metas do briefing, cronograma, verba por mês (aba Metas & Pacing) | `build/build.py → PLANO` |
| Só as cores (tema claro/escuro) | `build/identidade-visual.css` |
| Layout/componentes | `build/estilos.css` |
| KPIs, funil, tabelas, gráficos, filtro cruzado | `build/app.js` |
| Título, logo, textos fixos da página | `build/template.html` |
| Publicação | `.github/workflows/deploy.yml` · `SETUP-CRON.md` |
