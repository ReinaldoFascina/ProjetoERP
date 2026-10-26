# RESistemas v34 - DUIMP, Obrigações e Catálogo por Importador

## Instalação
```js
import { comexDuimpRouter } from "./routes/comex-duimp.js";
app.use(comexDuimpRouter);
```
Execute:
```powershell
node src\database\migrate-v34-duimp-catalog.js
```

## Segurança do envio
O módulo inicia em modo de simulação. Para transmissão real:
```env
SISCOMEX_LIVE_SUBMISSION=true
SISCOMEX_CERT_PATH=C:\certificados\empresa-cert.pem
SISCOMEX_KEY_PATH=C:\certificados\empresa-key.pem
SISCOMEX_CERT_PASSPHRASE=senha
SISCOMEX_DUIMP_REGISTER_PATH=/caminho/oficial/autorizado/para/registro
```
O caminho do serviço deve ser confirmado na documentação oficial e no perfil liberado ao certificado do importador. Não configure endpoint de consulta pública como endpoint de registro.

## Cadastros
1. Crie o perfil do importador a partir de `clients` em `/comex/importers`.
2. Cadastre operadores estrangeiros em `/comex/operators`.
3. Vincule `catalog_items` ao catálogo específico do importador em `/comex/catalog`.
4. Cadastre os atributos aplicáveis à NCM.
5. Crie a DUIMP em `/comex/duimp` e conclua as obrigações.
6. Execute primeiro no ambiente de validação.

## Obrigações controladas
- Catálogo do produto ativo.
- Operador estrangeiro ativo.
- Tratamentos administrativos e LPCO.
- Documentos instrutivos.
- Dados de carga e transporte.
- Dados aduaneiros.
- PCCE, tributos e pagamentos.
- Local da operação de consumo.
- Outros tributos e direitos por item.
