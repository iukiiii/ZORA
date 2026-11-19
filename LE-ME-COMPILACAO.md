# ZORA Browser 0.1.0 — compilação Windows

Esta pasta contém o código-fonte da versão mais recente do ZORA e a configuração para gerar um instalador Windows NSIS.

## Como gerar o instalador

1. Instala Node.js LTS em https://nodejs.org/ (se ainda não estiver instalado).
2. Extrai esta pasta para um local simples, por exemplo `C:\ZORA`.
3. Faz duplo clique em `COMPILAR-ZORA-WINDOWS.bat`.
4. Aguarda a instalação das dependências e a compilação.
5. O instalador deverá aparecer em `dist\ZORA-Setup-0.1.0.exe`.

Também podes abrir CMD nesta pasta e executar:

```bat
npm install
npm run dist:win
```

O instalador inclui os ficheiros necessários do Electron. Não distribuas apenas o `electron.exe` renomeado como `ZORA.exe`.

## Nota

A compilação precisa de ligação à Internet na primeira execução para descarregar dependências. Antes de publicar o instalador, instala-o e testa a abertura do ZORA num Windows.
