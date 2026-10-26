# RESistemas v33 - Controle de Importação e Exportação

## Escopo
- Visão do importador e exportador.
- Cadastro de armadores, transportadores, NVOCC, despachantes e agenciadores de carga.
- Processos, mercadorias, embarques, documentos, custos e marcos.
- Referências para DUIMP, DI, DUE, LPCO, LI, BL e AWB.
- Custos projetados e realizados, landed cost, armazenagem, demurrage e detention.

## Instalação
```js
import { comexRouter } from "./routes/comex.js";
app.use(comexRouter);
```
Execute:
```powershell
node src\database\migrate-v33-comex.js
```
No `modules.js`, configure `expimpo` com `home: "/comex"`.
No `module-context.js`, associe `/comex` ao módulo `expimpo`.

## Integrações futuras
- Portal Único Siscomex via APIs autorizadas.
- Financeiro usando `financial_title_id` em custos.
- Estoque para entrada da mercadoria desembaraçada.
- Contabilidade para apropriação de custos e tributos.
