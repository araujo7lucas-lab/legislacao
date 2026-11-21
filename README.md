# Legislação

Busca de legislação de alimentos e bebidas publicada no **Diário Oficial da União**,
atualizada automaticamente duas vezes por dia.

- Busca instantânea (sem acento, por tema, número ou órgão), com os termos realçados
- Filtros em chips com contagens que se ajustam aos outros filtros
- Gráfico dos últimos 45 dias: clique numa barra para ver só aquele dia
- Lista agrupada por edição do DOU; o ato abre num painel lateral com o texto integral
- "Salvas" (fica no navegador), tema claro/escuro e atalhos: `/` buscar, `j`/`k` navegar, `s` salvar, `Esc` fechar

## Como abrir

- Direto: dê dois cliques em `site/index.html` (funciona sem servidor).
- Ou com servidor local: `python3 -m http.server 8767 --directory site` e abra http://localhost:8767

## No celular (mesma rede Wi-Fi)

O serviço `legislacao-site` serve a página na rede de casa, porta 8090, e inicia sozinho com o sistema:
abra `http://<IP do computador>:8090` no celular.
Ver o IP atual: `hostname -I`. Parar: `systemctl --user disable --now legislacao-site`.

## Fonte dos dados

`coletor.py` lê `https://www.in.gov.br/leiturajornal` (Seção 1 e Seção 1 Extra), seleciona os
atos de Anvisa, MAPA (SDA/DIPOA/DIPOV), Inmetro, CTNBio, MPA e de outros órgãos que tratem de
alimentos/bebidas/embalagens/rotulagem, descarta atos de pessoal e orçamento, baixa o texto
integral e classifica Tipo, Órgão, Macrotema e Situação.

Saída: `site/data/legislacoes.js` (+ `.json`) e `site/data/textos/<id>.js`.

## Fontes internacionais

`coletor_internacional.py` lê as notícias de segurança dos alimentos da **FAO** e do **Codex Alimentarius**
(aba Notícias) e os alertas do **RASFF** (União Europeia) com produtos de origem brasileira
(Recolhimentos → Exportações barradas · UE). Saída: `site/data/internacional.js`.

## Atualização diária

Roda no **GitHub Actions** às 07h e 19h (horário de Brasília), mesmo com o computador desligado:
coleta DOU, FAO, Codex e RASFF, traduz o que for novo, salva a base no ramo `dados`
(só a versão mais recente, para o repositório não crescer) e publica a página no GitHub Pages.

No computador, o timer `legislacao-atualizar` baixa essa base do GitHub nos mesmos horários;
se o GitHub estiver fora do ar, coleta localmente.

```bash
git fetch origin dados && git restore --source=origin/dados --worktree -- site/data traducoes.json  # baixar a base
python3 coletor.py --desde 2026-01-01      # recoletar o ano (≈1 hora)
python3 coletor_internacional.py --desde 2026-01-01
systemctl --user start legislacao-atualizar.service  # atualizar agora
```

## Tradução

Notícias e alertas em inglês/espanhol/outros idiomas aparecem em português, com o original ao lado.
As traduções ficam em `traducoes.json`; textos novos são traduzidos pelo serviço gratuito MyMemory
(limite diário de ~5 mil caracteres; o que passar disso é traduzido na rodada seguinte).
