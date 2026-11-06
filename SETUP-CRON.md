# Ativação + configuração do cron-job.org

## Passo 1 — Workflow na `main` (já feito)

O disparo por `workflow_dispatch` (o que o cron-job.org usa) só existe quando o
workflow está na `main` — este repositório já publica direto na `main`, e o
GitHub Pages já está ligado (modo **GitHub Actions**). A página fica em:

**https://scale-ag.github.io/dash-aya-imersao/**

Para disparar na mão: aba **Actions** → *Build & Deploy Dashboard* → **Run workflow**.

## Passo 2 — Token do GitHub (fine-grained)

GitHub → *Settings* → *Developer settings* → **Fine-grained tokens** → *Generate*:
- Resource owner: **scale-ag**
- Repository access: **Only select repositories → `scale-ag/dash-aya-imersao`**
- Permissions → Repository permissions → **Actions: Read and write**
- (opcional) validade longa

Guarde o token; ele vai só no cron-job.org (**nunca** no repositório, nunca em texto
puro em chat/documento compartilhado). Se um token for exposto acidentalmente,
revogue-o e gere um novo imediatamente.

## Passo 3 — Criar o cron job em https://cron-job.org

Crie um job e preencha **exatamente** (um valor por vez):

### URL
```
https://api.github.com/repos/scale-ag/dash-aya-imersao/actions/workflows/deploy.yml/dispatches
```

### Método (Request method)
```
POST
```

### Schedule (execução)
```
A cada 30 minutos  (Every 30 minutes)
```

### Headers (chave → valor), um por linha
```
Accept: application/vnd.github+json
```
```
Authorization: Bearer TOKEN_AQUI
```
```
X-GitHub-Api-Version: 2022-11-28
```
```
Content-Type: application/json
```

> Substitua `TOKEN_AQUI` (header `Authorization`) pelo token fine-grained do
> Passo 2. Ele fica **só** no cron-job.org — nunca no repositório, nunca em
> texto puro em chat.

### Request body
```
{"ref":"main"}
```

> No cron-job.org: em **Advanced**, marque para **enviar o corpo** e defina o
> **Content-Type** como `application/json` (o header acima já cobre isso).

## Como saber se funcionou

- Resposta esperada da API: **HTTP 204 No Content** (sucesso, sem corpo).
- Em **Actions** aparece uma nova execução a cada disparo.
- 401/403 = token errado ou sem permissão **Actions: write**.
- 404 = confira owner/repo/nome do arquivo (`deploy.yml`) e se ele está na `main`.
- 422 = o workflow não está na `main` ou o body não tem `{"ref":"main"}`.

## Observações

- A página lê as planilhas **somente leitura**; nunca escreve nelas.
- O `schedule` nativo (`*/30 * * * *`) fica como **backup**; o GitHub costuma
  atrasar agendamentos, por isso o cron-job.org é a fonte principal de pontualidade.
- Trocar a regra de lead válido, os IDs das planilhas ou as colunas: edite `build/build.py`.
