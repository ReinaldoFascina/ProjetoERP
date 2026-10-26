# RESistemas v35 - Copiloto Operacional

## Recursos
- Painel lateral contextual em todas as telas.
- Central de conversas, alertas, ações e auditoria.
- Ferramentas controladas, sem SQL livre gerado pelo modelo.
- Contexto multiempresa e filial obtido exclusivamente da sessão.
- Consultas de estoque, financeiro, manutenção, COMEX e DUIMP.
- Criação de proposta de rascunho de manutenção com aprovação humana.
- Auditoria de mensagens, ferramentas, duração, erros e tokens.
- Integração REST com Azure OpenAI.

## 1. Migração
```powershell
node .\src\database\migrate-v35-ai-copilot.js
```

## 2. Server.js
```js
import { aiAssistantRouter } from "./routes/ai-assistant.js";
app.use(aiAssistantRouter);
```
Registre o router antes do middleware 404.

## 3. Arquivos públicos
Copie `public/ai-assistant.js` e `public/ai-assistant.css` para a pasta pública do projeto.

No `head.ejs`, dentro do `<head>`:
```ejs
<link rel="stylesheet" href="/ai-assistant.css">
<script src="/ai-assistant.js" defer></script>
```

## 4. Menu
Use o conteúdo de `MENU-COPILOTO.ejs` no menu lateral.

## 5. Configuração da IA
Copie `.env.ai.example` para o `.env` e informe o endpoint, deployment, versão da API e chave.
Nunca grave a chave no código ou no Git.

## 6. Ajuste de nomes das tabelas
O projeto foi criado com base nas tabelas usadas pelas versões entregues anteriormente. Se seu banco usar nomes diferentes para saldo ou financeiro, ajuste somente as consultas em:
`src/services/ai/tools/operational-tools.js`.

## 7. Segurança
- O modelo não recebe credenciais do banco.
- O modelo não executa SQL.
- Toda ferramenta usa company_id e branch_id da sessão.
- Ações de escrita passam por `ai_actions` e aprovação.
- Segredos são mascarados na auditoria.

## 8. Primeiros testes
- `Qual é o saldo do produto 000145?`
- `Consulte os recebíveis vencidos dos próximos 30 dias.`
- `Analise a manutenção do equipamento PR-005.`
- `Consulte o processo COMEX IMP-2026-0042.`
- Na tela `/comex/duimp/45`: `Revise esta DUIMP.`
