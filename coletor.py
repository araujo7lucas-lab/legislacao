#!/usr/bin/env python3
"""Coletor de legislação — Diário Oficial da União (in.gov.br).

Lê a edição diária do DOU (Seção 1 e Seção 1 Extra), filtra os atos de
interesse do setor de alimentos e bebidas (Anvisa, MAPA, Inmetro, MS etc.),
classifica por tipo / órgão / macrotema / situação e grava os dados que a
página `site/index.html` exibe.

Uso:
    python3 coletor.py               # coleta os últimos 3 dias (rotina diária)
    python3 coletor.py --dias 30     # carga inicial / recuperação
    python3 coletor.py --data 2026-11-19
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
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
DADOS = RAIZ / "site" / "data"
TEXTOS = DADOS / "textos"
INDICE_JSON = DADOS / "legislacoes.json"
INDICE_JS = DADOS / "legislacoes.js"

UA = "Mozilla/5.0 (X11; Linux x86_64) legislacao-coletor/1.0"
URL_DIA = "https://www.in.gov.br/leiturajornal?data={data}&secao={secao}"
URL_ATO = "https://www.in.gov.br/web/dou/-/{slug}"
SECOES = ["do1", "do1e"]


# --------------------------------------------------------------------------- #
# Tabelas de classificação (espelham os filtros da aba "Todas as legislações")
# --------------------------------------------------------------------------- #
ORGAOS = [  # (trecho da hierarquia do DOU, rótulo do filtro) — mais específico primeiro
    ("Agência Nacional de Vigilância Sanitária", "Anvisa – Agência Nacional de Vigilância Sanitária"),
    ("Departamento de Inspeção de Produtos de Origem Animal", "DIPOA – Departamento de Produtos de Origem Animal"),
    ("Departamento de Inspeção de Produtos de Origem Vegetal", "DIPOV – Departamento de Produtos de Origem Vegetal"),
    ("Departamento de Produtos de Origem Vegetal", "DIPOV – Departamento de Produtos de Origem Vegetal"),
    ("Secretaria de Defesa Agropecuária", "SDA – Secretaria de Defesa Agropecuária"),
    ("Secretaria de Inovação, Desenvolvimento Sustentável", "SDI – Secretaria de Inovação, Desenvolvimento Sustentável, Irrigação e Cooperativismo"),
    ("Ministério da Agricultura e Pecuária", "MAPA – Ministério da Agricultura e Pecuária"),
    ("Instituto Nacional de Metrologia", "INMETRO – Instituto Nacional de Metrologia, Qualidade e Tecnologia"),
    ("Comissão Técnica Nacional de Biossegurança", "CTNBio – Comissão Técnica Nacional de Biossegurança"),
    ("Superintendência da Zona Franca de Manaus", "SUFRAMA – Superintendência da Zona Franca de Manaus"),
    ("Secretaria de Comércio Exterior", "SECEX – Secretaria de Comércio Exterior"),
    ("Instituto Brasileiro do Meio Ambiente", "IBAMA – Instituto Brasileiro do Meio Ambiente e dos Recursos Naturais Renováveis"),
    ("Instituto Chico Mendes", "ICMBio – Instituto Chico Mendes de Conservação da Biodiversidade"),
    ("Agência Nacional de Águas", "ANA – Agência Nacional de Águas e Saneamento Básico"),
    ("Agência Nacional de Mineração", "ANM – Agência Nacional de Mineração"),
    ("Agência Nacional do Petróleo", "ANP – Agência Nacional do Petróleo, Gás Natural e Biocombustíveis"),
    ("Instituto Nacional de Colonização e Reforma Agrária", "INCRA – Instituto Nacional de Colonização e Reforma Agrária"),
    ("Ministério da Saúde", "MS – Ministério da Saúde"),
    ("Ministério do Meio Ambiente", "MMA – Ministério do Meio Ambiente e Mudança do Clima"),
    ("Ministério de Minas e Energia", "MME – Ministério de Minas e Energia"),
    ("Ministério da Ciência, Tecnologia e Inovação", "MCTI – Ministério da Ciência, Tecnologia e Inovações"),
    ("Ministério da Integração e do Desenvolvimento Regional", "MDR – Ministério da Integração e do Desenvolvimento Regional"),
    ("Ministério da Justiça e Segurança Pública", "MJSP – Ministério da Justiça e Segurança Pública"),
    ("Ministério das Relações Exteriores", "MRE – Itamaraty (Ministério das Relações Exteriores)"),
    ("Ministério do Trabalho e Emprego", "MTE – Ministério do Trabalho e Emprego"),
    ("Ministério da Pesca e Aquicultura", "MPA – Ministério da Pesca e Aquicultura"),
    ("Ministério das Cidades", "MCID – Ministério das Cidades"),
    ("Ministério das Comunicações", "MCom – Ministério das Comunicações"),
    ("Ministério do Desenvolvimento Agrário", "MDA – Ministério do Desenvolvimento Agrário e Agricultura Familiar"),
    ("Ministério do Desenvolvimento, Indústria, Comércio e Serviços", "MDIC – Ministério do Desenvolvimento, Indústria, Comércio e Serviços"),
    ("Ministério do Desenvolvimento e Assistência Social", "MDS – Ministério do Desenvolvimento e Assistência Social, Família e Combate à Fome"),
    ("Ministério dos Direitos Humanos", "MDHC – Ministério dos Direitos Humanos e Cidadania"),
    ("Ministério da Educação", "MEC – Ministério da Educação"),
    ("Ministério da Fazenda", "MF – Ministério da Fazenda"),
    ("Ministério da Gestão e da Inovação", "MGI – Ministério da Gestão e Inovação em Serviços Públicos"),
    ("Ministério da Igualdade Racial", "MIR – Ministério da Igualdade Racial"),
    ("Ministério dos Transportes", "MT – Ministério dos Transportes"),
    ("Ministério do Planejamento", "MPO – Ministério do Planejamento e Orçamento"),
    ("Secretaria de Comunicação Social", "SECOM – Secretaria de Comunicação Social"),
    ("Presidência da República", "Presidência da República"),
    ("Atos do Poder Executivo", "Governo Federal"),
    ("Atos do Poder Legislativo", "Governo Federal"),
]

# Órgãos cujos atos normativos entram mesmo sem palavra-chave de alimentos
ORGAOS_NUCLEO = ("Anvisa", "MAPA", "DIPOA", "DIPOV", "SDA", "INMETRO", "CTNBio", "MPA")

TIPOS = [  # (regex sobre o título, rótulo do filtro) — mais específico primeiro
    (r"^RESOLU[ÇC][ÃA]O\s*-?\s*(DA DIRETORIA COLEGIADA|RDC)", "Resolução da Diretoria Colegiada – RDC"),
    (r"^RESOLU[ÇC][ÃA]O\s*-?\s*RE\b", "Resolução – RE"),
    (r"^RESOLU[ÇC][ÃA]O", "Resolução – RES"),
    (r"^INSTRU[ÇC][ÃA]O NORMATIVA INTERMINISTERIAL", "Instrução Normativa Interministerial – INI"),
    (r"^INSTRU[ÇC][ÃA]O NORMATIVA CONJUNTA", "Instrução Normativa Conjunta – INC"),
    (r"^INSTRU[ÇC][ÃA]O NORMATIVA", "Instrução Normativa – IN"),
    (r"^PORTARIA INTERMINISTERIAL", "Portaria Interministerial – PRTI"),
    (r"^PORTARIA (NORMATIVA )?CONJUNTA", "Portaria Normativa Conjunta – PRTC"),
    (r"^PORTARIA", "Portaria – PRT"),
    (r"^DECRETO LEGISLATIVO", "Decreto Legislativo – DCL"),
    (r"^DECRETO-?\s*LEI", "Decreto Lei – DL"),
    (r"^DECRETO", "Decreto – DCT"),
    (r"^LEI COMPLEMENTAR", "Lei complementar – LC"),
    (r"^LEI\b", "Lei"),
    (r"^ATO CONJUNTO", "Ato Conjunto"),
    (r"^ATO", "Ato"),
    (r"^CIRCULAR", "Circular"),
    (r"^OF[ÍI]CIO CIRCULAR CONJUNTO", "Ofício Circular Conjunto"),
    (r"^OF[ÍI]CIO CIRCULAR", "Ofício Circular"),
    (r"^RETIFICA[ÇC][ÃA]O", "Retificação"),
    (r"^CONSULTA P[ÚU]BLICA", "Consultas Públicas"),
    (r"^AUDI[ÊE]NCIA P[ÚU]BLICA", "Audiência Pública"),
    (r"^AVISO DE CONSULTA P[ÚU]BLICA", "Consultas Públicas"),
]

TIPOS_DOU_DESCARTADOS = {
    "Ata", "Pauta", "Acórdão", "Alvará", "Mensagem", "Decisão", "Despacho", "Extrato",
    "Edital", "Aviso", "Autorização", "Ação Direta de Inconstitucionalidade e Ação Declaratória de Constitucionalidade",
    "Ato Declaratório", "Protocolo", "Deliberação", "Recomendação", "Súmula", "Termo",
}

# Atos de pessoal / orçamento — não são legislação técnica
RUIDO = re.compile(
    r"\b(nomear|exonerar|dispensar|designar|reconduzir|aposentadoria|pens[ãa]o|cess[ãa]o de servidor"
    r"|habilita\b|habilitar|recursos? financeiros?|fundo nacional de sa[úu]de|incremento tempor[áa]rio"
    r"|credencia|delegar compet[êe]ncia|subdelegar|f[ée]rias|progress[ãa]o funcional|concurso p[úu]blico"
    r"|remanejamento|cr[ée]dito suplementar|teto financeiro|bloco de manuten[çc][ãa]o)",
    re.I,
)

MACROTEMAS = {  # rótulo do filtro -> palavras-chave (sem acento, minúsculas)
    "Aditivos alimentares": ["aditivo alimentar", "aditivos alimentares", "corante", "conservante", "aromatizante"],
    "Adoçantes dietéticos": ["adocante", "edulcorante"],
    "Agrotóxicos": ["agrotoxico", "defensivo agricola", "limite maximo de residuo", "lmr", "pesticida", "ingrediente ativo"],
    "Água adicionada de sais, natural e mineral": ["agua mineral", "agua adicionada de sais", "agua natural", "agua envasada"],
    "Alimentos com propriedade funcional e/ou de saúde": ["alegacao de propriedade funcional", "alegacao de saude", "propriedade funcional"],
    "Alimentos para fins especiais": ["fins especiais", "dietas com restricao"],
    "Balas, bombons e goma de mascar": ["bala", "bombom", "goma de mascar"],
    "Bebidas alcóolicas": ["bebida alcoolica", "bebidas alcoolicas", "cerveja", "vinho", "cachaca", "destilado", "fermentado acetico", "aguardente"],
    "Bebidas não-alcóolicas": ["bebida nao alcoolica", "refrigerante", "suco", "nectar", "refresco", "bebidas nao alcoolicas"],
    "Café, cevada, chá, erva-mate e produtos solúveis": ["cafe", "cha ", "erva-mate", "erva mate", "cevada"],
    "Carnes e derivados": ["carne", "carcaca", "abate", "frigorifico", "embutido", "aves", "suino", "bovino"],
    "Classificação vegetal": ["classificacao vegetal", "padrao oficial de classificacao", "classificacao de produtos vegetais"],
    "Chocolate e produtos de cacau": ["chocolate", "cacau"],
    "Coadjuvantes de tecnologia": ["coadjuvante de tecnologia", "coadjuvantes de tecnologia"],
    "Embalagens": ["embalagem", "embalagens", "materiais em contato com alimentos", "contato com alimentos"],
    "Enzimas e preparações enzimáticas": ["enzima", "preparacao enzimatica"],
    "Especiarias, temperos e molhos": ["especiaria", "tempero", "molho", "condimento"],
    "Farmacopeia": ["farmacopeia"],
    "Fórmulas dietoterápicas, enteral, infantil, crianças e de transição": ["formula infantil", "formulas infantis", "nutricao enteral", "formula dietoterapica", "formula de transicao"],
    "Gelo e Gelados comestíveis": ["gelado comestivel", "gelados comestiveis", "sorvete", "gelo"],
    "Gestão e melhoria regulatória": ["agenda regulatoria", "analise de impacto regulatorio", "melhoria regulatoria", "boas praticas regulatorias", "estoque regulatorio"],
    "Leite e derivados": ["leite", "laticinio", "queijo", "iogurte", "manteiga", "soro de leite", "lacteo"],
    "Mel e produtos apícolas": ["mel ", "apicola", "propolis", "geleia real"],
    "Novos alimentos e novos ingredientes": ["novos alimentos", "novo alimento", "novos ingredientes", "novo ingrediente"],
    "Óleos vegetais, gorduras vegetais e creme vegetal": ["oleo vegetal", "oleos vegetais", "gordura vegetal", "azeite", "creme vegetal"],
    "Orgânicos": ["organico", "organicos", "producao organica"],
    "Ovos e derivados": ["ovo", "ovos"],
    "Pescados e derivados": ["pescado", "peixe", "crustaceo", "molusco", "aquicultura", "pesca"],
    "Produtos de cereais, amidos, farinhas e farelos": ["cereal", "cereais", "farinha", "farelo", "amido", "trigo", "arroz", "milho", "feijao", "soja"],
    "Produtos proteicos de origem vegetal": ["proteina vegetal", "proteico de origem vegetal", "proteicos de origem vegetal"],
    "Produtos de origem vegetal": ["origem vegetal", "hortifruti", "fruta", "hortalica"],
    "Rotulagem de Alimentos e Bebidas": ["rotulagem", "rotulo", "informacao nutricional", "alergenico", "lactose", "gluten", "rotulagem nutricional"],
    "Sal e sal hipossódico/sucedâneos do sal": ["sal para consumo humano", "iodacao do sal", "sal hipossodico", "sucedaneo do sal"],
    "Saneantes": ["saneante", "saneantes", "desinfetante"],
    "Suplementos alimentares": ["suplemento alimentar", "suplementos alimentares", "suplemento"],
    "Açúcares e Produtos para adoçar": ["acucar", "acucares", "produtos para adocar"],
    "Probióticos": ["probiotico"],
    "Pesos e medidas": ["metrologia legal", "conteudo nominal", "pre-medido", "pre-medidos", "pesos e medidas", "regulamento tecnico metrologico", "instrumento de medicao"],
    "Cosméticos": ["cosmetico", "cosmeticos", "higiene pessoal", "perfume"],
    "Portos, Aeroportos e Fronteiras": ["portos, aeroportos", "recintos alfandegados", "fronteira"],
    "Importação": ["importacao", "importados", "importador"],
    "Exportação": ["exportacao", "exportador", "certificado sanitario internacional"],
    "Serviços de Alimentação": ["servicos de alimentacao", "servico de alimentacao", "restaurante"],
    "Defesa Agropecuária": ["defesa agropecuaria", "sanidade vegetal", "sanidade animal", "praga", "febre aftosa", "influenza aviaria", "vigilancia agropecuaria"],
    "Defesa/Inspeção de Produtos de Origem Animal": ["origem animal", "sif", "inspecao industrial e sanitaria", "riispoa"],
    "Defesa/Inspeção de Produtos de Origem Vegetal": ["inspecao de produtos de origem vegetal", "registro de estabelecimento vegetal"],
    "Laboratórios": ["laboratorio", "laboratorios", "rede nacional de laboratorios", "lfda"],
    "Alimentação Animal": ["alimentacao animal", "racao", "racoes", "produtos destinados a alimentacao animal"],
    "Bem Estar Animal": ["bem-estar animal", "bem estar animal"],
    "Biossegurança": ["biosseguranca", "organismo geneticamente modificado", "ogm", "transgenico"],
    "Segurança de Alimentos": ["seguranca de alimentos", "seguranca dos alimentos", "contaminante", "boas praticas de fabricacao", "alimento", "alimentos"],
    "Certificação": ["certificacao", "avaliacao da conformidade", "requisitos de avaliacao da conformidade"],
    "Mercosul": ["mercosul", "gmc"],
    "Selo Arte": ["selo arte"],
    "Produtos Artesanais": ["artesanal", "artesanais"],
    "Agricultura Familiar": ["agricultura familiar", "agricultor familiar"],
    "Microbiologia": ["microbiologico", "microbiologica", "microbiologicos", "microbiologicas", "salmonella", "listeria",
                      "escherichia", "coliformes", "bolores", "leveduras", "staphylococcus", "estafilococos", "bacillus cereus",
                      "clostridium", "enterobacterias", "cronobacter", "padroes microbiologicos"],
    "Alergênicos": ["alergenico", "alergenicos", "alergeno", "alergenos", "alergia alimentar", "alimentos alergenicos"],
    "Contaminantes químicos": ["aflatoxina", "aflatoxinas", "micotoxina", "micotoxinas", "ocratoxina", "chumbo", "arsenio",
                               "cadmio", "metais pesados", "metanol", "acrilamida"],
    "Matérias estranhas": ["materias estranhas", "materia estranha", "corpo estranho", "fragmentos de vidro", "pelos de roedor"],
    "Medidas preventivas e recolhimento": ["recolhimento", "recall", "medida preventiva", "medidas preventivas", "proibicao", "apreensao", "suspensao da fabricacao"],
    "Medicamentos": ["medicamento", "medicamentos", "farmaco"],
}
MACROTEMAS_ALIMENTOS = set(MACROTEMAS) - {"Farmacopeia", "Cosméticos", "Saneantes", "Medicamentos", "Laboratórios",
                                          "Certificação", "Pesos e medidas", "Portos, Aeroportos e Fronteiras",
                                          "Importação", "Exportação", "Gestão e melhoria regulatória"}

MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto",
         "setembro", "outubro", "novembro", "dezembro"]


def sem_acento(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()


def http_get(url: str, tentativas: int = 3) -> str:
    erro = None
    for i in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "pt-BR"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read().decode("utf-8", "replace")
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            erro = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"falha ao baixar {url}: {erro}")


# --------------------------------------------------------------------------- #
# Classificação
# --------------------------------------------------------------------------- #
def orgao_de(hierarquia: str) -> str:
    for trecho, rotulo in ORGAOS:
        if trecho in hierarquia:
            return rotulo
    return "Outros órgãos"


def tipo_de(titulo: str, tipo_dou: str) -> str:
    t = titulo.upper().strip()
    for padrao, rotulo in TIPOS:
        if re.search(padrao, t):
            return rotulo
    return tipo_dou or "Outros"


def numero_de(titulo: str) -> str:
    m = re.search(r"N[º°o.]*\s*([\d.\-/]+[A-Z]?)", titulo, re.I)
    return m.group(1).strip(".-/").replace(".", "") if m else ""


def data_ato(titulo: str, pub: str) -> str:
    m = re.search(r"(\d{1,2})[º°]?\s+DE\s+([A-ZÇ]+)\s+DE\s+(\d{4})", titulo.upper())
    if m:
        try:
            mes = [sem_acento(x).upper() for x in MESES].index(sem_acento(m.group(2)).upper()) + 1
            return f"{m.group(3)}-{mes:02d}-{int(m.group(1)):02d}"
        except ValueError:
            pass
    d, mth, y = pub.split("/")
    return f"{y}-{mth}-{d}"


def macrotemas_de(texto: str) -> list[str]:
    t = " " + sem_acento(texto) + " "
    achados = []
    for tema, chaves in MACROTEMAS.items():
        if any(re.search(r"\b" + re.escape(k.strip()) + r"\b", t) for k in chaves):
            achados.append(tema)
    # "Segurança de Alimentos" é genérico — só fica se for o único tema
    if len(achados) > 1 and "Segurança de Alimentos" in achados:
        achados.remove("Segurança de Alimentos")
    return achados


def situacao_de(texto: str, tipo: str, data_pub: str) -> str:
    t = sem_acento(texto)
    if tipo in ("Consultas Públicas", "Audiência Pública"):
        return "Aberta"
    if re.search(r"tornar sem efeito|torna sem efeito", t) and len(t) < 1500:
        return "Sem efeito"
    pub = dt.date.fromisoformat(data_pub)
    m = re.search(r"entra(?:ra)? em vigor (?:apos|em) (\d+) \(?[a-z\s-]*\)? dias", t)
    if m and pub + dt.timedelta(days=int(m.group(1))) > dt.date.today():
        return "A entrar em vigor"
    m = re.search(r"entra(?:ra)? em vigor (?:em|a partir de) (\d{1,2})[o°º]? de ([a-z]+) de (\d{4})", t)
    if m and m.group(2) in [sem_acento(x) for x in MESES]:
        alvo = dt.date(int(m.group(3)), [sem_acento(x) for x in MESES].index(m.group(2)) + 1, int(m.group(1)))
        if alvo > dt.date.today():
            return "A entrar em vigor"
    if re.search(r"\baltera\b|\bpassa a vigorar\b", t[:600]):
        return "Vigente com alteração"
    return "Vigente"


def sigla_orgao(orgao: str) -> str:
    return orgao.split(" – ")[0]


TEMAS_FRACOS = {"Mercosul", "Açúcares e Produtos para adoçar", "Agricultura Familiar", "Produtos Artesanais",
                "Segurança de Alimentos", "Café, cevada, chá, erva-mate e produtos solúveis", "Leite e derivados",
                "Água adicionada de sais, natural e mineral", "Medidas preventivas e recolhimento"}
ORGAOS_FORA = {"MCom", "MPO", "MGI", "MF", "MEC", "MTE", "ANM", "ANP", "MJSP", "INCRA", "MDR", "MCID", "MT",
               "MME", "MIR", "MDHC", "SECOM", "MDS", "ANA", "SUFRAMA", "Outros órgãos"}
ANVISA_SIM = ("Alimentos", "Inspeção e Fiscalização Sanitária", "Diretoria Colegiada", "Regulamentação", "Portos")
ANVISA_NAO = ("Medicamentos", "Pesquisa Clínica", "Produtos para Saúde", "Sangue", "Tecnologia em Serviços",
              "Toxicologia", "Gestão de Pessoas", "Administração", "Recursos Humanos", "Tabaco")


def relevante(item: dict, orgao: str, temas: list[str]) -> bool | None:
    """True/False, ou None quando só o texto integral permite decidir."""
    tipo_dou = item.get("artType", "")
    if tipo_dou in TIPOS_DOU_DESCARTADOS:
        return False
    titulo = item.get("title", "").upper()
    texto = f"{item.get('title','')} {item.get('content','')}"
    if RUIDO.search(texto):
        return False
    sigla = sigla_orgao(orgao)
    alimento = [t for t in temas if t in MACROTEMAS_ALIMENTOS]
    if sigla == "Anvisa":
        hier = item.get("hierarchyStr", "")
        if re.search(r"RDC|INSTRU|CONSULTA|DIRETORIA COLEGIADA", titulo):
            return True
        if any(k in hier for k in ANVISA_NAO) and not alimento:
            return False
        if alimento:
            return True
        return None if any(k in hier for k in ANVISA_SIM) and "RESOLU" in titulo else False
    if sigla in ORGAOS_NUCLEO:
        return True
    if sigla in ORGAOS_FORA or tipo_dou in ("Ato", "Retificação") or "SOLUÇÃO DE CONSULTA" in titulo:
        return False
    inicio = macrotemas_de(f"{item.get('title','')} {item.get('content','')[:500]}")
    return any(t in MACROTEMAS_ALIMENTOS and t not in TEMAS_FRACOS for t in inicio)


# --------------------------------------------------------------------------- #
# Coleta
# --------------------------------------------------------------------------- #
def atos_do_dia(dia: dt.date, secao: str) -> list[dict]:
    pagina = http_get(URL_DIA.format(data=dia.strftime("%d-%m-%Y"), secao=secao))
    m = re.search(r'<script id="params" type="application/json">\s*(.*?)\s*</script>', pagina, re.S)
    if not m:
        return []
    return json.loads(m.group(1)).get("jsonArray", [])


def texto_integral(slug: str) -> dict:
    pagina = http_get(URL_ATO.format(slug=slug))
    m = re.search(r'<div class="texto-dou">(.*?)<div class="informacao-conteudo-dou"', pagina, re.S) or \
        re.search(r'<div class="texto-dou">(.*?)</html>', pagina, re.S)
    bloco = m.group(1) if m else ""
    paragrafos = []
    for tag, classe, conteudo in re.findall(r"<(p|td)(?:\s+class=\"([^\"]*)\")?[^>]*>(.*?)</\1>", bloco, re.S):
        limpo = html.unescape(re.sub(r"<[^>]+>", "", conteudo)).strip()
        limpo = re.sub(r"\s+", " ", limpo)
        if limpo:
            paragrafos.append({"c": classe or "", "t": limpo})
    return {"paragrafos": paragrafos}


def processar(dias: list[dt.date]) -> None:
    DADOS.mkdir(parents=True, exist_ok=True)
    TEXTOS.mkdir(parents=True, exist_ok=True)
    existentes = {}
    if INDICE_JSON.exists():
        for x in json.loads(INDICE_JSON.read_text(encoding="utf-8")).get("itens", []):
            existentes[x["id"]] = x

    novos = []

    def baixar_edicao(par):
        dia, secao = par
        try:
            return dia, secao, atos_do_dia(dia, secao)
        except RuntimeError as e:
            print(f"  ! {dia} {secao}: {e}", file=sys.stderr)
            return dia, secao, None

    pares = [(d, s) for d in dias for s in SECOES]

    def edicoes_em_lotes():  # baixa 6 edições por vez, sem guardar o ano inteiro na memória
        with ThreadPoolExecutor(max_workers=6) as pool:
            for i in range(0, len(pares), 24):
                yield from pool.map(baixar_edicao, pares[i:i + 24])

    for dia, secao, atos in edicoes_em_lotes():
        if True:
            if atos is None:
                continue
            sel = 0
            for a in atos:
                slug = a.get("urlTitle", "")
                ident = slug.rsplit("-", 1)[-1] if slug else ""
                if not ident or ident in existentes:
                    continue
                orgao = orgao_de(a.get("hierarchyStr", ""))
                temas = macrotemas_de(f"{a.get('title','')} {a.get('content','')}")
                decisao = relevante(a, orgao, temas)
                if decisao is False:
                    continue
                titulo = html.unescape(a.get("title") or a.get("titulo") or "").strip()
                if not titulo:
                    continue
                novos.append({
                    "id": ident,
                    "slug": slug,
                    "titulo": titulo,
                    "tipo": tipo_de(titulo, a.get("artType", "")),
                    "numero": numero_de(titulo),
                    "orgao": orgao,
                    "hierarquia": a.get("hierarchyStr", ""),
                    "data_ato": data_ato(titulo, a["pubDate"]),
                    "data_publicacao": "-".join(reversed(a["pubDate"].split("/"))),
                    "secao": "Seção 1 Extra" if secao.endswith("e") else "Seção 1",
                    "pagina": a.get("numberPage", ""),
                    "edicao": a.get("editionNumber", ""),
                    "resumo": html.unescape(a.get("content", "")).strip(),
                    "macrotemas": temas,
                    "url": URL_ATO.format(slug=slug),
                    "_verificar": decisao is None,
                })
                existentes[ident] = novos[-1]
                sel += 1
            print(f"  {dia:%d/%m/%Y} {secao}: {len(atos)} atos, {sel} selecionados")

    def baixar(item):
        try:
            txt = texto_integral(item["slug"])
        except RuntimeError as e:
            print(f"  ! texto {item['id']}: {e}", file=sys.stderr)
            txt = {"paragrafos": []}
        corpo = " ".join(p["t"] for p in txt["paragrafos"])
        if corpo:
            ementa = next((p["t"] for p in txt["paragrafos"] if "ementa" in p["c"]), "")
            if ementa:
                item["ementa"] = ementa
            base = f"{item['titulo']} {ementa} {ementa} {corpo[:1500]}"
            item["macrotemas"] = (macrotemas_de(base) or item["macrotemas"])[:4]
        if item.pop("_verificar", False):
            temas_corpo = macrotemas_de(corpo)
            if not any(t in MACROTEMAS_ALIMENTOS and t != "Segurança de Alimentos" for t in temas_corpo) \
                    and not re.search(r"\b(suplemento|alimento|bebida)", sem_acento(corpo)):
                item["_descartar"] = True
                return
            item["macrotemas"] = [t for t in temas_corpo if t in MACROTEMAS_ALIMENTOS or t == "Medidas preventivas e recolhimento"][:4]
        item["situacao"] = situacao_de(corpo or item["resumo"], item["tipo"], item["data_publicacao"])
        dados = {"id": item["id"], **txt}
        (TEXTOS / f"{item['id']}.js").write_text(
            "window.__texto(" + json.dumps(dados, ensure_ascii=False) + ");", encoding="utf-8")
        time.sleep(0.3)

    if novos:
        print(f"Baixando texto integral de {len(novos)} atos…")
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(baixar, novos))

    for it in [x for x in novos if x.get("_descartar")]:
        existentes.pop(it["id"], None)
    novos = [x for x in novos if not x.get("_descartar")]

    # recalcula "A entrar em vigor" → "Vigente" quando a data passou
    for it in existentes.values():
        if it.get("situacao") == "A entrar em vigor":
            arq = TEXTOS / f"{it['id']}.js"
            corpo = it.get("resumo", "")
            if arq.exists():
                bruto = arq.read_text(encoding="utf-8")[len("window.__texto("):-2]
                corpo = " ".join(p["t"] for p in json.loads(bruto)["paragrafos"])
            it["situacao"] = situacao_de(corpo, it["tipo"], it["data_publicacao"])

    itens = sorted(existentes.values(), key=lambda x: (x["data_publicacao"], x["id"]), reverse=True)
    saida = {
        "atualizado_em": dt.datetime.now().isoformat(timespec="seconds"),
        "fonte": "Diário Oficial da União — Imprensa Nacional (in.gov.br)",
        "total": len(itens),
        "itens": itens,
    }
    gravar_indice_busca(itens)
    salvar_saida(saida)
    print(f"OK — {len(novos)} novos, {len(itens)} no total. Atualizado em {saida['atualizado_em']}.")


MOTIVOS = [  # (rótulo, regex sobre a motivação sem acento)
    ("Microbiologia", r"salmonel|listeri|escherichia|e\.? ?coli\b|coliforme|bolor|levedur|staphylo|estafiloc|bacillus|clostrid|"
                      r"enterobact|cronobacter|microbiolog|contaminacao (biologica|microbiana)|fungo|cereulid|toxina bacteriana|"
                      r"botulin|norovirus|hepatite a"),
    ("Alergênicos", r"alergen|alergic|alergia|gluten|lactose|nao declarad[oa]s? (no|na|em) rotul.*(leite|soja|trigo|amendoim|ovo|castanha|crustace)"),
    ("Contaminantes químicos", r"aflatox|micotox|ocratox|chumbo|arsenio|cadmio|mercurio|metais pesados|metanol|acrilamida|"
                               r"residuos? de agrotox|melamina|migracao"),
    ("Aditivos / análise fiscal", r"dioxido de enxofre|sulfit|acido sorbico|acido benzoico|benzoato|nitrit|corante|teor de iodo|"
                                  r"ensaio de|laudo de analise fiscal|resultado insatisfatorio"),
    ("Matérias estranhas", r"materias? estranh|corpo estranho|fragmentos? de|inseto|larva|vidro|pelos? de|roedor|materiais plasticos"),
    ("Composição irregular", r"ingrediente nao (autorizado|avaliado|permitido)|substancia (nao permitida|proibida)|sibutramina|"
                             r"tadalafila|sildenafila|composicao|adulter|nao avaliado|avaliacao (previa )?de seguranca|"
                             r"(constituintes?|substancias?|compostos?) nao autorizad"),
    ("Falsificação", r"nao reconhece o produto|falsifica|fraude|origem desconhecida"),
    ("Boas Práticas de Fabricação", r"boas praticas"),
    ("Sem registro / regularização", r"sem (a devida |a )?(registro|regularizacao|notificacao|autorizacao)|nao licenciado|cancelamento d[ao]s? notificac|"
                                     r"empresa sem autorizacao|nao regularizad|ausencia de regularizacao|desconhecid"),
    ("Rotulagem", r"rotulagem|rotulo|propaganda enganosa|alegac"),
]


def extrair_ocorrencias(paragrafos: list[dict]) -> list[dict]:
    """Lê os blocos 'Empresa: … CNPJ: …' do anexo das Resoluções-RE de fiscalização."""
    blocos, atual = [], None
    for p in paragrafos:
        ln = p["t"]
        m = re.match(r"^\d+\.\s*Empresa:\s*(.+?)\s*-\s*CNPJ:\s*([\d./-]+|DESCONHECID[OA])", ln, re.I)
        if m:
            atual = {"empresa": m.group(1).strip(), "cnpj": re.sub(r"\D", "", m.group(2)), "linhas": []}
            blocos.append(atual)
        elif atual is not None:
            atual["linhas"].append(ln)
    ocorrencias = []
    for b in blocos:
        produtos, tipo, acoes, motivacao, revog, em_acoes = [], "", [], "", False, False
        for ln in b["linhas"]:
            if ln.startswith("....."):
                break
            if ln.startswith("Produto"):
                corpo = ln.split(":", 1)[1] if ":" in ln else ln
                produtos += [{"nome": n.strip(), "lote": l.strip()} for n, l in re.findall(r"\s*([^;]+?)\s*\(([^()]*)\)\s*;?", corpo)]
                em_acoes = False
            elif ln.startswith("Tipo de Produto"):
                tipo = ln.split(":", 1)[1].strip()
            elif ln.startswith("Ações de fiscalização"):
                revog = "revogad" in ln.lower()
                acoes.append(ln.split(":", 1)[1].strip())
                em_acoes = True
            elif ln.startswith("Motivação"):
                motivacao = ln.split(":", 1)[1].strip()
                em_acoes = False
            elif em_acoes and not ln.startswith(("Expediente", "Assunto")):
                acoes.append(ln.strip())
        if not tipo and not motivacao:
            continue
        mot = sem_acento(motivacao + " " + " ".join(p["nome"] for p in produtos))
        juntas = " ".join(acoes).lower()
        ocorrencias.append({
            "empresa": b["empresa"], "cnpj": b["cnpj"], "tipo_produto": tipo, "produtos": produtos,
            "acao": next((a for a in ("Recolhimento", "Apreensão", "Proibição", "Suspensão", "Interdição") if a.lower() in juntas),
                         acoes[0].split(" - ")[0] if acoes else ""),
            "acoes": acoes, "revogacao": revog, "motivacao": motivacao,
            "motivos": [r for r, rx in MOTIVOS if re.search(rx, mot)] or ["Outros"],
        })
    return ocorrencias


def salvar_saida(saida: dict) -> None:
    INDICE_JSON.write_text(json.dumps(saida, ensure_ascii=False), encoding="utf-8")
    INDICE_JS.write_text("window.LEGISLACOES = " + json.dumps(saida, ensure_ascii=False) + ";", encoding="utf-8")


def gravar_indice_busca(itens: list[dict]) -> None:
    """Índice de texto integral para a busca + ocorrências de fiscalização (empresa/CNPJ/lote/motivo)."""
    indice = {}
    for it in itens:
        arq = TEXTOS / f"{it['id']}.js"
        if not arq.exists():
            continue
        bruto = arq.read_text(encoding="utf-8")[len("window.__texto("):-2]
        paragrafos = json.loads(bruto)["paragrafos"]
        corpo = " ".join(p["t"] for p in paragrafos)
        indice[it["id"]] = re.sub(r"\s+", " ", sem_acento(corpo))[:20000]
        ocs = extrair_ocorrencias(paragrafos) if "Empresa:" in corpo else []
        if ocs:
            it["ocorrencias"] = ocs
            extras = [m for m in dict.fromkeys(m for o in ocs for m in o["motivos"]) if m in MACROTEMAS]
            it["macrotemas"] = list(dict.fromkeys(extras + it.get("macrotemas", [])))[:6]
        else:
            it.pop("ocorrencias", None)
    (DADOS / "indice_busca.js").write_text(
        "window.__indice(" + json.dumps(indice, ensure_ascii=False) + ");", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dias", type=int, default=3, help="quantos dias para trás coletar (padrão 3)")
    ap.add_argument("--data", help="coletar só esta data (AAAA-MM-DD)")
    ap.add_argument("--desde", help="coletar desde esta data (AAAA-MM-DD), ex.: 2026-01-01")
    ap.add_argument("--so-indice", action="store_true", help="só regenerar índice de busca e ocorrências")
    args = ap.parse_args()
    if args.so_indice:
        saida = json.loads(INDICE_JSON.read_text(encoding="utf-8"))
        gravar_indice_busca(saida["itens"])
        salvar_saida(saida)
        return
    if args.desde:
        args.dias = (dt.date.today() - dt.date.fromisoformat(args.desde)).days + 1
    if args.data:
        dias = [dt.date.fromisoformat(args.data)]
    else:
        hoje = dt.date.today()
        dias = [hoje - dt.timedelta(days=i) for i in range(args.dias)]
    print(f"Coletando DOU: {dias[-1]:%d/%m/%Y} a {dias[0]:%d/%m/%Y}")
    processar(dias)


if __name__ == "__main__":
    main()
