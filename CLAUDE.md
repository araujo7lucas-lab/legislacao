# Legislação

Busca de legislação de alimentos e bebidas, recolhimentos e alertas de contaminação, para prospecção de clientes
(empresas com lotes contaminados: microbiologia, alergênicos, micotoxinas).

- Página: https://araujo7lucas-lab.github.io/legislacao/ (GitHub Pages)
- Responder sempre em português do Brasil; o usuário não lê inglês.

## Estrutura

- `coletor.py` — Diário Oficial da União (in.gov.br, Seção 1 e Extra): filtra atos de alimentos, baixa texto integral,
  classifica tipo/órgão/macrotema/situação e extrai ocorrências (empresa, CNPJ, produto, lote, motivo) das Resoluções-RE
  de fiscalização da Anvisa. `--dias N`, `--desde AAAA-MM-DD`, `--so-indice` (regera índice e ocorrências sem baixar).
- `coletor_internacional.py` — notícias FAO (food-safety) e Codex (API `SearchNews`) e alertas RASFF (UE) de origem
  brasileira; traduz para PT (cache `traducoes.json` + MyMemory para textos novos, ~5 mil caracteres/dia).
- `site/` — página estática (HTML/CSS/JS puros). Dados em `site/data/` (`legislacoes.js`, `internacional.js`,
  `indice_busca.js` carregado só na primeira busca, `textos/<id>.js`). Abas: Todas, Recolhimentos (Anvisa | UE), Notícias,
  Salvas, Fontes. Estado da tela no `#hash`.
- `.github/workflows/atualizar.yml` — 07h e 19h (BRT): coleta, grava a base no ramo `dados` e publica no Pages.

## Regras

- **Nunca versionar `site/data/` nem `traducoes.json` no `main`.** Eles vivem no ramo `dados`, que guarda só a versão mais
  recente (force-push), para o repositório não crescer ~30 MB por rodada. Para trazer a base:
  `git fetch origin dados && git restore --source=origin/dados --worktree -- site/data traducoes.json`
- Commits com o e-mail noreply do GitHub já configurado no repositório; nada de dados pessoais (IP, e-mail, caminhos locais).
- Visual próprio: não copiar a Regoola (layout, logo, cores ou textos).
- Conteúdo estrangeiro sempre em português com o original ao lado.
- Ao mudar `app.js`/`estilo.css`, subir o `?v=` em `site/index.html` (cache do navegador).

## Neste computador

- Timer `legislacao-atualizar` (systemd do usuário) baixa o ramo `dados` às 07h/19h; se falhar, coleta localmente.
- Serviço `legislacao-site` serve `site/` na rede de casa, porta 8090 (celular no mesmo Wi-Fi).
- Prévia no Claude: `.claude/launch.json` → servidor `legislacao` na porta 8767.
