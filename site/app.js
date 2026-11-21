/* Legislação — busca instantânea sobre os atos coletados do DOU (data/legislacoes.js) */
(function () {
  "use strict";

  const DADOS = window.LEGISLACOES || { itens: [], atualizado_em: null };
  const ITENS = DADOS.itens;
  const LOTE = 25;
  const app = document.getElementById("app");
  const gaveta = document.getElementById("gaveta");
  const gCorpo = document.getElementById("g-corpo");

  /* ---------- utilidades ---------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const sigla = (o) => o.split(" – ")[0];
  const nomeOrgao = (o) => o.split(" – ")[1] || o;
  const dia = (iso) => new Date(iso + "T12:00:00");
  const fmt = (iso, o) => dia(iso).toLocaleDateString("pt-BR", o);
  const isoDe = (d) => d.toISOString().slice(0, 10);
  const plural = (n, s, p) => `${n.toLocaleString("pt-BR")} ${n === 1 ? s : p}`;
  const armazem = {
    ler(k, padrao) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : padrao; } catch { return padrao; } },
    gravar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage */ } },
  };

  // texto de busca pré-normalizado por ato
  ITENS.forEach((x) => {
    x._curta = x._busca = norm(`${x.titulo} ${x.ementa || ""} ${x.resumo} ${x.hierarquia} ${x.orgao} ${x.tipo} ${(x.macrotemas || []).join(" ")} ${String(x.numero).replace(/\D/g, "")}`);
  });

  // cor estável por órgão (os mais frequentes ganham as cores mais distintas)
  const contaOrgao = {};
  ITENS.forEach((x) => { const s = sigla(x.orgao); contaOrgao[s] = (contaOrgao[s] || 0) + 1; });
  const ORGAOS = Object.keys(contaOrgao).sort((a, b) => contaOrgao[b] - contaOrgao[a]);
  const corOrgao = (s) => `var(--o${Math.min(ORGAOS.indexOf(s) + 1, 8) || 8})`;
  const nomeCompleto = Object.fromEntries(ITENS.map((x) => [sigla(x.orgao), nomeOrgao(x.orgao)]));

  const TEMAS_SUGERIDOS = ["Rotulagem de Alimentos e Bebidas", "Suplementos alimentares", "Aditivos alimentares", "Embalagens", "Agrotóxicos", "Leite e derivados"];
  const ultimoDia = ITENS.reduce((m, x) => (x.data_publicacao > m ? x.data_publicacao : m), "0000");

  /* ---------- estado (espelhado no endereço) ---------- */
  const CHAVES = ["view", "q", "orgao", "tipo", "situacao", "tema", "periodo", "dia", "semana", "ordem", "ato", "motivo", "tprod", "revog", "semcnpj",
    "origem", "perigo", "fonte", "cat"];
  let estado = {};
  let mostrar = LOTE;
  let listaAtual = [];

  function lerHash() {
    const p = new URLSearchParams(location.hash.replace(/^#\/?\??/, ""));
    estado = Object.fromEntries(CHAVES.map((k) => [k, p.get(k) || ""]));
    estado.view ||= "todas";
  }
  function hashDe(e) {
    const p = new URLSearchParams();
    CHAVES.forEach((k) => { if (e[k] && !(k === "view" && e[k] === "todas")) p.set(k, e[k]); });
    const s = p.toString();
    return s ? "#" + s : location.pathname;
  }
  function atualizar(mudancas, { substituir = false } = {}) {
    const novo = { ...estado, ...mudancas };
    if (!("ato" in mudancas)) mostrar = LOTE;
    const h = hashDe(novo);
    if (substituir) history.replaceState(null, "", h); else history.pushState(null, "", h);
    estado = novo;
    render();
  }

  const favoritos = () => new Set(armazem.ler("legis:favoritos", []));
  function alternarFavorito(id) {
    const s = favoritos();
    const on = !s.has(id);
    on ? s.add(id) : s.delete(id);
    armazem.gravar("legis:favoritos", [...s]);
    toast(on ? "Salvo em Salvas" : "Removido de Salvas");
    return on;
  }

  /* ---------- filtragem com contagens por faceta ---------- */
  function passa(x, ignorar) {
    const e = estado;
    if (e.view === "salvas" && !favoritos().has(x.id)) return false;
    if (ignorar !== "orgao" && e.orgao && sigla(x.orgao) !== e.orgao) return false;
    if (ignorar !== "tipo" && e.tipo && x.tipo !== e.tipo) return false;
    if (ignorar !== "situacao" && e.situacao && x.situacao !== e.situacao) return false;
    if (ignorar !== "tema" && e.tema && !(x.macrotemas || []).includes(e.tema)) return false;
    if (ignorar !== "dia" && !passaData(x.data_publicacao)) return false;
    if (e.q && !termosBusca().every((t) => x._busca.includes(t))) return false;
    return true;
  }
  function passaData(d) {
    const e = estado;
    if (e.dia) return d === e.dia;
    if (e.semana) { const f = dia(e.semana); f.setDate(f.getDate() + 6); return d >= e.semana && d <= isoDe(f); }
    if (e.periodo) { const l = dia(ultimoDia); l.setDate(l.getDate() - Number(e.periodo) + 1); return d >= isoDe(l); }
    return true;
  }
  const inicioSemana = (iso) => { const d = dia(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDe(d); };
  const primeiroDia = ITENS.reduce((m, x) => (x.data_publicacao < m ? x.data_publicacao : m), "9999");
  let _tq = null, _tt = [];
  function termosBusca() {
    if (_tq !== estado.q) {
      _tq = estado.q;
      _tt = norm(estado.q).replace(/\b(n[ºo°]?|de|da|do|e)\b/g, " ").replace(/(\d)\.(\d)/g, "$1$2").split(/\s+/).filter(Boolean);
    }
    return _tt;
  }
  function contar(campo, ignorar) {
    const c = {};
    ITENS.forEach((x) => {
      if (!passa(x, ignorar)) return;
      [].concat(campo(x)).forEach((v) => { c[v] = (c[v] || 0) + 1; });
    });
    return c;
  }

  function realce(texto) {
    const t = esc(texto);
    if (!estado.q) return t;
    const termos = norm(estado.q).split(/\s+/).filter((w) => w.length > 1).map((w) =>
      w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/a/g, "[aáàâã]").replace(/e/g, "[eéê]").replace(/i/g, "[ií]").replace(/o/g, "[oóôõ]")
        .replace(/u/g, "[uúü]").replace(/c/g, "[cç]"));
    if (!termos.length) return t;
    return t.replace(new RegExp(`(${termos.join("|")})`, "gi"), "<mark>$1</mark>");
  }

  /* ---------- peças ---------- */
  const ICO_BUSCA = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6" stroke-linecap="round"/></svg>`;
  const ICO_SALVAR = `<svg width="17" height="17" viewBox="0 0 24 24"><path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.5L5 21V4.5a1 1 0 0 1 1-1Z" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

  const classeSituacao = (s) => ({ "Vigente": "vigente", "Vigente com alteração": "vigente", "A entrar em vigor": "entrar", "Aberta": "aberta", "Sem efeito": "sem-efeito", "Revogada": "revogada" }[s] || "");
  const botaoSalvar = (id) => {
    const on = favoritos().has(id);
    return `<button class="salvar" type="button" data-salvar="${esc(id)}" aria-pressed="${on}" aria-label="${on ? "Remover de Salvas" : "Salvar"}" title="${on ? "Remover de Salvas" : "Salvar"}">${ICO_SALVAR}</button>`;
  };

  function selectChip(id, rotulo, chave, contagem, ordem) {
    const opcoes = (ordem || Object.keys(contagem).sort((a, b) => a.localeCompare(b, "pt-BR")))
      .filter((o) => contagem[o] || o === estado[chave]);
    return `<label class="chip-select"><span class="sr" hidden>${rotulo}</span>
      <select id="${id}" data-filtro="${chave}" class="${estado[chave] ? "on" : ""}" aria-label="${rotulo}">
        <option value="">${rotulo}</option>
        ${opcoes.map((o) => `<option value="${esc(o)}" ${o === estado[chave] ? "selected" : ""}>${esc(o)} · ${contagem[o] || 0}</option>`).join("")}
      </select></label>`;
  }

  // gráfico por semana; recebe a contagem por data de publicação já filtrada (sem o filtro de data)
  function barrasAtividade(contagemDia, unidade) {
    const porSemana = {};
    Object.entries(contagemDia).forEach(([d, n]) => { const s = inicioSemana(d); porSemana[s] = (porSemana[s] || 0) + n; });
    const semanas = [];
    for (let d = dia(inicioSemana(primeiroDia)); isoDe(d) <= ultimoDia; d.setDate(d.getDate() + 7)) semanas.push(isoDe(d));
    const max = Math.max(1, ...semanas.map((s) => porSemana[s] || 0));
    const meio = semanas.map((s) => { const d = dia(s); d.setDate(d.getDate() + 3); return isoDe(d); }); // mês pela quinta-feira da semana
    const meses = meio.map((m, i) => (i === 0 || m.slice(5, 7) !== meio[i - 1].slice(5, 7)) ? fmt(m, { month: "short" }).replace(".", "") : "");
    const barras = semanas.map((s) => {
      const n = porSemana[s] || 0;
      const rot = `Semana de ${fmt(s, { day: "numeric", month: "short" })}: ${plural(n, unidade[0], unidade[1])}`;
      return `<button type="button" data-semana="${s}" class="${n ? "tem" : ""} ${estado.semana === s ? "sel" : ""}" title="${rot}" aria-label="${rot}" ${n ? "" : "disabled"}><i style="height:${Math.max(4, (n / max) * 100)}%"></i></button>`;
    }).join("");
    const sel = estado.semana
      ? `<button class="limpar" type="button" data-semana="">semana de ${fmt(estado.semana, { day: "numeric", month: "short" })} · ver o ano todo</button>`
      : "clique numa barra para ver a semana";
    return `<section class="atividade" aria-label="${unidade[1]} por semana">
      <div class="atividade__cab"><span>${unidade[1][0].toUpperCase() + unidade[1].slice(1)} por semana · ${primeiroDia.slice(0, 4)}</span><span>${sel}</span></div>
      <div class="barras">${barras}</div>
      <div class="meses">${meses.map((m) => `<span>${esc(m)}</span>`).join("")}</div>
    </section>`;
  }

  /* ---------- recolhimentos (ocorrências extraídas das Resoluções-RE) ---------- */
  const MOTIVOS = ["Microbiologia", "Alergênicos", "Contaminantes químicos", "Aditivos / análise fiscal", "Matérias estranhas", "Composição irregular",
    "Falsificação", "Boas Práticas de Fabricação", "Sem registro / regularização", "Rotulagem", "Outros"];
  const OCORRENCIAS = ITENS.flatMap((x) => (x.ocorrencias || []).map((o, i) => ({
    ...o, ato: x, chave: `${x.id}-${i}`, data: x.data_publicacao,
    tprod: /^aliment/i.test(o.tipo_produto) ? "Alimento" : (o.tipo_produto || "Não informado"),
    _b: norm(`${o.empresa} ${o.cnpj} ${o.produtos.map((p) => p.nome + " " + p.lote).join(" ")} ${o.motivacao} ${o.motivos.join(" ")} ${x.titulo}`),
  })));
  const cnpjFmt = (c) => c && c.length === 14 ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : "";

  function passaOc(o, ignorar) {
    const e = estado;
    const tprod = e.tprod || "Alimento";
    if (ignorar !== "tprod" && tprod !== "todos" && o.tprod !== tprod) return false;
    if (ignorar !== "motivo" && e.motivo && !o.motivos.includes(e.motivo)) return false;
    if (!e.revog && o.revogacao) return false;
    if (!e.semcnpj && !o.cnpj) return false;
    if (ignorar !== "dia" && !passaData(o.data)) return false;
    if (e.q && !termosBusca().every((t) => o._b.includes(t))) return false;
    return true;
  }
  function contarOc(campo, ignorar) {
    const c = {};
    OCORRENCIAS.forEach((o) => { if (passaOc(o, ignorar)) [].concat(campo(o)).forEach((v) => { c[v] = (c[v] || 0) + 1; }); });
    return c;
  }

  function linhaOc(o, repeticoes) {
    const lotes = o.produtos.slice(0, 4);
    const resto = o.produtos.length - lotes.length;
    return `<article class="oc">
      <div class="oc__topo">
        <div class="oc__empresa">
          <h3>${realce(o.empresa)}${repeticoes > 1 ? ` <span class="oc__rep" title="Ocorrências desta empresa no filtro atual">${repeticoes}×</span>` : ""}</h3>
          ${o.cnpj ? `<button class="cnpj dado" type="button" data-copiar="${esc(cnpjFmt(o.cnpj))}" data-rotulo="CNPJ copiado" title="Copiar CNPJ">${esc(cnpjFmt(o.cnpj))}</button>` : `<span class="cnpj dado">CNPJ não informado</span>`}
        </div>
        <div class="oc__acao">${o.revogacao ? `<span class="selo vigente">Revogada</span>` : `<span class="selo sem-efeito">${esc(o.acao || "Medida")}</span>`}<span class="dado">${fmt(o.data, { day: "2-digit", month: "2-digit", year: "2-digit" })}</span></div>
      </div>
      <ul class="oc__produtos">${lotes.map((p) => `<li>${realce(p.nome)} ${p.lote && p.lote.toUpperCase() !== "TODOS" ? `<span class="dado">lote ${esc(p.lote)}</span>` : `<span class="dado">todos os lotes</span>`}</li>`).join("")}${resto > 0 ? `<li class="oc__mais">+ ${plural(resto, "produto", "produtos")}</li>` : ""}</ul>
      <div class="oc__motivos">${o.motivos.map((m) => `<button type="button" class="tag-motivo ${m === "Microbiologia" ? "micro" : m === "Alergênicos" ? "alerg" : ""}" data-motivo="${esc(m)}">${esc(m)}</button>`).join("")}</div>
      <details class="oc__motivacao"><summary>Motivação da Anvisa</summary><p>${realce(o.motivacao)}</p></details>
      <button class="oc__ato" type="button" data-abrir="${esc(o.ato.id)}">${esc(o.ato.titulo)} · DOU p. ${esc(o.ato.pagina || "—")} →</button>
    </article>`;
  }

  function telaEmpresas() {
    const lista = OCORRENCIAS.filter((o) => passaOc(o)).sort((a, b) => b.data.localeCompare(a.data));
    listaAtual = [...new Map(lista.map((o) => [o.ato.id, o.ato])).values()];
    listaOcAtual = lista;
    const rep = {}; lista.forEach((o) => { if (o.cnpj) rep[o.cnpj] = (rep[o.cnpj] || 0) + 1; });
    const cMot = contarOc((o) => o.motivos, "motivo");
    const cTp = contarOc((o) => o.tprod, "tprod");
    const empresas = new Set(lista.map((o) => o.cnpj || o.empresa)).size;
    const tprod = estado.tprod || "Alimento";
    const tipos = ["Alimento", ...Object.keys(cTp).filter((t) => t !== "Alimento").sort()];

    app.innerHTML = `
      <section class="topo">
        ${seletorOrigem()}
        <h1>Recolhimentos e apreensões <span>empresas autuadas pela Anvisa em ${primeiroDia.slice(0, 4)}</span></h1>
        <div class="busca">
          ${ICO_BUSCA}
          <input id="q" type="search" value="${esc(estado.q)}" placeholder="Empresa, CNPJ, produto, lote ou bactéria" autocomplete="off" spellcheck="false" aria-label="Buscar ocorrências">
          ${estado.q ? `<button class="limpar-q" type="button" data-limpar-q>Limpar</button>` : `<kbd>/</kbd>`}
        </div>
        <div class="sugestoes"><span>Experimente:</span>${["listeria", "salmonella", "coliformes", "bolores", "glúten", "aflatoxina"].map((t) => `<button type="button" data-q="${t}">${t}</button>`).join("")}</div>
      </section>

      <section class="filtros" aria-label="Filtros">
        <div class="linha-chips" role="group" aria-label="Motivo">
          ${MOTIVOS.map((m) => `<button class="chip" type="button" data-motivo="${esc(m)}" aria-pressed="${estado.motivo === m}" ${cMot[m] || estado.motivo === m ? "" : "disabled"}>${esc(m)}<span class="n">${cMot[m] || 0}</span></button>`).join("")}
        </div>
        <div class="linha-chips">
          ${tipos.map((t) => `<button class="chip" type="button" data-tprod="${esc(t)}" aria-pressed="${tprod === t}">${esc(t)}<span class="n">${cTp[t] || 0}</span></button>`).join("")}
          <button class="chip" type="button" data-tprod="todos" aria-pressed="${tprod === "todos"}">Todos os produtos</button>
          <span class="sep-v"></span>
          ${[["30", "30 dias"], ["90", "90 dias"]].map(([v, r]) => `<button class="chip" type="button" data-periodo="${v}" aria-pressed="${estado.periodo === v && !estado.semana}">${r}</button>`).join("")}
          <button class="chip" type="button" data-alternar="revog" aria-pressed="${!!estado.revog}" title="Revogações são medidas canceladas pela Anvisa">Incluir revogações</button>
          <button class="chip" type="button" data-alternar="semcnpj" aria-pressed="${!!estado.semcnpj}">Incluir sem CNPJ</button>
        </div>
      </section>

      ${barrasAtividade(contarOc((o) => o.data, "dia"), ["ocorrência", "ocorrências"])}

      <div class="res-cab">
        <strong>${plural(lista.length, "ocorrência", "ocorrências")} · ${plural(empresas, "empresa", "empresas")}</strong>
        ${["q", "motivo", "periodo", "semana", "revog", "semcnpj", "tprod"].some((k) => estado[k]) ? `<button class="limpar" type="button" data-limpar-tudo>Limpar filtros</button>` : ""}
        <button class="btn exportar" type="button" data-csv ${lista.length ? "" : "disabled"}>Exportar CSV</button>
      </div>

      <div class="ocs">${lista.length ? lista.slice(0, mostrar).map((o) => linhaOc(o, rep[o.cnpj])).join("") :
        `<div class="vazio"><strong>Nenhuma ocorrência com esses filtros</strong><span>${OCORRENCIAS.length ? "Tente outro motivo, tipo de produto ou período." : "A base ainda não tem resoluções de fiscalização."}</span></div>`}</div>
      ${lista.length > mostrar ? `<div class="mais"><button class="btn" type="button" data-mais>Mostrar mais ${Math.min(LOTE, lista.length - mostrar)} de ${(lista.length - mostrar).toLocaleString("pt-BR")} restantes</button></div>` : ""}
      <p class="nota" style="margin-top:28px">Dados extraídos das Resoluções-RE de fiscalização sanitária da Anvisa publicadas no DOU. O motivo é classificado automaticamente pela motivação; confira o ato antes de contatar a empresa.</p>
      ${rodape()}`;
  }
  let listaOcAtual = [];

  /* ---------- internacional: RASFF (UE) e notícias FAO / Codex ---------- */
  const INTER = window.INTERNACIONAL || { noticias: [], rasff: [] };
  const RASFF = INTER.rasff.map((r) => ({ ...r, _b: norm(`${r.assunto_pt || ""} ${r.assunto} ${r.categoria} ${r.categoria_en} ${r.perigos.join(" ")} ${r.notificante} ${r.referencia}`) }));
  const NOTICIAS = INTER.noticias.map((n) => ({ ...n, _b: norm(`${n.titulo_pt || ""} ${n.resumo_pt || ""} ${n.titulo} ${n.resumo} ${n.comite} ${n.temas.join(" ")}`) }));
  const PERIGOS = ["Microbiologia", "Micotoxinas", "Alergênicos", "Contaminantes químicos", "Resíduos (agrotóxicos/veterinários)",
    "Aditivos", "Matérias estranhas", "Temperatura / conservação", "Rotulagem / fraude", "Outros"];
  const classePerigo = (p) => (p === "Microbiologia" ? "micro" : p === "Alergênicos" || p === "Micotoxinas" ? "alerg" : "");
  const passaTexto = (b) => !estado.q || termosBusca().every((t) => b.includes(t));
  const contarEm = (lista, passa, campo, ignorar) => {
    const c = {};
    lista.forEach((x) => { if (passa(x, ignorar)) [].concat(campo(x)).forEach((v) => { c[v] = (c[v] || 0) + 1; }); });
    return c;
  };

  function passaRasff(r, ignorar) {
    if (ignorar !== "perigo" && estado.perigo && !r.perigos.includes(estado.perigo)) return false;
    if (ignorar !== "cat" && estado.cat && r.categoria !== estado.cat) return false;
    if (ignorar !== "dia" && !passaData(r.data)) return false;
    return passaTexto(r._b);
  }
  function passaNoticia(n, ignorar) {
    if (ignorar !== "perigo" && estado.perigo && !n.temas.includes(estado.perigo)) return false;
    if (ignorar !== "fonte" && estado.fonte && n.fonte !== estado.fonte) return false;
    if (ignorar !== "dia" && !passaData(n.data)) return false;
    return passaTexto(n._b);
  }

  const seletorOrigem = () => `<div class="ordem origem" role="group" aria-label="Origem dos dados">
      <button type="button" data-origem="" aria-pressed="${estado.origem !== "ue"}">Brasil · Anvisa</button>
      <button type="button" data-origem="ue" aria-pressed="${estado.origem === "ue"}">Exportações barradas · UE</button>
    </div>`;

  function linhaRasff(r) {
    const risco = r.risco === "Grave" ? "sem-efeito" : r.risco === "Potencialmente grave" ? "entrar" : "";
    return `<article class="oc">
      <div class="oc__topo">
        <div class="oc__empresa"><h3>${realce(r.assunto_pt || r.assunto)}</h3>
          ${r.assunto_pt ? `<span class="original"><b>Original:</b> ${realce(r.assunto)}</span>` : ""}
          <span class="cnpj dado">${esc(r.referencia)} · notificado por ${esc(r.notificante)}</span></div>
        <div class="oc__acao"><span class="selo ${risco}">${esc(r.classificacao)}</span><span class="dado">${fmt(r.data, { day: "2-digit", month: "2-digit", year: "2-digit" })}</span></div>
      </div>
      <div class="oc__motivos">
        ${r.perigos.map((p) => `<button type="button" class="tag-motivo ${classePerigo(p)}" data-perigo="${esc(p)}">${esc(p)}</button>`).join("")}
        <button type="button" class="tag-motivo" data-cat="${esc(r.categoria)}">${esc(r.categoria)}</button>
        ${r.risco ? `<span class="tag-motivo">Risco: ${esc(r.risco)}</span>` : ""}
      </div>
      <a class="oc__ato" href="${esc(r.url)}" target="_blank" rel="noopener">Ver notificação no RASFF Window ↗</a>
    </article>`;
  }

  function telaRasff() {
    const lista = RASFF.filter((r) => passaRasff(r));
    listaRasffAtual = lista;
    const cPer = contarEm(RASFF, passaRasff, (r) => r.perigos, "perigo");
    const cCat = contarEm(RASFF, passaRasff, (r) => r.categoria, "cat");
    const cats = Object.keys(cCat).sort((a, b) => cCat[b] - cCat[a]);
    app.innerHTML = `
      <section class="topo">
        ${seletorOrigem()}
        <h1>Exportações barradas na Europa <span>produtos do Brasil notificados no RASFF em ${primeiroDia.slice(0, 4)}</span></h1>
        <div class="busca">
          ${ICO_BUSCA}
          <input id="q" type="search" value="${esc(estado.q)}" placeholder="Produto, perigo ou país: frango, salmonella, limão…" autocomplete="off" spellcheck="false" aria-label="Buscar alertas">
          ${estado.q ? `<button class="limpar-q" type="button" data-limpar-q>Limpar</button>` : `<kbd>/</kbd>`}
        </div>
        <div class="sugestoes"><span>Experimente:</span>${["salmonella", "listeria", "aflatoxina", "frango", "bovina", "limão", "agrotóxico"].map((t) => `<button type="button" data-q="${t}">${t}</button>`).join("")}</div>
      </section>
      <section class="filtros" aria-label="Filtros">
        <div class="linha-chips" role="group" aria-label="Perigo">
          ${PERIGOS.map((p) => `<button class="chip" type="button" data-perigo="${esc(p)}" aria-pressed="${estado.perigo === p}" ${cPer[p] || estado.perigo === p ? "" : "disabled"}>${esc(p)}<span class="n">${cPer[p] || 0}</span></button>`).join("")}
        </div>
        <div class="linha-chips" role="group" aria-label="Categoria de produto">
          ${cats.map((c) => `<button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="${estado.cat === c}">${esc(c)}<span class="n">${cCat[c]}</span></button>`).join("")}
          <span class="sep-v"></span>
          ${[["30", "30 dias"], ["90", "90 dias"]].map(([v, r]) => `<button class="chip" type="button" data-periodo="${v}" aria-pressed="${estado.periodo === v && !estado.semana}">${r}</button>`).join("")}
        </div>
      </section>
      ${barrasAtividade(contarEm(RASFF, passaRasff, (r) => r.data, "dia"), ["alerta", "alertas"])}
      <div class="res-cab">
        <strong>${plural(lista.length, "alerta", "alertas")}</strong>
        ${["q", "perigo", "cat", "periodo", "semana"].some((k) => estado[k]) ? `<button class="limpar" type="button" data-limpar-tudo>Limpar filtros</button>` : ""}
        <button class="btn exportar" type="button" data-csv ${lista.length ? "" : "disabled"}>Exportar CSV</button>
      </div>
      <div class="ocs">${lista.length ? lista.slice(0, mostrar).map(linhaRasff).join("") : `<div class="vazio"><strong>Nenhum alerta com esses filtros</strong><span>Tente outro perigo ou categoria.</span></div>`}</div>
      ${lista.length > mostrar ? `<div class="mais"><button class="btn" type="button" data-mais>Mostrar mais ${Math.min(LOTE, lista.length - mostrar)} de ${(lista.length - mostrar).toLocaleString("pt-BR")} restantes</button></div>` : ""}
      <p class="nota" style="margin-top:28px">Fonte: RASFF Window, sistema de alerta rápido para alimentos da União Europeia. A UE não divulga o nome da empresa exportadora; o alerta informa produto, perigo, país notificante e risco.</p>
      ${rodape()}`;
  }
  let listaRasffAtual = [];

  function telaNoticias() {
    const lista = NOTICIAS.filter((n) => passaNoticia(n));
    const cPer = contarEm(NOTICIAS, passaNoticia, (n) => n.temas, "perigo");
    const cFonte = contarEm(NOTICIAS, passaNoticia, (n) => n.fonte, "fonte");
    app.innerHTML = `
      <section class="topo">
        <h1>Notícias internacionais <span>segurança dos alimentos na FAO e no Codex Alimentarius</span></h1>
        <div class="busca">
          ${ICO_BUSCA}
          <input id="q" type="search" value="${esc(estado.q)}" placeholder="Busque em português ou inglês: listeria, aflatoxina, alergênico…" autocomplete="off" spellcheck="false" aria-label="Buscar notícias">
          ${estado.q ? `<button class="limpar-q" type="button" data-limpar-q>Limpar</button>` : `<kbd>/</kbd>`}
        </div>
      </section>
      <section class="filtros" aria-label="Filtros">
        <div class="linha-chips" role="group" aria-label="Tema">
          ${PERIGOS.filter((p) => p !== "Outros").map((p) => `<button class="chip" type="button" data-perigo="${esc(p)}" aria-pressed="${estado.perigo === p}" ${cPer[p] || estado.perigo === p ? "" : "disabled"}>${esc(p)}<span class="n">${cPer[p] || 0}</span></button>`).join("")}
        </div>
        <div class="linha-chips" role="group" aria-label="Fonte">
          ${["FAO", "Codex"].map((f) => `<button class="chip" type="button" data-fonte="${f}" aria-pressed="${estado.fonte === f}">${f}<span class="n">${cFonte[f] || 0}</span></button>`).join("")}
          <span class="sep-v"></span>
          ${[["30", "30 dias"], ["90", "90 dias"]].map(([v, r]) => `<button class="chip" type="button" data-periodo="${v}" aria-pressed="${estado.periodo === v}">${r}</button>`).join("")}
        </div>
      </section>
      <div class="res-cab">
        <strong>${plural(lista.length, "notícia", "notícias")}</strong>
        ${["q", "perigo", "fonte", "periodo"].some((k) => estado[k]) ? `<button class="limpar" type="button" data-limpar-tudo>Limpar filtros</button>` : ""}
      </div>
      <div class="noticias">${lista.slice(0, mostrar).map((n) => `
        <article class="noticia">
          <div class="item__meta"><b>${esc(n.fonte)}</b>${n.comite ? `<span>${esc(n.comite)}</span>` : ""}<span class="dado">${fmt(n.data, { day: "2-digit", month: "short", year: "numeric" })}</span></div>
          <h3 class="item__titulo"><a href="${esc(n.url)}" target="_blank" rel="noopener">${realce(n.titulo_pt || n.titulo)} <span class="ext">↗</span></a></h3>
          ${n.resumo ? `<p class="item__ementa">${realce(n.resumo_pt || n.resumo)}</p>` : ""}
          ${n.titulo_pt ? `<details class="original-bloco"><summary>Ver original em inglês</summary><p><b>${realce(n.titulo)}</b></p>${n.resumo ? `<p>${realce(n.resumo)}</p>` : ""}</details>` : ""}
          ${n.temas.length ? `<div class="oc__motivos">${n.temas.map((t) => `<button type="button" class="tag-motivo ${classePerigo(t)}" data-perigo="${esc(t)}">${esc(t)}</button>`).join("")}</div>` : ""}
        </article>`).join("") || `<div class="vazio"><strong>Nenhuma notícia com esses filtros</strong></div>`}</div>
      ${lista.length > mostrar ? `<div class="mais"><button class="btn" type="button" data-mais>Mostrar mais</button></div>` : ""}
      <p class="nota" style="margin-top:28px">Fontes: <a href="https://www.fao.org/food-safety/news/en/" target="_blank" rel="noopener">FAO · Food safety and quality</a> e <a href="https://codex.fao.org/news" target="_blank" rel="noopener">Codex Alimentarius</a>. Notícias originais em inglês, traduzidas automaticamente para o português (o original fica logo abaixo). Os temas são classificados automaticamente.</p>
      ${rodape()}`;
  }

  function baixarCSV(nome, cab, linhas) {
    const cel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const blob = new Blob(["﻿" + [cab, ...linhas].map((l) => l.map(cel).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(plural(linhas.length, "linha exportada", "linhas exportadas"));
  }
  function exportarRasff() {
    baixarCSV(`rasff-brasil-${estado.perigo ? norm(estado.perigo).replace(/\W+/g, "-") + "-" : ""}${isoDe(new Date())}.csv`,
      ["Data", "Referência", "Assunto (português)", "Assunto (original)", "Categoria", "Perigos", "Classificação", "Risco", "País notificante", "Link"],
      listaRasffAtual.map((r) => [fmt(r.data, { day: "2-digit", month: "2-digit", year: "numeric" }), r.referencia, r.assunto_pt || "", r.assunto, r.categoria,
        r.perigos.join(", "), r.classificacao, r.risco, r.notificante, r.url]));
  }

  function exportarCSV() {
    const cab = ["Data DOU", "Empresa", "CNPJ", "Tipo de produto", "Produtos", "Lotes", "Ação", "Revogação", "Motivos", "Motivação", "Ato", "Link DOU"];
    const cel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const linhas = listaOcAtual.map((o) => [
      fmt(o.data, { day: "2-digit", month: "2-digit", year: "numeric" }), o.empresa, cnpjFmt(o.cnpj), o.tipo_produto,
      o.produtos.map((p) => p.nome).join(" | "), o.produtos.map((p) => p.lote).join(" | "), o.acoes.join(" / "),
      o.revogacao ? "sim" : "não", o.motivos.join(", "), o.motivacao, o.ato.titulo, o.ato.url,
    ].map(cel).join(";"));
    const blob = new Blob(["﻿" + [cab.map(cel).join(";"), ...linhas].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `recolhimentos-${estado.motivo ? norm(estado.motivo).replace(/\W+/g, "-") + "-" : ""}${isoDe(new Date())}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`${plural(listaOcAtual.length, "linha exportada", "linhas exportadas")}`);
  }

  function item(x) {
    const s = sigla(x.orgao);
    return `<article class="item" data-ato="${esc(x.id)}" tabindex="0">
      <span class="item__ponto" style="background:${corOrgao(s)}" aria-hidden="true"></span>
      <div class="item__corpo">
        <div class="item__meta"><b title="${esc(x.hierarquia)}">${esc(s)}</b><span>${esc(x.tipo.split(" – ")[0])}</span><span class="dado">DOU ${fmt(x.data_publicacao, { day: "2-digit", month: "2-digit" })} · p. ${esc(x.pagina || "—")}</span></div>
        <h3 class="item__titulo">${realce(x.titulo)}</h3>
        <p class="item__ementa">${realce(x.ementa || x.resumo.replace(x.titulo, "").trim())}</p>
        ${estado.q && !termosBusca().every((t) => x._curta.includes(t)) ? `<span class="no-texto">encontrado no texto integral</span>` : ""}
        ${(x.macrotemas || []).length ? `<div class="item__temas">${x.macrotemas.map((t) => `<button type="button" data-tema="${esc(t)}">${esc(t)}</button>`).join("")}</div>` : ""}
      </div>
      <div class="item__lado">${botaoSalvar(x.id)}${x.situacao ? `<span class="selo ${classeSituacao(x.situacao)}">${esc(x.situacao)}</span>` : ""}</div>
    </article>`;
  }

  function grupos(lista) {
    if (estado.ordem === "ato") return `<div class="dia">${lista.map(item).join("")}</div>`;
    const por = new Map();
    lista.forEach((x) => { if (!por.has(x.data_publicacao)) por.set(x.data_publicacao, []); por.get(x.data_publicacao).push(x); });
    return [...por].map(([d, xs]) => {
      const ed = [...new Set(xs.map((x) => x.edicao).filter(Boolean))].join(", ");
      const hoje = isoDe(new Date());
      const nome = d === hoje ? "Hoje" : fmt(d, { weekday: "long", day: "numeric", month: "long" });
      return `<section class="dia"><div class="dia__cab"><h2>${esc(nome)}</h2><span>${ed ? `DOU nº ${esc(ed)} · ` : ""}${plural(xs.length, "ato", "atos")}</span></div>${xs.map(item).join("")}</section>`;
    }).join("");
  }

  /* ---------- telas ---------- */
  function telaLista() {
    const salvas = estado.view === "salvas";
    const lista = ITENS.filter((x) => passa(x));
    if (estado.ordem === "ato") lista.sort((a, b) => (b.data_ato + b.id).localeCompare(a.data_ato + a.id));
    listaAtual = lista;
    const cOrgao = contar((x) => sigla(x.orgao), "orgao");
    const cTipo = contar((x) => x.tipo, "tipo");
    const cSit = contar((x) => x.situacao || "", "situacao");
    const cTema = contar((x) => x.macrotemas || [], "tema");
    const filtrosAtivos = ["orgao", "tipo", "situacao", "tema", "periodo", "dia", "semana", "q"].filter((k) => estado[k]).length;

    const cabecalho = salvas
      ? `<h1>Salvas <span>· os atos que você marcou para acompanhar</span></h1>`
      : `<h1>O que saiu no Diário Oficial <span>sobre alimentos e bebidas</span></h1>`;

    app.innerHTML = `
      <section class="topo">
        ${cabecalho}
        <div class="busca">
          ${ICO_BUSCA}
          <input id="q" type="search" value="${esc(estado.q)}" placeholder="Busque por tema, número ou órgão" autocomplete="off" spellcheck="false" aria-label="Buscar atos">
          ${estado.q ? `<button class="limpar-q" type="button" data-limpar-q>Limpar</button>` : `<kbd>/</kbd>`}
        </div>
        ${salvas || estado.q ? "" : `<div class="sugestoes"><span>Experimente:</span>${TEMAS_SUGERIDOS.filter((t) => cTema[t]).map((t) => `<button type="button" data-tema="${esc(t)}">${esc(t.split(" ")[0].toLowerCase() === "rotulagem" ? "rotulagem" : t.toLowerCase())}</button>`).join("")}</div>`}
      </section>

      <section class="filtros" aria-label="Filtros">
        <div class="linha-chips" role="group" aria-label="Órgão">
          ${ORGAOS.map((s) => `<button class="chip" type="button" data-orgao="${esc(s)}" aria-pressed="${estado.orgao === s}" title="${esc(nomeCompleto[s])}" ${cOrgao[s] || estado.orgao === s ? "" : "disabled"}>
            <span class="ponto" style="background:${corOrgao(s)}"></span>${esc(s)}<span class="n">${cOrgao[s] || 0}</span></button>`).join("")}
        </div>
        <div class="linha-chips">
          ${[["7", "7 dias"], ["30", "30 dias"], ["90", "90 dias"]].map(([v, r]) => `<button class="chip" type="button" data-periodo="${v}" aria-pressed="${estado.periodo === v && !estado.dia && !estado.semana}">${r}</button>`).join("")}
          <span class="sep-v"></span>
          ${selectChip("f-tema", "Tema", "tema", cTema)}
          ${selectChip("f-tipo", "Tipo de ato", "tipo", cTipo)}
          ${selectChip("f-situacao", "Situação", "situacao", cSit, ["Vigente", "Vigente com alteração", "A entrar em vigor", "Aberta", "Sem efeito", "Revogada"])}
        </div>
      </section>

      ${salvas ? "" : barrasAtividade(contar((x) => x.data_publicacao, "dia"), ["ato", "atos"])}

      <div class="res-cab">
        <strong>${plural(lista.length, "ato", "atos")}</strong>
        ${filtrosAtivos ? `<button class="limpar" type="button" data-limpar-tudo>Limpar filtros</button>` : ""}
        <div class="ordem" role="group" aria-label="Ordenar">
          <button type="button" data-ordem="" aria-pressed="${estado.ordem !== "ato"}">Por publicação</button>
          <button type="button" data-ordem="ato" aria-pressed="${estado.ordem === "ato"}">Por data do ato</button>
        </div>
      </div>

      <div id="lista">${lista.length ? grupos(lista.slice(0, mostrar)) : vazio(salvas)}</div>
      ${lista.length > mostrar ? `<div class="mais"><button class="btn" type="button" data-mais>Mostrar mais ${Math.min(LOTE, lista.length - mostrar)} de ${(lista.length - mostrar).toLocaleString("pt-BR")} restantes</button></div>` : ""}
      ${rodape()}`;
  }

  function vazio(salvas) {
    if (salvas && !favoritos().size) return `<div class="vazio"><strong>Nada salvo ainda</strong><span>Use o marcador ao lado de um ato para guardá-lo aqui. Fica salvo neste navegador.</span><a class="btn" href="#">Ver todos os atos</a></div>`;
    return `<div class="vazio"><strong>Nenhum ato encontrado</strong><span>Tente outro termo ou remova um filtro.</span><button class="btn" type="button" data-limpar-tudo>Limpar filtros</button></div>`;
  }

  function rodape() {
    return `<footer class="rodape">
      <span>Fonte: Diário Oficial da União, Seção 1 e Extra · <a href="https://www.in.gov.br/leiturajornal" target="_blank" rel="noopener">in.gov.br</a></span>
      <span class="atalhos"><kbd>/</kbd> buscar · <kbd>j</kbd> <kbd>k</kbd> navegar · <kbd>s</kbd> salvar · <kbd>Esc</kbd> fechar</span>
    </footer>`;
  }

  function telaFontes() {
    const max = Math.max(...Object.values(contaOrgao));
    app.innerHTML = `<section class="fontes">
      <h1>De onde vêm os atos</h1>
      <p>Duas vezes por dia, às 7h e às 19h, este computador lê a edição do <a href="https://www.in.gov.br/leiturajornal" target="_blank" rel="noopener">Diário Oficial da União</a> (Seção 1 e Seção 1 Extra) e guarda os atos normativos sobre alimentos, bebidas, embalagens, rotulagem e defesa agropecuária. Atos de pessoal e de orçamento ficam de fora.</p>
      <p>No mesmo horário entram as fontes internacionais: notícias de segurança dos alimentos da <a href="https://www.fao.org/food-safety/news/en/" target="_blank" rel="noopener">FAO</a> e do <a href="https://codex.fao.org/news" target="_blank" rel="noopener">Codex Alimentarius</a> (${INTER.noticias.length} em ${primeiroDia.slice(0, 4)}) e os alertas do <a href="https://webgate.ec.europa.eu/rasff-window/screen/search" target="_blank" rel="noopener">RASFF</a>, da União Europeia, sobre produtos do Brasil (${INTER.rasff.length}).</p>
      <p>Tipo, tema e situação são classificados automaticamente a partir do texto publicado. Na dúvida, abra o original no in.gov.br pelo próprio ato.</p>
      <p><strong>${plural(ITENS.length, "ato", "atos")}</strong> na base · última leitura em ${DADOS.atualizado_em ? new Date(DADOS.atualizado_em).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" }) : "—"}.</p>
      <div style="display:grid;gap:10px;margin-top:8px">
        ${ORGAOS.map((s) => `<div class="barra-orgao"><span title="${esc(nomeCompleto[s])}">${esc(s)}</span><i style="width:${(contaOrgao[s] / max) * 100}%;background:${corOrgao(s)}"></i><span class="dado">${contaOrgao[s]}</span></div>`).join("")}
      </div>
    </section>${rodape()}`;
  }

  /* ---------- detalhe ---------- */
  function abrirAto(id) {
    const x = ITENS.find((i) => i.id === id);
    if (!x) { gaveta.hidden = true; return; }
    const pos = listaAtual.findIndex((i) => i.id === id);
    document.getElementById("g-pos").textContent = pos >= 0 ? `${pos + 1} de ${listaAtual.length}` : "";
    const s = sigla(x.orgao);
    gCorpo.innerHTML = `
      <div class="item__meta"><span class="item__ponto" style="background:${corOrgao(s)};margin:0"></span><b>${esc(s)}</b><span>${esc(x.tipo)}</span>${x.situacao ? `<span class="selo ${classeSituacao(x.situacao)}">${esc(x.situacao)}</span>` : ""}</div>
      <h1 id="g-titulo">${esc(x.titulo)}</h1>
      ${x.ementa ? `<p class="g-ementa">${esc(x.ementa)}</p>` : ""}
      <div class="g-acoes">
        <a class="btn primario" href="${esc(x.url)}" target="_blank" rel="noopener">Abrir no DOU ↗</a>
        <button class="btn" type="button" data-salvar="${esc(x.id)}" aria-pressed="${favoritos().has(x.id)}">${favoritos().has(x.id) ? "Salvo" : "Salvar"}</button>
        <button class="btn" type="button" data-copiar="${esc(x.url)}">Copiar link oficial</button>
        <button class="btn" type="button" onclick="window.print()">Imprimir</button>
      </div>
      <dl class="ficha">
        <dt>Órgão</dt><dd>${esc(x.hierarquia.split("/").join(" › "))}</dd>
        <dt>Data do ato</dt><dd>${fmt(x.data_ato, { day: "numeric", month: "long", year: "numeric" })}</dd>
        <dt>Publicação</dt><dd>DOU nº ${esc(x.edicao || "—")} · ${esc(x.secao)} · página ${esc(x.pagina || "—")} · ${fmt(x.data_publicacao, { day: "2-digit", month: "2-digit", year: "numeric" })}</dd>
        ${(x.macrotemas || []).length ? `<dt>Temas</dt><dd>${x.macrotemas.map(esc).join(", ")}</dd>` : ""}
      </dl>
      <div class="texto" id="texto"><p class="carregando">Carregando o texto integral…</p></div>
      <p class="nota">Texto reproduzido do Diário Oficial da União. Não substitui a versão certificada publicada no in.gov.br.</p>`;
    const novo = gaveta.hidden;
    gaveta.hidden = false;
    document.body.style.overflow = "hidden";
    gCorpo.scrollTop = 0;
    if (novo) gaveta.querySelector(".gaveta__painel").focus();
    document.querySelectorAll(".item.foco").forEach((e) => e.classList.remove("foco"));
    const el = app.querySelector(`[data-ato="${CSS.escape(id)}"]`);
    if (el) { el.classList.add("foco"); el.scrollIntoView({ block: "nearest" }); }
    carregarTexto(x);
  }
  function fecharAto() {
    gaveta.hidden = true;
    document.body.style.overflow = "";
    const foco = app.querySelector(".item.foco");
    if (foco) foco.focus({ preventScroll: true });
  }
  function carregarTexto(x) {
    window.__texto = (d) => {
      const alvo = document.getElementById("texto");
      if (!alvo || d.id !== estado.ato) return;
      alvo.innerHTML = d.paragrafos.length ? d.paragrafos.map((p) => `<p class="${esc(p.c)}">${realce(p.t)}</p>`).join("") : `<p>${esc(x.resumo)}</p>`;
    };
    const s = document.createElement("script");
    s.src = `data/textos/${encodeURIComponent(x.id)}.js`;
    s.onerror = () => { const a = document.getElementById("texto"); if (a) a.innerHTML = `<p>${esc(x.resumo)}</p><p><a href="${esc(x.url)}" target="_blank" rel="noopener">Ler o texto completo no DOU ↗</a></p>`; };
    s.onload = () => s.remove();
    document.body.appendChild(s);
  }
  function navegar(passo) {
    if (!listaAtual.length) return;
    const i = listaAtual.findIndex((x) => x.id === estado.ato);
    const prox = listaAtual[Math.min(listaAtual.length - 1, Math.max(0, i + passo))];
    if (!prox) return;
    const idx = listaAtual.indexOf(prox);
    if (idx >= mostrar) { mostrar = idx + LOTE; telaLista(); }
    atualizar({ ato: prox.id }, { substituir: true });
  }

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
  }

  /* ---------- render ---------- */
  let ultimaVista = "";
  function render() {
    document.querySelectorAll(".abas a").forEach((a) => a.classList.toggle("ativa", a.dataset.view === estado.view));
    const n = favoritos().size;
    document.getElementById("conta-salvas").textContent = n || "";
    const chaveVista = JSON.stringify({ ...estado, ato: "" }) + mostrar;
    if (chaveVista !== ultimaVista) {
      const focoBusca = document.activeElement?.id === "q";
      const cursor = focoBusca ? document.activeElement.selectionStart : null;
      if (estado.view === "fontes") telaFontes();
      else if (estado.view === "empresas") (estado.origem === "ue" ? telaRasff : telaEmpresas)();
      else if (estado.view === "noticias") telaNoticias();
      else telaLista();
      if (focoBusca) { const q = document.getElementById("q"); if (q) { q.focus(); q.setSelectionRange(cursor, cursor); } }
      ultimaVista = chaveVista;
    }
    if (estado.ato) abrirAto(estado.ato); else if (!gaveta.hidden) fecharAto();
    document.title = estado.ato ? `${ITENS.find((i) => i.id === estado.ato)?.titulo || "Ato"} · Legislação` : "Legislação";
  }

  /* ---------- eventos ---------- */
  let buscaTimer;
  app.addEventListener("input", (e) => {
    if (e.target.id !== "q") return;
    clearTimeout(buscaTimer);
    buscaTimer = setTimeout(() => atualizar({ q: e.target.value.trim() }, { substituir: true }), 120);
  });
  app.addEventListener("change", (e) => {
    const f = e.target.dataset.filtro;
    if (f) atualizar({ [f]: e.target.value });
  });
  document.addEventListener("click", (e) => {
    const alvo = e.target.closest("button, a, [data-ato], [data-fechar]");
    if (!alvo) return;
    const d = alvo.dataset;
    if ("salvar" in d) {
      e.stopPropagation();
      const on = alternarFavorito(d.salvar);
      document.querySelectorAll(`[data-salvar="${CSS.escape(d.salvar)}"]`).forEach((b) => {
        b.setAttribute("aria-pressed", on);
        if (b.classList.contains("btn")) b.textContent = on ? "Salvo" : "Salvar";
      });
      document.getElementById("conta-salvas").textContent = favoritos().size || "";
      if (estado.view === "salvas" && !on) { ultimaVista = ""; render(); }
      return;
    }
    if ("copiar" in d) {
      const ok = d.rotulo || "Link copiado";
      if (navigator.clipboard) navigator.clipboard.writeText(d.copiar).then(() => toast(ok), () => toast(d.copiar));
      else toast(d.copiar);
      return;
    }
    if ("csv" in d) return estado.origem === "ue" ? exportarRasff() : exportarCSV();
    if ("origem" in d) return atualizar({ origem: d.origem, q: "", semana: "", periodo: "", perigo: "", cat: "", motivo: "" });
    if ("perigo" in d) return atualizar({ perigo: estado.perigo === d.perigo ? "" : d.perigo });
    if ("fonte" in d) return atualizar({ fonte: estado.fonte === d.fonte ? "" : d.fonte });
    if ("cat" in d) return atualizar({ cat: estado.cat === d.cat ? "" : d.cat });
    if ("abrir" in d) return atualizar({ ato: d.abrir });
    if ("q" in d) return atualizar({ q: d.q });
    if ("semana" in d) return atualizar({ semana: estado.semana === d.semana ? "" : d.semana, periodo: "", dia: "" });
    if ("motivo" in d) return atualizar({ motivo: estado.motivo === d.motivo ? "" : d.motivo });
    if ("tprod" in d) return atualizar({ tprod: d.tprod === "Alimento" ? "" : d.tprod });
    if ("alternar" in d) return atualizar({ [d.alternar]: estado[d.alternar] ? "" : "1" });
    if ("fechar" in d) return atualizar({ ato: "" }, { substituir: true });
    if ("nav" in d) return navegar(Number(d.nav));
    if ("view" in d) { e.preventDefault(); return atualizar({ view: d.view, ato: "", q: "", semana: "", dia: "", periodo: "", perigo: "", fonte: "", cat: "" }); }
    if ("orgao" in d) return atualizar({ orgao: estado.orgao === d.orgao ? "" : d.orgao });
    if ("periodo" in d) return atualizar({ periodo: estado.periodo === d.periodo && !estado.dia && !estado.semana ? "" : d.periodo, dia: "", semana: "" });
    if ("dia" in d) return atualizar({ dia: estado.dia === d.dia ? "" : d.dia, periodo: "" });
    if ("tema" in d) { e.stopPropagation(); return atualizar({ tema: d.tema, ato: "" }); }
    if ("ordem" in d) return atualizar({ ordem: d.ordem });
    if ("limparQ" in d) { atualizar({ q: "" }); document.getElementById("q")?.focus(); return; }
    if ("limparTudo" in d) return atualizar({ q: "", orgao: "", tipo: "", situacao: "", tema: "", periodo: "", dia: "", semana: "", motivo: "", tprod: "", revog: "", semcnpj: "", perigo: "", fonte: "", cat: "" });
    if ("mais" in d) { mostrar += LOTE; ultimaVista = ""; render(); return; }
    if ("ato" in d && alvo.classList.contains("item")) return atualizar({ ato: d.ato });
  });
  document.addEventListener("keydown", (e) => {
    const digitando = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
    if (e.key === "Escape") {
      if (estado.ato) return atualizar({ ato: "" }, { substituir: true });
      if (digitando) document.activeElement.blur();
      return;
    }
    if (digitando || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/") { e.preventDefault(); document.getElementById("q")?.focus(); return; }
    if (e.key === "Enter" && document.activeElement?.classList.contains("item")) return atualizar({ ato: document.activeElement.dataset.ato });
    if (e.key === "j" || e.key === "k") {
      if (estado.ato) return navegar(e.key === "j" ? 1 : -1);
      const itens = [...app.querySelectorAll(".item")];
      const i = itens.indexOf(document.activeElement);
      itens[Math.min(itens.length - 1, Math.max(0, i + (e.key === "j" ? 1 : -1)))]?.focus();
    }
    if (e.key === "s" && estado.ato) gCorpo.querySelector("[data-salvar]")?.click();
  });
  window.addEventListener("popstate", () => { lerHash(); render(); });
  window.addEventListener("hashchange", () => { lerHash(); render(); });

  // tema claro/escuro (respeita o sistema até a pessoa escolher)
  const temaSalvo = armazem.ler("legis:tema", "");
  if (temaSalvo) document.documentElement.dataset.theme = temaSalvo;
  document.getElementById("tema").addEventListener("click", () => {
    const escuroAgora = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const novo = escuroAgora ? "light" : "dark";
    document.documentElement.dataset.theme = novo;
    armazem.gravar("legis:tema", novo);
  });

  document.getElementById("status").textContent = DADOS.atualizado_em
    ? `Atualizado ${new Date(DADOS.atualizado_em).toLocaleString("pt-BR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
    : "Sem dados ainda";

  lerHash();
  render();

  // índice de texto integral: carrega depois da primeira tela
  window.__indice = (m) => {
    ITENS.forEach((x) => { if (m[x.id]) x._busca = x._curta + " " + m[x.id]; });
    if (estado.q) { ultimaVista = ""; render(); }
  };
  let indicePedido = false;
  function carregarIndice() {
    if (indicePedido) return;
    indicePedido = true;
    const idx = document.createElement("script");
    idx.src = "data/indice_busca.js";
    idx.onload = () => idx.remove();
    document.body.appendChild(idx);
  }
  // o índice (texto integral) só é baixado quando a pessoa começa a buscar
  if (estado.q) carregarIndice();
  document.addEventListener("focusin", (e) => { if (e.target.id === "q") carregarIndice(); });
})();
