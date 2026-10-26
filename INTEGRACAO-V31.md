# RESistemas v31 - Controle de Manutenção

## Integrações
- Máquinas existentes: `production_machines`.
- Patrimônio existente: `assets`.
- Peças e materiais: `catalog_items`.
- Centros de custo: `accounting_cost_centers`.
- Responsáveis: `asset_responsibles`.
- Fornecedores/oficinas: `clients`.

## Instalação
```js
import { maintenanceRouter } from "./routes/maintenance.js";
app.use(maintenanceRouter);
```
Execute:
```powershell
node src\database\migrate-v31-maintenance.js
```
No `module-context.js`, associe `/maintenance` ao módulo `manutencao`.
No `modules.js`, use `home: "/maintenance"`.

## Fluxo
1. Cadastrar tipos de serviço.
2. Vincular máquinas, patrimônios, imóveis, móveis, veículos ou equipamentos.
3. Criar planos preventivos por data, km, horímetro ou regra mista.
4. Abrir ordem corretiva ou preventiva.
5. Informar peças, pneus, amortecedores, terminais e outros materiais.
6. Informar posição, número de série removido e instalado.
7. Apontar mão de obra interna e serviço externo.
8. Concluir e consolidar custos por bem e centro de custo.

## Estoque
A tabela `maintenance_order_parts` possui `stock_transaction_id`. Integre a conclusão da ordem ao serviço de baixa de estoque da versão 25/27, usando um tipo de movimento `SAIDA_MANUTENCAO`.
