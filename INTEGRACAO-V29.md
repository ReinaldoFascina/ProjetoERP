# RESistemas v29 - Controle de Produção

## Inclui
- Produto final e estrutura de produto usando `catalog_items` existente.
- Máquinas, capacidade diária, roteiro e tempo de produção.
- Ordens de produção e cópia das operações do roteiro.
- Apontamento de produção, rejeição, tempo e paradas.
- Indicadores de produtividade e qualidade por máquina.

## Instalação
1. Copie a pasta `src` sobre o projeto.
2. No `server.js`:
```js
import { productionRouter } from "./routes/production.js";
app.use(productionRouter);
```
3. Em `module-context.js`, associe `/production` ao módulo `production`.
4. Execute:
```powershell
node src\database\migrate-v29-production.js
```

## Menu sugerido
- `/production`
- `/production/machines`
- `/production/capacity`
- `/production/structures`
- `/production/routings`
- `/production/orders`
- `/production/productivity`

## Observação
O módulo pressupõe a tabela existente `catalog_items` com `id`, `company_id`, `branch_id`, `code`, `description`, `unit`, `item_type` e `active`.
