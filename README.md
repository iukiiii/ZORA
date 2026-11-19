# ZORA Browser — protótipo 0.1

Browser desktop experimental para Windows e Linux, construído com Electron/Chromium.

## Requisitos
- Node.js LTS (recomendado)
- npm
- Windows 10/11 ou uma distribuição Linux suportada
- Ligação à Internet para instalar dependências e navegar

## Executar
1. Extrai a pasta `ZORA`.
2. Abre a pasta no VS Code.
3. Abre o terminal na pasta onde está `package.json`.
4. Executa:

   ```bash
   npm install
   npm start
   ```

## Criar instaladores
No Windows:
```bash
npm run dist
```
O instalador será criado em `dist/`.

No Linux, executa `npm run dist` num ambiente Linux. Serão produzidos AppImage e/ou deb.

## Funcionalidades já incluídas
- Janela desktop com identidade visual ZORA
- Navegação HTTP/HTTPS e pesquisa DuckDuckGo
- Separadores, abrir/fechar e alternar
- Voltar, avançar, recarregar e início
- Atalhos Ctrl+L, Ctrl+T e Ctrl+W
- Isolamento entre a interface local e páginas web
- `contextIsolation`, `sandbox`, `nodeIntegration: false`
- Bloqueio experimental de uma pequena lista de domínios de rastreio
- Bloqueio de protocolos de navegação que não sejam HTTP/HTTPS

## Limitações importantes
Este é um protótipo inicial, não um browser auditado nem pronto para uso sensível.
O bloqueio de rastreadores é uma lista simples e incompleta. Não substitui listas de filtros mantidas, proteção contra fingerprinting, Safe Browsing, sandboxing adicional, auditorias ou atualizações regulares.
A sessão do browser é persistente (`persist:zora`), pelo que cookies e dados de sites podem permanecer entre execuções.
Não introduzas palavras-passe importantes nem dados sensíveis nesta versão.

## Próximas etapas recomendadas
1. Gestão de permissões por site com decisão explícita do utilizador.
2. Modo privado com sessão temporária realmente isolada.
3. Gestão e limpeza de cookies, cache e armazenamento.
4. Listas de bloqueio atualizadas e proteção contra phishing.
5. Página de definições, política de privacidade e testes de segurança.
6. Atualizações assinadas e distribuição segura.
