# RESistemas v32 - Gestão de Empreendimentos

## Inclui
- Cadastro de loteamentos, condomínios e empreendimentos.
- Cadastro de unidades/lotes, disponibilidade e preços.
- Cotações com validade, entrada, parcelas, juros e índice de correção.
- Conversão transacional da cotação em venda.
- Geração automática de parcelas.
- Recebimentos parciais ou totais e controle de inadimplência.

## Instalação
```js
import { realEstateRouter } from "./routes/real-estate.js";
app.use(realEstateRouter);
```
Execute:
```powershell
node src\database\migrate-v32-real-estate.js
```
No `modules.js`, use `home: "/real-estate"` no módulo `empr`.
No `module-context.js`, associe `/real-estate` ao módulo `empr`.

## Rotas
- `/real-estate`
- `/real-estate/developments`
- `/real-estate/units`
- `/real-estate/quotes`
- `/real-estate/sales`
- `/real-estate/receivables`

## Integração financeira
As parcelas possuem `financial_title_id`. Na confirmação da venda, a geração pode ser conectada ao serviço de títulos do módulo Financeiro. Os pagamentos também podem gerar baixa e movimento de caixa usando `payment_method_id` e `cash_account_id`.
