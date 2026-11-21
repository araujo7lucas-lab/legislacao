#!/usr/bin/env python3
"""Coletor internacional — notícias da FAO e do Codex Alimentarius e alertas do RASFF (UE) sobre produtos do Brasil.

Grava site/data/internacional.js (+ .json), lido pela página.

Uso:
    python3 coletor_internacional.py                    # rotina diária (últimos 60 dias)
    python3 coletor_internacional.py --desde 2026-01-01 # carga completa
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
DADOS = RAIZ / "site" / "data"
SAIDA_JSON = DADOS / "internacional.json"
SAIDA_JS = DADOS / "internacional.js"
UA = "Mozilla/5.0 (X11; Linux x86_64) legislacao-coletor/1.0"

URL_FAO = "https://www.fao.org/food-safety/news/GetContent/{pagina}/en/"
URL_CODEX = "https://codex.fao.org/news/SearchNews/"
URL_RASFF = "https://webgate.ec.europa.eu/rasff-window/backend/public/notification/search/consolidated/"
URL_RASFF_TELA = "https://webgate.ec.europa.eu/rasff-window/screen/notification/{id}"
NOMES_BRASIL = ["Brazil", "Brasil", "Brazylia", "Brésil", "Brasile", "Brasilien", "Brazílie", "Brazilië"]

# Perigos (regex sobre texto em inglês/português, sem acento, minúsculo)
PERIGOS = [
    ("Microbiologia", r"salmonel|listeri|e\.? ?coli|stec|escherichia|norovirus|hepatitis a|bacillus|cereulid|clostrid|botulin|"
                      r"staphyl|campylobac|cronobac|enterobac|vibrio|cyclospora|parasit|mould|mold|yeast|microb|pathogen|"
                      r"food hygiene|ccfh|antimicrobial|amr\b|bacteri"),
    ("Micotoxinas", r"aflatox|ochratox|mycotox|micotox|fumonis|deoxyniv|zearalen|patulin|ergot"),
    ("Alergênicos", r"allergen|alergen|undeclared|gluten|peanut|sesame|mustard|celery|lupin|crustacean|tree nut|ccfl"),
    ("Contaminantes químicos", r"contaminant|cccf|lead\b|cadmium|mercury|arsenic|dioxin|pcb|benzo\(a\)|pah\b|ethylene oxide|"
                               r"melamine|acrylamide|chlorate|perchlorate|microplastic|pfas|3-mcpd|glycidyl"),
    ("Resíduos (agrotóxicos/veterinários)", r"pesticid|residue|ccpr|ccrvdf|chlorpyrif|carbendaz|veterinary drug|"
                                            r"enrofloxac|tetracycl|nitrofuran|chloramphenic|jecfa|chlorpyri|carbofuran|diafenthiuron|imidaclopr|"
                                            r"acetamiprid|fipronil|unapproved substance|ethion|profenofos"),
    ("Aditivos", r"benzoic|sorbic|sulphite|sulfite|sulphur dioxide|colou?r|\be ?\d{3}\b|additive|ccfa"),
    ("Matérias estranhas", r"foreign bod|physical contamination|glass|metal fragment|plastic fragment|insect|rodent"),
    ("Temperatura / conservação", r"temperature|cold chain|poor (state|condition)|preservation|spoil|decompos|thaw|deteriorat|vacuum|cattivo stato"),
    ("Rotulagem / fraude", r"label|fraud|unauthori[sz]ed|novel food|illegal|certificate|not approved|establishment|consignment|dna\b"),
]
CLASSIFICACOES = {
    "border rejection notification": "Rejeição na fronteira",
    "alert notification": "Alerta",
    "information notification for follow-up": "Informação para acompanhamento",
    "information notification for attention": "Informação para atenção",
    "non-compliance notification": "Não conformidade",
    "news": "Notícia",
}
RISCOS = {"serious": "Grave", "not serious": "Não grave", "potentially serious": "Potencialmente grave",
          "potential risk": "Risco potencial", "undecided": "Indefinido", "no risk": "Sem risco"}
PAISES = {"Austria": "Áustria", "Belgium": "Bélgica", "Bulgaria": "Bulgária", "Croatia": "Croácia", "Cyprus": "Chipre",
          "Czech Republic": "República Tcheca", "Czechia": "República Tcheca", "Denmark": "Dinamarca", "Estonia": "Estônia",
          "Finland": "Finlândia", "France": "França", "Germany": "Alemanha", "Greece": "Grécia", "Hungary": "Hungria",
          "Iceland": "Islândia", "Ireland": "Irlanda", "Italy": "Itália", "Latvia": "Letônia", "Lithuania": "Lituânia",
          "Luxembourg": "Luxemburgo", "Malta": "Malta", "Netherlands": "Holanda", "Norway": "Noruega", "Poland": "Polônia",
          "Portugal": "Portugal", "Romania": "Romênia", "Slovakia": "Eslováquia", "Slovenia": "Eslovênia", "Spain": "Espanha",
          "Sweden": "Suécia", "Switzerland": "Suíça", "Liechtenstein": "Liechtenstein", "United Kingdom": "Reino Unido",
          "Northern Ireland": "Irlanda do Norte", "European Commission": "Comissão Europeia"}
CATEGORIAS = {
    "poultry meat and poultry meat products": "Carne de aves",
    "meat and meat products (other than poultry)": "Carnes (exceto aves)",
    "fruits and vegetables": "Frutas e hortaliças",
    "nuts, nut products and seeds": "Castanhas e sementes",
    "herbs and spices": "Ervas e especiarias",
    "cereals and bakery products": "Cereais e panificação",
    "fish and fish products": "Pescados",
    "feed materials": "Alimentação animal",
    "compound feeds": "Alimentação animal",
    "animal by-products": "Subprodutos animais",
    "cocoa and cocoa preparations, coffee and tea": "Cacau, café e chá",
    "fats and oils": "Óleos e gorduras",
    "milk and milk products": "Leite e derivados",
    "honey and royal jelly": "Mel",
    "dietetic foods, food supplements and fortified foods": "Suplementos",
    "other food product / mixed": "Outros alimentos",
}


def sem_acento(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()


def perigos_de(texto: str) -> list[str]:
    t = sem_acento(texto)
    return [rotulo for rotulo, rx in PERIGOS if re.search(rx, t)]


def requisitar(url: str, corpo: dict | None = None, tentativas: int = 3) -> str:
    erro = None
    for i in range(tentativas):
        try:
            dados = json.dumps(corpo).encode() if corpo is not None else None
            req = urllib.request.Request(url, data=dados, headers={
                "User-Agent": UA, "Accept-Language": "en", **({"Content-Type": "application/json"} if dados else {})})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001 — rede instável: tenta de novo
            erro = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"falha em {url}: {erro}")


# --------------------------------------------------------------------------- #
# Tradução para português (cache em traducoes.json + MyMemory para textos novos)
# --------------------------------------------------------------------------- #
CACHE_TRADUCOES = RAIZ / "traducoes.json"
URL_MYMEMORY = "https://api.mymemory.translated.net/get?{q}"
_cache: dict[str, str] | None = None
_cota_esgotada = False


def _carregar_cache() -> dict[str, str]:
    global _cache
    if _cache is None:
        _cache = json.loads(CACHE_TRADUCOES.read_text(encoding="utf-8")) if CACHE_TRADUCOES.exists() else {}
    return _cache


def salvar_cache() -> None:
    if _cache is not None:
        CACHE_TRADUCOES.write_text(json.dumps(_cache, ensure_ascii=False, indent=1), encoding="utf-8")


def _mymemory(trecho: str) -> str | None:
    global _cota_esgotada
    q = urllib.parse.urlencode({"q": trecho, "langpair": "autodetect|pt-BR"})
    try:
        d = json.loads(requisitar(URL_MYMEMORY.format(q=q), tentativas=2))
    except RuntimeError:
        return None
    if d.get("quotaFinished") or d.get("responseStatus") not in (200, "200"):
        _cota_esgotada = True
        return None
    return html.unescape(d.get("responseData", {}).get("translatedText") or "") or None


def traduzir(texto: str) -> str | None:
    """Devolve o texto em português, ou None se não deu para traduzir agora (tenta de novo na próxima rodada)."""
    if not texto:
        return None
    cache = _carregar_cache()
    if texto in cache:
        return cache[texto]
    if _cota_esgotada:
        return None
    partes, atual = [], ""
    for frase in re.split(r"(?<=[.!?…])\s+", texto):  # MyMemory aceita até ~500 caracteres por pedido
        if len(atual) + len(frase) > 450 and atual:
            partes.append(atual); atual = ""
        atual = f"{atual} {frase}".strip()
    if atual:
        partes.append(atual)
    traduzidas = []
    for p in partes:
        t = _mymemory(p[:480])
        if t is None:
            return None
        traduzidas.append(t)
        time.sleep(0.4)
    cache[texto] = " ".join(traduzidas)
    return cache[texto]


def limpar(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


# --------------------------------------------------------------------------- #
def coletar_fao(desde: dt.date) -> list[dict]:
    noticias = []
    for pagina in range(1, 40):
        bruto = requisitar(URL_FAO.format(pagina=pagina))
        blocos = bruto.split('class="d-list d-list-news"')[1:]
        if not blocos:
            break
        antiga = False
        for b in blocos:
            m_link = re.search(r'<h5 class="title-link">\s*<a\s+href="([^"]+)">(.*?)</a>', b, re.S)
            m_data = re.search(r'<span class="date">(\d{2})/(\d{2})/(\d{4})</span>', b)
            if not (m_link and m_data):
                continue
            data = dt.date(int(m_data.group(3)), int(m_data.group(2)), int(m_data.group(1)))
            if data < desde:
                antiga = True
                continue
            m_desc = re.search(r'<p class="d-list-description">(.*?)</div>', b, re.S)
            titulo, resumo = limpar(m_link.group(2)), limpar(m_desc.group(1) if m_desc else "")
            noticias.append({
                "id": "fao-" + re.sub(r"\W+", "-", m_link.group(1).split("/detail/")[-1])[:90],
                "fonte": "FAO", "titulo": titulo, "resumo": resumo, "data": data.isoformat(),
                "url": m_link.group(1).replace(":443", ""), "comite": "",
                "temas": perigos_de(f"{titulo} {resumo}"),
            })
        if antiga:
            break
        time.sleep(0.5)
    return noticias


def coletar_codex(desde: dt.date) -> list[dict]:
    noticias, pagina = [], 1
    while True:
        d = json.loads(requisitar(URL_CODEX, {"CurrentPage": pagina, "PageSize": 100, "StartDate": desde.isoformat()}))
        lote = d.get("News") or []
        for n in lote:
            titulo, resumo = limpar(n.get("Title", "")), limpar(n.get("Summary", ""))
            comites = [c["Item2"] for c in n.get("Categories") or [] if c.get("Item2")]
            noticias.append({
                "id": "codex-" + n["Url"].rstrip("/").rsplit("/", 1)[-1][:90],
                "fonte": "Codex", "titulo": titulo, "resumo": resumo, "data": n.get("PublicationDate", "")[:10],
                "url": n.get("Url", ""), "comite": ", ".join(comites),
                "temas": perigos_de(f"{titulo} {resumo} {' '.join(comites)}"),
            })
        if len(lote) < 100 or pagina * 100 >= (d.get("TotalCount") or 0):
            break
        pagina += 1
    return noticias


def coletar_rasff(desde: dt.date) -> list[dict]:
    vistos = {}
    for nome in NOMES_BRASIL:
        pagina = 1
        while True:
            corpo = {"parameters": {"pageNumber": pagina, "itemsPerPage": 100}, "subject": nome,
                     "ecValidDateFrom": desde.strftime("%d-%m-%Y 00:00:00")}
            lote = json.loads(requisitar(URL_RASFF, corpo)).get("notifications") or []
            for n in lote:
                if any(o.get("isoCode") == "BR" for o in n.get("originCountries") or []):
                    vistos[n["notifId"]] = n
            if len(lote) < 100:
                break
            pagina += 1
        time.sleep(0.5)
    alertas = []
    for n in vistos.values():
        d, m, a = n["ecValidationDate"][:10].split("-")
        assunto = n.get("subject", "").strip()
        cat = (n.get("productCategory") or {}).get("description", "")
        classe = (n.get("notificationClassification") or {}).get("description", "")
        risco = (n.get("riskDecision") or {}).get("description", "")
        alertas.append({
            "id": str(n["notifId"]), "referencia": n.get("reference", ""), "data": f"{a}-{m}-{d}",
            "assunto": assunto, "categoria": CATEGORIAS.get(cat, cat.capitalize()), "categoria_en": cat,
            "tipo_produto": (n.get("productType") or {}).get("description", ""),
            "classificacao": CLASSIFICACOES.get(classe, classe.capitalize()),
            "risco": RISCOS.get(risco.lower(), risco.capitalize()),
            "notificante": PAISES.get(pais := (n.get("notifyingCountry") or {}).get("organizationName", ""), pais),
            "perigos": perigos_de(assunto) or ["Outros"],
            "url": URL_RASFF_TELA.format(id=n["notifId"]),
        })
    return alertas


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--desde", help="data inicial (AAAA-MM-DD); padrão: últimos 60 dias")
    args = ap.parse_args()
    desde = dt.date.fromisoformat(args.desde) if args.desde else dt.date.today() - dt.timedelta(days=60)

    atual = {"noticias": [], "rasff": []}
    if SAIDA_JSON.exists():
        atual = json.loads(SAIDA_JSON.read_text(encoding="utf-8"))
    noticias = {x["id"]: x for x in atual.get("noticias", [])}
    rasff = {x["id"]: x for x in atual.get("rasff", [])}

    for nome, func, destino in (("FAO", coletar_fao, noticias), ("Codex", coletar_codex, noticias), ("RASFF", coletar_rasff, rasff)):
        try:
            itens = func(desde)
            destino.update({x["id"]: x for x in itens})
            print(f"  {nome}: {len(itens)} itens desde {desde:%d/%m/%Y}")
        except RuntimeError as e:
            print(f"  ! {nome}: {e}", file=sys.stderr)

    # tradução para português (o original continua guardado ao lado)
    pendentes = 0
    for n in noticias.values():
        for campo in ("titulo", "resumo"):
            if n.get(campo) and not n.get(campo + "_pt"):
                t = traduzir(n[campo])
                if t: n[campo + "_pt"] = t
                else: pendentes += 1
    for r in rasff.values():
        if not r.get("assunto_pt"):
            t = traduzir(r["assunto"])
            if t: r["assunto_pt"] = t
            else: pendentes += 1
    salvar_cache()
    if pendentes:
        print(f"  tradução: {pendentes} textos ficam para a próxima rodada (limite diário do tradutor)")

    saida = {
        "atualizado_em": dt.datetime.now().isoformat(timespec="seconds"),
        "noticias": sorted(noticias.values(), key=lambda x: x["data"], reverse=True),
        "rasff": sorted(rasff.values(), key=lambda x: (x["data"], x["id"]), reverse=True),
    }
    DADOS.mkdir(parents=True, exist_ok=True)
    SAIDA_JSON.write_text(json.dumps(saida, ensure_ascii=False), encoding="utf-8")
    SAIDA_JS.write_text("window.INTERNACIONAL = " + json.dumps(saida, ensure_ascii=False) + ";", encoding="utf-8")
    print(f"OK — {len(saida['noticias'])} notícias, {len(saida['rasff'])} alertas RASFF.")


if __name__ == "__main__":
    main()
