# RESistemas v30 - Controle Patrimonial

## Instalação
1. Copie `src` para o projeto.
2. No `server.js`:
```js
import { assetsRouter } from "./routes/assets.js";
app.use(assetsRouter);
```
3. No `module-context.js`, associe `/assets` ao módulo `patrimonio`.
4. Execute:
```powershell
node src\database\migrate-v30-assets.js
```

## Integração automática com compras
No fluxo que confirma o movimento de compra, dentro da mesma transação, importe:
```js
import { createAssetsFromPurchase } from "../services/assets/purchase-integration.js";
```
Depois de confirmar/gravar os itens:
```js
await createAssetsFromPurchase(client, {
  companyId,
  branchId,
  userId: req.session.user.id,
  movement: {
    id: movement.id,
    movement_type_code: movement.movement_type_code,
    movement_date: movement.movement_date,
    in_service_date: movement.in_service_date,
    supplier_id: movement.supplier_id,
    invoice_number: movement.invoice_number,
    invoice_key: movement.invoice_key,
    cost_center_id: movement.cost_center_id,
  },
  items: movementItems.map((item) => ({
    id: item.id,
    product_id: item.product_id,
    description: item.description,
    quantity: item.quantity,
    total_value: item.total_value,
  })),
});
```
Cadastre a regra em `/assets/purchase-rules`, por exemplo `COMPRA_PATRIMONIO`.

## Rotas
- `/assets`
- `/assets/new`
- `/assets/:id`
- `/assets/categories`
- `/assets/responsibles`
- `/assets/purchase-rules`
- `/assets/depreciation`
- `/assets/reports/position`

## Modelo de depreciação
- Linear por meses, padrão.
- Unidades produzidas, preparado para apontamento de unidades.
- Não depreciável.

O processamento mensal agrupa por conta de despesa, conta de depreciação acumulada e centro de custo, gerando lançamento automático no módulo contábil.
