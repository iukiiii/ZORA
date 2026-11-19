@echo off
chcp 65001 >nul
title ZORA - Compilar instalador Windows
echo ==========================================
echo          ZORA BROWSER - BUILD
echo ==========================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo ERRO: Node.js nao esta instalado.
  echo Instala a versao LTS em https://nodejs.org/
  pause
  exit /b 1
)
echo A instalar dependencias...
call npm install
if errorlevel 1 (
  echo.
  echo ERRO ao instalar dependencias. Verifica a ligacao a Internet.
  pause
  exit /b 1
)
echo.
echo A criar instalador Windows...
call npm run dist:win
if errorlevel 1 (
  echo.
  echo ERRO durante a compilacao.
  pause
  exit /b 1
)
echo.
echo CONCLUIDO! Procura ZORA-Setup-0.1.0.exe dentro da pasta dist.
pause
