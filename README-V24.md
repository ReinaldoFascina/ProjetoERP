# RESistemas 24.0.0

Pacote cumulativo para consolidar Multiempresa, Movimentos, NFS-e, NFS-e Nacional, Fiscal, Livros e Apuração, com experiência operacional inspirada no fluxo de movimentos do TOTVS RM e identidade própria do RESistemas.

## O que está consolidado

- Empresa e filial na sessão e nas tabelas operacionais.
- Emissão de NFS-e a partir do faturamento de serviços.
- Transmissão da DPS da NFS-e Nacional com validação, assinatura A1 e histórico.
- Cadastro fiscal de tributos, alíquota, vigência e vencimento padrão.
- Períodos de apuração, lançamentos, cálculo e fechamento.
- Escrituração dos impostos dos movimentos nos livros fiscais.
- Módulos AT, FI e FS.
- Ativação automática do módulo FS nas rotas `/fiscal`, `/nfse` e `/nfse-national`.
- CSS e JavaScript adicionais para telas de movimento e NFS-e em padrão operacional RM-like.

## Instalação segura no projeto existente

Faça backup do banco e do projeto. Extraia este pacote fora do projeto e execute:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-v24.ps1 `
  -ProjectPath "C:\Users\reina\Documents\github\RESistemas\projeto"
```

O instalador copia/atualiza somente os arquivos do pacote, altera a versão para `24.0.0`, inclui o script `db:v24` e garante as dependências `node-forge` e `xml-crypto`.

Depois:

```powershell
cd C:\Users\reina\Documents\github\RESistemas\projeto
npm install
npm run db:v24
npm run dev
```

## Integração das folhas de estilo e scripts

No `src/views/partials/head.ejs`, depois do CSS principal:

```ejs
<link rel="stylesheet" href="/nfse-module.css">
<link rel="stylesheet" href="/v24-rm.css">
```

Antes do fechamento de `body`, no partial de rodapé:

```ejs
<script src="/menu.js" defer></script>
<script src="/rm-movement.js" defer></script>
```

## Menu Fiscal

Inclua no módulo `fiscal`:

```ejs
<a href="/fiscal" data-path="/fiscal">Dashboard fiscal</a>
<a href="/nfse" data-path="/nfse">Emissão de NFS-e</a>
<a href="/nfse-national" data-path="/nfse-national">Transmissão nacional</a>
<a href="/fiscal/books" data-path="/fiscal/books">Livros fiscais</a>
<a href="/fiscal/periods" data-path="/fiscal/periods">Períodos de apuração</a>
```

## Certificado A1

Nunca coloque PFX, senha ou token no Git. Configure no `.env`:

```env
NFSE_NATIONAL_ENVIRONMENT=RESTRITA
NFSE_NATIONAL_RESTRICTED_URL=https://adn.producaorestrita.nfse.gov.br
NFSE_NATIONAL_PRODUCTION_URL=
NFSE_NATIONAL_DPS_PATH=/nfse
NFSE_NATIONAL_TIMEOUT_MS=45000
NFSE_NATIONAL_CERT_PFX_PATH=C:/certificados/empresa-a1.pfx
NFSE_NATIONAL_CERT_PFX_PASSWORD=
```

Valide primeiro em ambiente restrito.

## Observação sobre arquivos não substituídos

O pacote é cumulativo para os módulos construídos nesta conversa, mas foi preparado como atualização sobre o projeto existente. Rotas e telas antigas que não foram enviadas permanecem no projeto e não são apagadas pelo instalador.
