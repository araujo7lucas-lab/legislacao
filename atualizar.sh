#!/usr/bin/env bash
# Atualização da cópia local (timer do systemd, 07h e 19h).
# A coleta principal roda no GitHub Actions; aqui só baixamos a base publicada no ramo "dados".
# Se o GitHub estiver fora do ar, coleta localmente como antes.
set -uo pipefail
cd "$(dirname "$0")"
mkdir -p logs
{
  echo "=== $(date '+%F %T') ==="
  if git fetch -q --depth=1 origin dados && git restore --source=origin/dados --worktree -- site/data traducoes.json; then
    echo "Base baixada do GitHub (ramo dados)."
  else
    echo "GitHub indisponível; coletando localmente."
    /usr/bin/python3 coletor.py --dias 3
    /usr/bin/python3 coletor_internacional.py || echo "falha no coletor internacional"
  fi
} >> "logs/atualizacao.log" 2>&1
# mantém o log enxuto
tail -n 2000 logs/atualizacao.log > logs/.tmp && mv logs/.tmp logs/atualizacao.log
