#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo '=========================================='
echo '          ZORA BROWSER - LINUX'
echo '=========================================='
if ! command -v node >/dev/null 2>&1; then
  echo 'ERRO: Node.js nao esta instalado.'
  echo 'Instala a versao LTS em https://nodejs.org/'
  exit 1
fi
echo
echo 'A instalar dependencias...'
npm install
echo
echo 'A criar AppImage e DEB...'
npm run dist:linux
echo
echo 'CONCLUIDO! Os ficheiros estao dentro da pasta dist.'
