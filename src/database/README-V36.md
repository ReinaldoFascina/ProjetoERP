# Migração v36 - Confirmação de movimentos

## Arquivos

- `v36-movement-confirmation.sql`: migração PostgreSQL idempotente.
- `migrate-v36-movement-confirmation.js`: executor Node.js.

## Instalação no projeto

Copie o SQL para:

```text
src/database/sql/v36-movement-confirmation.sql
```

Copie o executor para:

```text
src/database/migrate-v36-movement-confirmation.js
```

Execute:

```powershell
node .\src\database\migrate-v36-movement-confirmation.js
```

## Estruturas abrangidas

- Parâmetros por tipo de movimento, empresa e filial.
- Tributos parametrizados no cabeçalho e nos itens.
- Campos de integração em `movement_types`.
- Campos de processamento em `billing_movements`.
- Campos validados em `billing_movement_items`.
- Tributos efetivos do cabeçalho e dos itens.
- Fila idempotente de processamento.
- Histórico de mudança de status.
- Índices de desempenho e unicidade lógica.
- Atualização automática de `updated_at`.

## Observação de compatibilidade

A migração usa `BIGINT` nos relacionamentos sem criar chaves estrangeiras novas. Isso evita conflito quando o projeto existente utiliza tabelas ou tipos de identificadores diferentes. Depois de conferir os tipos reais do banco, as FKs podem ser adicionadas em uma migração específica.
