#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gera a dashboard estatica (index.html) de Captacao de Leads da Imersao AYA
(Mayara Sansana) a partir de DUAS planilhas do Google Sheets (somente leitura):

  - "Imersao AYA - Inscricoes" (gid 0): fonte PRINCIPAL de leads — cada linha e
    uma inscricao feita no formulario da landing page (Typeform), com as UTMs
    (utm_source/utm_medium/utm_campaign/utm_term/utm_content) como hidden fields.
  - "Mayara sansana - AYA", aba "Queries | AYA" (gid 0): investimento /
    impressoes / alcance / cliques / visitas na LP do gerenciador (Meta Ads),
    uma linha por dia x campanha x conjunto x anuncio.

LEAD VALIDO (regra definida pelo gestor) — ver lead_discard_reason():
  1. utm_medium == "trafego-pago" (midia paga) ou "social" (organico do
     Instagram/link na bio). Qualquer outra coisa (vazio, "{{...}}", etc.) sao
     os testes feitos para validar a planilha e NAO entram;
  2. nome, e-mail e WhatsApp preenchidos;
  3. nao e cadastro de teste (e-mails da equipe em TEST_EMAILS, nome/e-mail
     comecando com "teste"/"test", dominios de teste).

MQL (lead qualificado) = faturamento medio mensal (coluna H) ACIMA DE R$ 50 mil,
ou seja, faixa cujo piso e >= R$ 50 mil ("De R$ 50 mil a R$ 100 mil" em diante).
Ver faturamento_piso()/is_mql().

O casamento com o Meta Ads usa as UTMs (os nomes do gerenciador vem nas UTMs):
    utm_campaign == Campaign Name · utm_term == Ad Set Name · utm_content == Ad Name
(comparacao sem diferenciar maiusculas e ignorando espacos duplicados).

FUNIL DESTA CONTA (landing page + formulario):
    Gasto -> Impressoes -> Alcance -> Cliques -> Page Views -> Leads -> MQLs
com CPM · Frequencia · CTR · CPC · Connect Rate (PV/Cliques) · CPV · ConvLP
(Leads/PV) · CPL · Tx MQL (MQL/Leads) · CPMQL. A coluna "Leads" da aba de
Queries (contagem do proprio Meta) NAO e usada: a fonte de verdade dos leads e
a planilha de inscricoes (cadastros validos).

Este script apenas LE as planilhas (export CSV publico) e emite os REGISTROS
BRUTOS (leads[] e meta[]) dentro do HTML. Todos os filtros, agregacoes, KPIs,
tabelas e graficos sao calculados no navegador (client-side). Nunca escreve
nada de volta.

Teste local: --leads-file / --meta-file apontando para CSVs baixados.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta

# Planilha de Leads ("Imersao AYA - Inscricoes") — fonte principal (formulario da LP).
# GID_LEADS = None -> le a 1a aba (a aba gid=0 desta planilha vem vazia; os dados
# do Typeform estao na 1a aba).
SPREADSHEET_ID_LEADS = "1Kjzuri6ftG0ih6_P5GPnJLJOXexXVUe9u77N1Hl5-XE"
GID_LEADS = None
# Planilha de Queries do Meta Ads ("Mayara sansana - AYA"), aba "Queries | AYA".
SPREADSHEET_ID_META = "1CNkrp663XYeyi6pEH3_nn_nkAzLfdVTQwE9VlCthen4"
GID_META = "0"
EXPORT_URL = "https://docs.google.com/spreadsheets/d/{sid}/export?format=csv&gid={gid}"
# Sem gid o Google exporta a 1a aba da planilha. Usado como 2a tentativa quando o
# CSV do gid configurado nao tem o cabecalho esperado (ex.: alguem reordenou abas).
EXPORT_URL_FIRST_TAB = "https://docs.google.com/spreadsheets/d/{sid}/export?format=csv"

# Identificação do cliente/conta (usada só em textos/relatórios — não afeta o cruzamento de dados).
CLIENT_NAME = "Mayara Sansana"
MAIN_PRODUCT = "Imersão AYA"

# --------------------------------------------------------------------------- #
# Regra de lead válido / qualificação (definidas pelo gestor)
# --------------------------------------------------------------------------- #
# utm_medium aceitos (comparação sem maiúsculas/espaços). Cada valor vira uma
# ORIGEM do lead: "meta" = tráfego pago (cruza com o Meta Ads) · "social" =
# orgânico (Instagram / link na bio — não tem gasto de mídia).
VALID_UTM_MEDIUMS = {"trafego-pago": "meta", "social": "social"}
SRC_LABELS = {"meta": "Tráfego pago", "social": "Social (orgânico)"}

# Cadastros da EQUIPE usados para testar o formulário/planilha (nunca são leads
# reais, mesmo quando o teste foi feito com utm_medium preenchido). Comparação
# sem maiúsculas. Para liberar um e-mail, basta tirá-lo daqui.
TEST_EMAILS = {
    "ericktales18@gmail.com",        # testes "aaa", "eeee", "Erick", "joano" (03 e 05/11)
    "agenciaup13@gmail.com",         # teste "anana" (03/11) — conta da agência
    "fillipebenedictis@gmail.com",   # testes sem UTM (03/11) — editor das planilhas
    "fillipe.benedicts@icl.com.br",
    "email@gmail.com",               # teste "Nome completo" (05/11)
    "eeeee@gmail.com",               # teste "aaa" (03/11)
}

# MQL = faturamento médio mensal ACIMA DE R$ 50 mil: faixa cujo PISO é >= este valor
# ("De R$ 50 mil a R$ 100 mil", "De R$ 100 mil a R$ 300 mil", ...).
MQL_MIN_FATURAMENTO = 50_000.0

# --------------------------------------------------------------------------- #
# Fusos horarios — "Submitted At" do Typeform vem em UTC e SEM offset
# ("06/11/2026 10:41:19"); o "Day" do Meta Ads ja vem fechado no fuso da conta.
# O dia do lead e convertido de LEADS_TZ (UTC) para ACCOUNT_TZ (Sao Paulo)
# antes de virar data — ex.: 06/11 01:00 UTC = 05/11 22:00 BRT => dia 05/11.
LEADS_TZ_NAME = "UTC"                  # fuso do "Submitted At" quando vier SEM offset
ACCOUNT_TZ_NAME = "America/Sao_Paulo"  # fuso da conta de anuncios (dia de referencia da dash)
try:                                    # tzdata do sistema (runner do Actions tem)
    from zoneinfo import ZoneInfo
    LEADS_TZ = ZoneInfo(LEADS_TZ_NAME)
    ACCOUNT_TZ = ZoneInfo(ACCOUNT_TZ_NAME)
except Exception:                       # sem tz database: offset fixo equivalente
    LEADS_TZ = timezone.utc
    ACCOUNT_TZ = timezone(timedelta(hours=-3))

BRT = timezone(timedelta(hours=-3))   # horario de Brasilia (so p/ o carimbo "ultima atualizacao")
TAX_FACTOR = 1.13806   # fator de imposto/taxa sobre o gasto de mídia paga (Meta Ads) = 13,806%.
                       # O toggle "Imposto Meta" ja vem LIGADO (app.js STATE.tax=true): gasto e
                       # derivados (CPM, CPC, CPV, CPL, CPMQL) saem com o imposto. Desligar mostra o bruto.

# --------------------------------------------------------------------------- #
# Regras da aba Insights de IA (Top Anúncios)
# --------------------------------------------------------------------------- #
# Amostra mínima para JULGAR um anúncio (Escalar/Manter/Cortar). Abaixo disso ele
# fica "Observar" — nunca é classificado só porque teve 1 lead com pouco gasto.
SAMPLE_MIN_SPEND = 100.0   # gasto mínimo (R$, sem imposto) para amostra relevante
SAMPLE_MIN_LEADS = 3       # leads mínimos para julgar o anúncio
TOP_ADS_N = 10             # nº de linhas de referência dos rankings

# Metas & parâmetros da conta (DEFAULTS do painel editável da aba Insights de IA).
# São só o valor inicial: o gestor edita no navegador (localStorage) e a tabela
# de anúncios recolore CPL/CPMQL e reavalia o Status ao vivo. None = "não definida".
# Metas iniciais sugeridas (custo por venda alvo R$ 700 = R$ 70.000 / 100 vagas):
# CPL R$ 70 supõe ~10% dos leads virando venda; CPMQL R$ 160 supõe ~23% dos MQLs
# (Tx MQL ~44%). Hipótese de trabalho — recalibrar quando houver dados de vendas.
META_CPL = 70.0            # meta de CPL (R$/lead); None = não definida
META_CPMQL = 160.0         # meta de CPMQL (R$/MQL); None = não definida
VOLUME_MIN_AMOSTRAL = SAMPLE_MIN_LEADS  # leads mínimos p/ amostra confiável
N_DIAS_CORTE = 5           # dias consecutivos acima do teto p/ considerar corte


# --------------------------------------------------------------------------- #
# Metas & cronograma do briefing do cliente (Briefing de Tráfego · Imersão AYA,
# 30/10/2026) — alimentam a aba "Metas & Pacing". Datas em AAAA-MM-DD.
# --------------------------------------------------------------------------- #
PLANO = {
    "inicio": "2026-11-03",          # início da verba e das vendas
    "fim_vendas": "2027-02-05",      # vendas encerram
    "fim_verba": "2027-02-23",       # verba termina no 1º dia da imersão (06/02-23/02 = só conteúdo)
    "imersao": "2027-02-23",         # imersão presencial 23 e 24/02/2027
    "ingresso": 10000.0,             # R$ por vaga
    "orcamento_total": 70000.0,      # captação + distribuição de conteúdo, 03/11/2026 a 23/02/2027
    "meta_vagas": 100,
    "super_vagas": 150,
    # Curva de vendas: média simples dentro de cada fase (como no briefing).
    "fases": [
        {"nome": "Fase 1", "inicio": "2026-11-03", "fim": "2026-12-31", "meta": 70, "super": 105},
        {"nome": "Fase 2", "inicio": "2027-01-01", "fim": "2027-02-05", "meta": 30, "super": 45},
    ],
    # Orçamento planejado por mês (R$). None = plano LINEAR por dia (R$ 70.000 / 113 dias
    # = R$ 619,47/dia). O briefing pede que o Rafael proponha a divisão (a maior parte da
    # captação em nov/dez) — quando ela existir, preencha p.ex.:
    #   {"2026-11": 25000, "2026-12": 22000, "2027-01": 15000, "2027-02": 8000}
    # (cada mês é distribuído igualmente pelos dias do plano dentro dele).
    "orcamento_mensal": None,
}

# --------------------------------------------------------------------------- #
# Caminho de captação (briefing: medir os dois separadamente)
#   Caminho 1 = criativo -> PÁGINA -> formulário · Caminho 2 = criativo -> FORMULÁRIO direto
# Identificação, nesta ordem:
#   1. token no nome da campanha/conjunto/anúncio (Meta) ou nas UTMs (lead):
#      "LP", "PAGINA", "LANDING", "C1"  -> Caminho 1
#      "FORM", "FORMULARIO", "DIRETO", "TYPEFORM", "C2" -> Caminho 2
#      (token = pedaço separado por espaço, "|", "-", "_"; ex.: "MS | E2-CAP | FORM | ...")
#   2. sem token: campanha com Landing Page Views > 0 -> Caminho 1 (INFERIDO: a página
#      tem pixel; o Typeform direto não registra page view);
#   3. senão -> "Não identificado" (ex.: campanha de seguidores/conteúdo).
# --------------------------------------------------------------------------- #
CAMINHO_TOKENS = {
    "form": {"form", "formulario", "direto", "typeform", "c2"},
    "lp": {"lp", "pagina", "landing", "c1"},
}


def caminho_por_token(*texts: str) -> str | None:
    tokens = set(re.split(r"[^a-z0-9]+", norm(" ".join(t or "" for t in texts))))
    if tokens & CAMINHO_TOKENS["form"]:
        return "form"
    if tokens & CAMINHO_TOKENS["lp"]:
        return "lp"
    return None


# Vendas confirmadas (vagas): ainda SEM fonte de dados. Quando o comercial tiver uma
# planilha de vendas, ela entra aqui e a aba Metas & Pacing passa a mostrar vendido x meta.
VENDAS_FONTE = None


# --------------------------------------------------------------------------- #
# Leitura
# --------------------------------------------------------------------------- #
FETCH_RETRIES = 3       # tentativas totais em caso de timeout/erro de rede no export CSV
FETCH_RETRY_DELAY = 15  # segundos entre tentativas (o Google Sheets às vezes trava a resposta)


def fetch_csv(url: str) -> list[list[str]]:
    req = urllib.request.Request(url, headers={"User-Agent": "dash-aya-imersao-bot/1.0"})
    last_err: Exception | None = None
    for attempt in range(1, FETCH_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                raw = resp.read().decode("utf-8-sig", errors="replace")
            return list(csv.reader(io.StringIO(raw)))
        except (TimeoutError, urllib.error.URLError) as exc:
            last_err = exc
            if attempt < FETCH_RETRIES:
                print(f"[fetch_csv] tentativa {attempt}/{FETCH_RETRIES} falhou ({exc!r}); "
                      f"tentando de novo em {FETCH_RETRY_DELAY}s...", file=sys.stderr)
                time.sleep(FETCH_RETRY_DELAY)
    raise last_err


def read_csv_file(path: str) -> list[list[str]]:
    with open(path, "r", encoding="utf-8-sig", errors="replace", newline="") as f:
        return list(csv.reader(f))


def load_rows(url: str, local: str | None) -> list[list[str]]:
    return read_csv_file(local) if local else fetch_csv(url)


def header_has(rows: list[list[str]], required_aliases: list[list[str]]) -> bool:
    """True se o cabeçalho (1a linha) tem, para cada grupo, ao menos um dos aliases."""
    if not rows:
        return False
    hn = [norm(h) for h in rows[0]]
    for aliases in required_aliases:
        if not any(norm(a) == h or (norm(a) and norm(a) in h) for a in aliases for h in hn):
            return False
    return True


# Colunas obrigatórias de cada planilha — se faltarem, o build FALHA (o Pages
# mantém a última versão publicada em vez de publicar uma dash vazia/errada).
LEADS_REQUIRED = [["utm_medium"], ["submitted at"], ["faturamento medio mensal"], ["nome completo"]]
META_REQUIRED = [["day"], ["campaign name"], ["ad set name"], ["ad name"], ["amount spent"],
                 ["impressions"], ["link clicks"]]


def load_sheet(sid: str, gid: str | None, local: str | None, required, label: str) -> list[list[str]]:
    if local:
        rows = read_csv_file(local)
        if not header_has(rows, required):
            sys.exit(f"[{label}] CSV local sem o cabeçalho esperado: {rows[0] if rows else '(vazio)'}")
        return rows
    if gid is None:                      # configurado para ler direto a 1a aba
        rows = fetch_csv(EXPORT_URL_FIRST_TAB.format(sid=sid))
        if header_has(rows, required):
            return rows
        sys.exit(f"[{label}] 1a aba sem o cabeçalho esperado ({rows[0][:6] if rows else 'vazio'}) — "
                 f"confira a planilha e se ela está compartilhada como 'qualquer pessoa com o link pode ver'.")
    rows = fetch_csv(EXPORT_URL.format(sid=sid, gid=gid))
    if header_has(rows, required):
        return rows
    print(f"[{label}] gid={gid} sem o cabeçalho esperado ({rows[0][:6] if rows else 'vazio'}); "
          f"tentando a 1a aba da planilha...", file=sys.stderr)
    rows = fetch_csv(EXPORT_URL_FIRST_TAB.format(sid=sid))
    if header_has(rows, required):
        return rows
    sys.exit(f"[{label}] nenhuma aba com o cabeçalho esperado — confira o ID/gid da planilha "
             f"e se ela está compartilhada como 'qualquer pessoa com o link pode ver'.")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm(s: str | None) -> str:
    return strip_accents((s or "").strip().lower())


def clean_name(s: str | None) -> str:
    """Nome de campanha/conjunto/anúncio para exibição: sem espaços duplicados/nas pontas."""
    return re.sub(r"\s+", " ", (s or "").strip())


def match_key(s: str | None) -> str:
    """Chave do casamento leads × Meta: sem maiúsculas e sem espaços duplicados."""
    return clean_name(s).casefold()


_MACRO_RE = re.compile(r"\{\{.*\}\}")


def utm_value(s: str | None) -> str:
    """UTM vazia ou com a macro do Meta NÃO substituída ("{{campaign.name}}") = sem valor."""
    v = clean_name(s)
    return "" if (not v or _MACRO_RE.search(v)) else v


def to_float(v) -> float:
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d,.\-]", "", str(v).strip())
    if not s:
        return 0.0
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def parse_date(v: str) -> str | None:
    """Dia SEM conversao de fuso — usado no "Day" do Meta Ads, que ja vem fechado
    no fuso da conta. Para os leads use parse_lead_date()."""
    if not v:
        return None
    s = str(v).strip()
    if not s:
        return None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    s = s.split()[0]          # "08/09/2026 15:15" -> "08/09/2026"
    for fmt in ("%d/%m/%Y", "%d/%m/%y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def parse_lead_datetime(v: str) -> datetime | None:
    """Data/hora do lead convertida para ACCOUNT_TZ.

    "Submitted At" vem como "06/11/2026 10:41:19" (dd/mm/aaaa, UTC, sem offset).
    Com offset explícito (ISO), respeita o offset; sem offset, assume LEADS_TZ."""
    if not v:
        return None
    s = re.sub(r"\s+", " ", str(v).strip())
    if not s:
        return None
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y"):
        try:
            dt = datetime.strptime(s, fmt)
        except ValueError:
            continue
        return dt.replace(tzinfo=LEADS_TZ).astimezone(ACCOUNT_TZ)
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=LEADS_TZ)
    return dt.astimezone(ACCOUNT_TZ)


# --------------------------------------------------------------------------- #
# Faturamento -> MQL
# --------------------------------------------------------------------------- #
_AMOUNT_RE = re.compile(r"(\d+(?:[.,]\d+)*)\s*(mil|milhao|milhoes|mi|k|bilhao|bilhoes|bi)?\b")
_UNITS = {"mil": 1e3, "k": 1e3, "milhao": 1e6, "milhoes": 1e6, "mi": 1e6,
          "bilhao": 1e9, "bilhoes": 1e9, "bi": 1e9}


def _amount(numtxt: str, unit: str | None) -> float:
    t = numtxt
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", t):        # 1.000.000 (milhar com ponto)
        t = t.replace(".", "")
    elif re.fullmatch(r"\d{1,3}(\.\d{3})+,\d+", t):  # 1.000,50
        t = t.replace(".", "").replace(",", ".")
    else:
        t = t.replace(",", ".")
    try:
        val = float(t)
    except ValueError:
        return 0.0
    return val * _UNITS.get(unit or "", 1.0)


def faturamento_piso(v: str | None) -> float | None:
    """Piso (R$) da faixa de faturamento médio mensal respondida.

    "De R$ 50 mil a R$ 100 mil" -> 50000 · "Até R$ 10 mil" -> 0 ·
    "Acima de R$ 1 milhão" -> 1000000 · vazio/não reconhecido -> None."""
    s = norm(v)
    if not s:
        return None
    amounts = [_amount(n, u) for n, u in _AMOUNT_RE.findall(s)]
    amounts = [a for a in amounts if a > 0]
    if re.match(r"^(ate|menos de|abaixo de|nao fatur|sem fatur|zero)", s):
        return 0.0
    if not amounts:
        return None
    if re.match(r"^(acima de|mais de|a partir de|superior a)", s):
        return amounts[0]
    return min(amounts)


def is_mql(v: str | None) -> bool:
    piso = faturamento_piso(v)
    return piso is not None and piso >= MQL_MIN_FATURAMENTO


# --------------------------------------------------------------------------- #
# Regra de LEAD VÁLIDO
# --------------------------------------------------------------------------- #
# Cadastro de teste: e-mail da equipe (TEST_EMAILS), domínio de teste ou nome/
# e-mail que começa com a palavra "teste"/"test" (ex.: "Teste"). Nunca bate em
# nome real que só contenha essas letras no meio (ex.: "Celeste").
_TEST_WORD_RE = re.compile(r"^(teste|test)\d*$")
_TEST_EMAIL_DOMAINS = ("teste.com", "test.com", "example.com", "meta.com")


def is_test_lead(name: str, email: str) -> bool:
    e = norm(email)
    if e in {x.lower() for x in TEST_EMAILS}:
        return True
    first = (norm(name).split() or [""])[0]
    if _TEST_WORD_RE.match(first):
        return True
    if "@" in e:
        local, _, domain = e.partition("@")
        if domain in _TEST_EMAIL_DOMAINS or _TEST_WORD_RE.match(local):
            return True
    return False


def lead_origin(utm_medium: str) -> str | None:
    """"meta" (tráfego pago), "social" (orgânico) ou None (fora da regra)."""
    return VALID_UTM_MEDIUMS.get(norm(utm_medium))


def lead_discard_reason(utm_medium: str, name: str, email: str, phone: str) -> str | None:
    """None = lead válido. Senão, o motivo do descarte (para o log do build)."""
    if lead_origin(utm_medium) is None:
        return "utm_medium_invalido"
    if not (name.strip() and email.strip() and phone.strip()):
        return "incompleto"
    if is_test_lead(name, email):
        return "teste"
    return None


def is_valid_lead(utm_medium: str, name: str, email: str, phone: str) -> bool:
    return lead_discard_reason(utm_medium, name, email, phone) is None


def first_last_initial(name: str) -> str:
    parts = (name or "").strip().split()
    if not parts:
        return "—"
    return parts[0] if len(parts) == 1 else f"{parts[0]} {parts[-1][:1]}."


def mask_email(e: str) -> str:
    e = (e or "").strip()
    if "@" not in e:
        return "—"
    user, dom = e.split("@", 1)
    keep = user[:2] if len(user) > 2 else user[:1]
    return f"{keep}****@{dom}"


def mask_phone(p: str) -> str:
    digits = re.sub(r"\D", "", p or "")   # tira o "+" e a formatação, sobra só dígito
    return f"…{digits[-4:]}" if len(digits) >= 4 else "—"


def pretty_answer(v: str) -> str:
    s = re.sub(r"\s+", " ", (v or "").strip()).rstrip(" .")
    return (s[:1].upper() + s[1:]) if s else "Sem resposta"


# Origem do lead (utm_source) -> rótulo legível.
SOURCE_LABELS = {
    "meta-ads": "Meta Ads", "facebook-ads": "Meta Ads", "fb": "Facebook", "facebook": "Facebook",
    "ig": "Instagram", "instagram": "Instagram",
}


def pretty_source(src: str, utm_source: str) -> str:
    us = norm(utm_source)
    base = SOURCE_LABELS.get(us, clean_name(utm_source) or "sem utm_source")
    return f"{'Pago' if src == 'meta' else 'Social'} · {base}"


# --------------------------------------------------------------------------- #
# Indexacao das colunas
# --------------------------------------------------------------------------- #
def header_index(header, wanted):
    """1º passe: nome exato (normalizado); 2º passe: cabeçalho que CONTÉM o alias.
    Sem fallback posicional: coluna não encontrada = None (o build avisa no log)."""
    idx = {}
    hn = [norm(h) for h in header]
    for key, aliases in wanted.items():
        found = None
        for a in aliases:
            a = norm(a)
            for i, h in enumerate(hn):
                if h == a:
                    found = i
                    break
            if found is not None:
                break
        if found is None:
            for a in aliases:
                a = norm(a)
                for i, h in enumerate(hn):
                    if a and a in h:
                        found = i
                        break
                if found is not None:
                    break
        idx[key] = found
    return idx


def cell(row, i):
    if i is None or i < 0 or i >= len(row):
        return ""
    return (row[i] or "").strip()


def col_letter(i: int | None) -> str:
    if i is None:
        return "-"
    s, n = "", i + 1
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


# --------------------------------------------------------------------------- #
# Processamento -> registros brutos
# --------------------------------------------------------------------------- #
def process(leads_rows, meta_rows):
    # ---- Meta Ads (Queries | AYA) ----
    mheader = meta_rows[0] if meta_rows else []
    midx = header_index(
        mheader,
        {"day": ["day", "data"], "campaign": ["campaign name"],
         "adset": ["ad set name", "adset name"], "ad": ["ad name"],
         "spent": ["amount spent", "valor gasto"], "impr": ["impressions", "impressoes"],
         "clicks": ["link clicks", "cliques no link"], "reach": ["reach", "alcance"],
         "lpv": ["landing page views", "visualizacoes da pagina de destino"]},
    )
    print(f"  [meta] colunas mapeadas: { {k: col_letter(v) for k, v in midx.items()} }", file=sys.stderr)

    meta = []
    # chave de casamento (camp, adset, ad) -> nomes de exibição do Meta
    meta_keys: dict[tuple[str, str, str], tuple[str, str, str]] = {}
    for row in meta_rows[1:]:
        if not any((c or "").strip() for c in row):
            continue
        day = parse_date(cell(row, midx["day"]))
        camp = clean_name(cell(row, midx["campaign"]))
        if not day and not camp:
            continue
        adset = clean_name(cell(row, midx["adset"])) or "(sem conjunto)"
        ad = clean_name(cell(row, midx["ad"])) or "(sem anúncio)"
        camp = camp or "(sem campanha)"
        meta_keys.setdefault((match_key(camp), match_key(adset), match_key(ad)), (camp, adset, ad))
        meta.append({
            "d": day,
            "camp": camp,
            "adset": adset,
            "ad": ad,
            "sp": round(to_float(cell(row, midx["spent"])), 4),
            "im": to_float(cell(row, midx["impr"])),
            "cl": to_float(cell(row, midx["clicks"])),
            "rc": to_float(cell(row, midx["reach"])),
            "pv": to_float(cell(row, midx["lpv"])),
        })
    # mesmo nome de campanha/conjunto/anúncio escrito com caixa diferente -> 1 nome só
    canon = {"camp": {}, "adset": {}, "ad": {}}
    for m in meta:
        for k in canon:
            canon[k].setdefault(match_key(m[k]), m[k])
    for m in meta:
        for k in canon:
            m[k] = canon[k][match_key(m[k])]

    # ---- Caminho de captação por linha do Meta ----
    pv_camp: dict[str, float] = {}
    for m in meta:
        pv_camp[m["camp"]] = pv_camp.get(m["camp"], 0.0) + m["pv"]
    cam_inferido = False
    cam_por_camp: dict[str, str] = {}
    for m in meta:
        cam = caminho_por_token(m["camp"]) or caminho_por_token(m["adset"]) or caminho_por_token(m["ad"])
        if not cam:
            cam = "lp" if pv_camp.get(m["camp"], 0) > 0 else "ni"
            m["cami"] = 1 if cam == "lp" else 0      # 1 = inferido (sem token no nome)
            cam_inferido = cam_inferido or cam == "lp"
        else:
            m["cami"] = 0
        m["cam"] = cam
        cam_por_camp.setdefault(m["camp"], cam)
    cam_por_tripla = {(match_key(m["camp"]), match_key(m["adset"]), match_key(m["ad"])): m["cam"] for m in meta}

    # ---- Leads (formulário da LP / Typeform) ----
    lheader = leads_rows[0] if leads_rows else []
    lidx = header_index(
        lheader,
        {"submitted": ["submitted at"], "token": ["token"],
         "name": ["qual e o seu nome completo", "nome completo"],
         "phone": ["qual e o seu whatsapp com ddd", "whatsapp"],
         "email": ["qual e o seu melhor e-mail", "e-mail", "email"],
         "papel": ["qual e o seu papel na empresa"],
         "faturamento": ["qual e o faturamento medio mensal da empresa", "faturamento medio mensal"],
         "comportamento": ["como o faturamento se comportou", "faturamento se comportou"],
         "desafio": ["qual e o maior desafio comercial da empresa hoje", "maior desafio comercial"],
         "utm_source": ["utm_source"], "utm_medium": ["utm_medium"], "utm_campaign": ["utm_campaign"],
         "utm_term": ["utm_term"], "utm_content": ["utm_content"]},
    )
    print(f"  [leads] colunas mapeadas: { {k: col_letter(v) for k, v in lidx.items()} }", file=sys.stderr)

    leads = []
    descartados = {"utm_medium_invalido": 0, "incompleto": 0, "teste": 0, "duplicado": 0}
    sem_meta = 0
    fat_nao_reconhecido: set[str] = set()
    tokens_vistos: set[str] = set()
    for row in leads_rows[1:]:
        if not any((c or "").strip() for c in row):
            continue
        name = cell(row, lidx["name"])
        email = cell(row, lidx["email"])
        phone = cell(row, lidx["phone"])
        utm_medium = cell(row, lidx["utm_medium"])
        why = lead_discard_reason(utm_medium, name, email, phone)
        if why:
            descartados[why] += 1
            continue
        token = cell(row, lidx["token"])
        if token:
            if token in tokens_vistos:      # mesma resposta do Typeform gravada 2x
                descartados["duplicado"] += 1
                continue
            tokens_vistos.add(token)
        src = lead_origin(utm_medium)
        dt = parse_lead_datetime(cell(row, lidx["submitted"]))

        if src == "meta":
            camp = utm_value(cell(row, lidx["utm_campaign"]))
            adset = utm_value(cell(row, lidx["utm_term"]))
            ad = utm_value(cell(row, lidx["utm_content"]))
            hit = meta_keys.get((match_key(camp), match_key(adset), match_key(ad))) if (camp and adset and ad) else None
            if hit:
                camp, adset, ad = hit
            else:   # sem casamento exato: usa o nome canônico do Meta quando a dimensão existe lá
                camp = canon["camp"].get(match_key(camp), camp) if camp else "(sem UTM de campanha)"
                adset = canon["adset"].get(match_key(adset), adset) if adset else "(sem UTM de conjunto)"
                ad = canon["ad"].get(match_key(ad), ad) if ad else "(sem UTM de anúncio)"
            trk = 1 if hit else 0
            sem_meta += 1 - trk
        else:       # orgânico (social): não pertence a nenhuma campanha paga
            camp = adset = ad = "(orgânico · sem anúncio)"
            trk = 0

        if src == "meta":
            cam = (cam_por_tripla.get((match_key(camp), match_key(adset), match_key(ad))) if trk else None) \
                or caminho_por_token(cell(row, lidx["utm_source"]), cell(row, lidx["utm_campaign"]),
                                     cell(row, lidx["utm_term"]), cell(row, lidx["utm_content"])) \
                or cam_por_camp.get(camp) or "ni"
        else:
            cam = "org"
        fat_raw = cell(row, lidx["faturamento"])
        piso = faturamento_piso(fat_raw)
        if fat_raw and piso is None:
            fat_nao_reconhecido.add(fat_raw)
        leads.append({
            "d": dt.strftime("%Y-%m-%d") if dt else None,
            "h": dt.strftime("%H:%M") if dt else None,
            "src": src,                                    # "meta" | "social"
            "orig": pretty_source(src, cell(row, lidx["utm_source"])),
            "camp": camp,
            "adset": adset,
            "ad": ad,
            # 1 = campanha+conjunto+anúncio das UTMs existem na aba de Queries
            # (tem gasto/impressões rastreados); 0 = lead pago sem mídia correspondente.
            "trk": trk,
            "cam": cam,                                    # lp | form | ni | org
            "q": 1 if (piso is not None and piso >= MQL_MIN_FATURAMENTO) else 0,   # MQL
            "fat": pretty_answer(fat_raw),
            "fatv": piso,                                  # piso da faixa (ordena o gráfico)
            "papel": pretty_answer(cell(row, lidx["papel"])),
            "comp": pretty_answer(cell(row, lidx["comportamento"])),
            "desafio": pretty_answer(cell(row, lidx["desafio"])),
            "nm": first_last_initial(name),
            "em": mask_email(email),
            "ph": mask_phone(phone),
        })

    dates = sorted({d for d in ([l["d"] for l in leads if l["d"]] + [m["d"] for m in meta if m["d"]])})
    now_brt = datetime.now(BRT)              # carimbo "ultima atualizacao" (hora local do gestor)
    hoje_conta = datetime.now(ACCOUNT_TZ)    # "hoje" do funil = dia no fuso da conta de anuncios
    return {
        "build": {
            "generated_at_brt": now_brt.strftime("%d/%m/%Y %H:%M"),
            "build_id": datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"),
            "today": hoje_conta.strftime("%Y-%m-%d"),
            "date_min": dates[0] if dates else None,
            "date_max": dates[-1] if dates else None,
            "tax_factor": TAX_FACTOR,
            "account_tz": ACCOUNT_TZ_NAME,
            "client_name": CLIENT_NAME,
            "main_product": MAIN_PRODUCT,
            "mql_min_faturamento": MQL_MIN_FATURAMENTO,
            # config da aba Insights de IA (lida pelo front)
            "sample_min_spend": SAMPLE_MIN_SPEND,
            "sample_min_leads": SAMPLE_MIN_LEADS,
            "top_ads_n": TOP_ADS_N,
            # metas & parâmetros (defaults do painel editável; None = não definida)
            "meta_cpl": META_CPL,
            "meta_cpmql": META_CPMQL,
            "volume_min_amostral": VOLUME_MIN_AMOSTRAL,
            "n_dias_corte": N_DIAS_CORTE,
            # diagnóstico (log do build)
            "leads_descartados": descartados,
            "leads_sem_meta": sem_meta,
            "faturamento_nao_reconhecido": sorted(fat_nao_reconhecido),
            # metas/cronograma do briefing (aba Metas & Pacing)
            "plano": PLANO,
            "caminho_inferido": cam_inferido,
            "vendas_fonte": VENDAS_FONTE,
        },
        "leads": leads,
        "meta": meta,
        # vendas confirmadas [{d}] — vazio enquanto não houver fonte de vendas
        "vendas": [],
        # Insights de Tráfego (texto pré-escrito, lido de relatorios.json). Preenchido
        # em main() via load_briefings(); fica {} se relatorios.json não existir.
        "briefings": {},
    }


# --------------------------------------------------------------------------- #
# Insights de Tráfego (aba Insights de IA)
# --------------------------------------------------------------------------- #
def load_briefings(path: str) -> dict:
    """Lê build/relatorios.json. Estrutura:
        {"generated_at": "...", "periodos": {"<preset>": {...}, ...}}
    Retorna o dict inteiro (ou {} se o arquivo não existir/for inválido).
    A geração NÃO acontece aqui — este build só lê o texto já pronto, sem
    chamar nenhuma API (custo zero no build/no navegador)."""
    if not path or not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            obj = json.load(f)
        return obj if isinstance(obj, dict) else {}
    except (ValueError, OSError):
        return {}


# --------------------------------------------------------------------------- #
# Render
# --------------------------------------------------------------------------- #
def render(data, template_path):
    # A dashboard e montada a partir de arquivos separados (visual x logica):
    #   template.html          -> esqueleto HTML (placeholders __STYLES__/__APP_JS__)
    #   identidade-visual.css  -> TODAS as cores (edite aqui p/ mexer so em cor)
    #   estilos.css            -> layout/componentes
    #   app.js                 -> logica + renderizacao
    # Esta funcao so COSTURA os arquivos e injeta os dados; nao altera nada deles.
    base = os.path.dirname(os.path.abspath(template_path))

    def readf(name):
        with open(os.path.join(base, name), "r", encoding="utf-8") as f:
            return f.read()

    with open(template_path, "r", encoding="utf-8") as f:
        tpl = f.read()
    styles = readf("identidade-visual.css") + "\n" + readf("estilos.css")
    # "</" dentro do JSON fecharia o <script> do payload antes da hora
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    tpl = tpl.replace("__STYLES__", styles)
    tpl = tpl.replace("__APP_JS__", readf("app.js"))
    tpl = tpl.replace("__DATA_JSON__", payload)
    tpl = tpl.replace("__BUILD_ID__", data["build"]["build_id"])
    tpl = tpl.replace("__GENERATED_BRT__", data["build"]["generated_at_brt"])
    return tpl


def load_inputs(leads_file: str | None, meta_file: str | None):
    leads_rows = load_sheet(SPREADSHEET_ID_LEADS, GID_LEADS, leads_file, LEADS_REQUIRED, "leads")
    meta_rows = load_sheet(SPREADSHEET_ID_META, GID_META, meta_file, META_REQUIRED, "meta")
    return leads_rows, meta_rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--leads-file", help="CSV local da planilha de Leads (fonte principal)")
    ap.add_argument("--meta-file", help="CSV local da aba Queries | AYA (Meta Ads)")
    ap.add_argument("--template", default="build/template.html")
    ap.add_argument("--out", default="dist/index.html")
    args = ap.parse_args()

    leads_rows, meta_rows = load_inputs(args.leads_file, args.meta_file)
    data = process(leads_rows, meta_rows)

    # Insights de Tráfego (texto pré-escrito) — lidos do arquivo versionado ao
    # lado do template. Sem chamada de API no build.
    briefings_path = os.path.join(os.path.dirname(os.path.abspath(args.template)), "relatorios.json")
    data["briefings"] = load_briefings(briefings_path)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(render(data, args.template))

    b = data["build"]
    d = b["leads_descartados"]
    L = data["leads"]
    sp = sum(m["sp"] for m in data["meta"])
    n_meta = sum(1 for l in L if l["src"] == "meta")
    print("== build ok ==", file=sys.stderr)
    print(f"  periodo    : {b['date_min']} -> {b['date_max']} (hoje {b['today']})", file=sys.stderr)
    print(f"  leads      : {len(L)} válidos = {n_meta} tráfego pago + {len(L) - n_meta} social "
          f"· {sum(l['q'] for l in L)} MQLs (faturamento >= R$ {MQL_MIN_FATURAMENTO:,.0f})", file=sys.stderr)
    print(f"  descartados: {d['utm_medium_invalido']} sem utm_medium trafego-pago/social · "
          f"{d['incompleto']} incompletos · {d['teste']} de teste · {d['duplicado']} duplicados", file=sys.stderr)
    print(f"  sem mídia  : {b['leads_sem_meta']} lead(s) pago(s) cujo anúncio (UTMs) não aparece na aba de Queries",
          file=sys.stderr)
    if b["faturamento_nao_reconhecido"]:
        print(f"  ATENÇÃO    : faixa(s) de faturamento não reconhecida(s) (contam como não-MQL): "
              f"{b['faturamento_nao_reconhecido']}", file=sys.stderr)
    print(f"  meta       : {len(data['meta'])} linhas · gasto R$ {sp:,.2f} "
          f"(sem imposto; fator {TAX_FACTOR})", file=sys.stderr)
    print(f"  out        : {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
