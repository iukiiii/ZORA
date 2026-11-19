# ZORA Browser 0.1.0 — compilação Linux

Esta versão mantém a compilação Windows e acrescenta dois formatos Linux:

- **AppImage** — formato portátil, adequado a várias distribuições Linux.
- **DEB** — pacote para Debian, Ubuntu, Linux Mint e distribuições compatíveis.

## Compilar num computador Linux

1. Instala Node.js LTS em https://nodejs.org/.
2. Extrai a pasta do projeto.
3. Abre o terminal dentro da pasta do projeto.
4. Executa:

```bash
chmod +x COMPILAR-ZORA-LINUX.sh
./COMPILAR-ZORA-LINUX.sh
```

Os ficheiros serão criados na pasta `dist`.

Também podes executar diretamente:

```bash
npm install
npm run dist:linux
```

## Compilar através do GitHub (sem computador Linux)

O projeto inclui o workflow `.github/workflows/build-linux.yml`.

1. Envia o projeto completo para o repositório GitHub `iukiiii/ZORA`.
2. Abre o separador **Actions** do repositório.
3. Escolhe **Build ZORA for Linux**.
4. Carrega em **Run workflow**.
5. Quando terminar, abre a execução e descarrega o artefacto `ZORA-Linux-0.1.0`.

O artefacto contém o `.AppImage` e o `.deb`.

## Utilização

- Para o AppImage, poderá ser necessário permitir a execução do ficheiro nas propriedades ou executar `chmod +x ZORA-0.1.0.AppImage` no terminal.
- O DEB pode ser instalado em sistemas Debian/Ubuntu compatíveis.

Antes de publicar, testa os dois formatos numa distribuição Linux. A compilação não substitui os testes em computadores reais.
