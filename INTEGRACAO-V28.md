# RESistemas v28 - Controle Contábil

## Instalação
1. Copie `src` para o projeto.
2. Importe no `server.js`:
```js
import { accountingRouter } from './routes/accounting.js';
```
3. Antes do 404:
```js
app.use(accountingRouter);
```
4. No `module-context.js`, associe `/accounting` ao módulo contábil ou ao módulo fiscal.
5. Execute:
```powershell
node src\database\migrate-v28-accounting.js
```

## Rotas
- `/accounting`
- `/accounting/accounts`
- `/accounting/cost-centers`
- `/accounting/reference-accounts`
- `/accounting/books`
- `/accounting/entries`
- `/accounting/sped`

## Aviso SPED
O gerador incluído é uma base técnica inicial. Valide o arquivo no PGE oficial da ECD e mantenha o leiaute parametrizado. Não transmita em produção sem homologação contábil e fiscal.
