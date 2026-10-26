import { db } from "./db.js";

const APPLICATION_LEVEL_ITEM = "ITEM";
const APPLICATION_LEVEL_MOVEMENT = "MOVIMENTO";

const MOVEMENT_STATUS_DRAFT = "RASCUNHO";
const MOVEMENT_STATUS_OPEN = "ABERTO";
const MOVEMENT_STATUS_CONFIRMED = "CONFIRMADO";

const PROCESS_STATUS_PENDING = "PENDENTE";
const PROCESS_STATUS_NO_EFFECT = "SEM_EFEITO";

const PROCESS_STOCK = "PROCESSAR_ESTOQUE";
const PROCESS_FINANCIAL = "GERAR_FINANCEIRO";
const PROCESS_FISCAL_POSTING = "GERAR_ESCRITURACAO";
const PROCESS_NFE = "PREPARAR_NFE";
const PROCESS_NFSE = "PREPARAR_NFSE";

function toPositiveInteger(value, fieldName) {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${fieldName} inválido.`);
  }

  return parsedValue;
}

function toBoolean(value) {
  return value === true;
}

function pushRequiredFieldError(errors, condition, message) {
  if (condition) {
    errors.push(message);
  }
}

/**
 * Carrega a parametrização completa de um tipo de movimento do módulo ES.
 *
 * @param {number} typeId
 * @param {number} companyId
 * @param {number} branchId
 * @returns {Promise<{type: object, taxes: object[]} | null>}
 */
export async function loadTypeContext(typeId, companyId, branchId) {
  const normalizedTypeId = toPositiveInteger(typeId, "Tipo de movimento");
  const normalizedCompanyId = toPositiveInteger(companyId, "Empresa");
  const normalizedBranchId = toPositiveInteger(branchId, "Filial");

  const [typeResult, taxesResult] = await Promise.all([
    db.query(
      `
        SELECT
          mt.*,

          mtp.fiscal_nature_id,
          mtp.default_warehouse_id,
          COALESCE(mtp.updates_stock, FALSE) AS updates_stock,
          mtp.stock_moment,
          COALESCE(mtp.generates_nfe, FALSE) AS generates_nfe,
          mtp.nfe_send_mode,
          mtp.environment,

          fn.code AS nature_code,
          fn.name AS nature_name,
          fn.stock_effect,
          fn.financial_effect

        FROM movement_types mt

        LEFT JOIN movement_type_parameters mtp
          ON mtp.movement_type_id = mt.id
         AND mtp.company_id = $2
         AND mtp.branch_id = $3

        LEFT JOIN fiscal_natures fn
          ON fn.id = mtp.fiscal_nature_id
         AND fn.company_id = $2
         AND (
           fn.branch_id = $3
           OR fn.branch_id IS NULL
         )

        WHERE mt.id = $1
          AND mt.company_id = $2
          AND (
            mt.branch_id = $3
            OR mt.branch_id IS NULL
          )
          AND mt.module_context = 'ES'
          AND mt.active = TRUE

        LIMIT 1
      `,
      [
        normalizedTypeId,
        normalizedCompanyId,
        normalizedBranchId,
      ]
    ),

    db.query(
      `
        SELECT
          mtt.*,
          ft.code AS tax_code,
          ft.name AS tax_name

        FROM movement_type_taxes mtt

        INNER JOIN fiscal_taxes ft
          ON ft.id = mtt.tax_id
         AND ft.company_id = mtt.company_id

        WHERE mtt.movement_type_id = $1
          AND mtt.company_id = $2
          AND mtt.branch_id = $3
          AND mtt.active = TRUE

        ORDER BY
          mtt.application_level,
          mtt.calculation_order,
          mtt.id
      `,
      [
        normalizedTypeId,
        normalizedCompanyId,
        normalizedBranchId,
      ]
    ),
  ]);

  const type = typeResult.rows[0];

  if (!type) {
    return null;
  }

  return {
    type,
    taxes: taxesResult.rows,
  };
}

/**
 * Aplica os tributos parametrizados pelo tipo de movimento.
 *
 * A função evita duplicidade por meio de INSERT ... SELECT ... WHERE NOT EXISTS,
 * sem depender de uma restrição UNIQUE específica no banco.
 *
 * @param {import("pg").PoolClient} client
 * @param {object} params
 * @param {number} params.movementId
 * @param {number|null} [params.itemId]
 * @param {number} params.typeId
 * @param {number} params.companyId
 * @param {number} params.branchId
 * @returns {Promise<number>}
 */
export async function applyTypeTaxes(
  client,
  {
    movementId,
    itemId = null,
    typeId,
    companyId,
    branchId,
  }
) {
  if (!client || typeof client.query !== "function") {
    throw new Error("Cliente de banco de dados inválido.");
  }

  const normalizedMovementId = toPositiveInteger(
    movementId,
    "Movimento"
  );
  const normalizedTypeId = toPositiveInteger(
    typeId,
    "Tipo de movimento"
  );
  const normalizedCompanyId = toPositiveInteger(companyId, "Empresa");
  const normalizedBranchId = toPositiveInteger(branchId, "Filial");
  const normalizedItemId =
    itemId === null || itemId === undefined || itemId === ""
      ? null
      : toPositiveInteger(itemId, "Item do movimento");

  const applicationLevel = normalizedItemId
    ? APPLICATION_LEVEL_ITEM
    : APPLICATION_LEVEL_MOVEMENT;

  const taxRulesResult = await client.query(
    `
      SELECT
        mtt.*,
        ft.code AS tax_code,
        ft.name AS tax_name

      FROM movement_type_taxes mtt

      INNER JOIN fiscal_taxes ft
        ON ft.id = mtt.tax_id
       AND ft.company_id = mtt.company_id

      WHERE mtt.movement_type_id = $1
        AND mtt.company_id = $2
        AND mtt.branch_id = $3
        AND mtt.active = TRUE
        AND mtt.application_level = $4

      ORDER BY
        mtt.calculation_order,
        mtt.id
    `,
    [
      normalizedTypeId,
      normalizedCompanyId,
      normalizedBranchId,
      applicationLevel,
    ]
  );

  let insertedCount = 0;

  for (const taxRule of taxRulesResult.rows) {
    let insertResult;

    if (normalizedItemId) {
      insertResult = await client.query(
        `
          INSERT INTO movement_item_taxes (
            company_id,
            branch_id,
            movement_id,
            movement_item_id,
            movement_type_tax_id,
            tax_id,
            rate,
            cst,
            csosn,
            tax_classification,
            nature_of_income
          )

          SELECT
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11

          WHERE NOT EXISTS (
            SELECT 1
            FROM movement_item_taxes existing_tax
            WHERE existing_tax.company_id = $1
              AND existing_tax.branch_id = $2
              AND existing_tax.movement_id = $3
              AND existing_tax.movement_item_id = $4
              AND existing_tax.movement_type_tax_id = $5
              AND existing_tax.tax_id = $6
          )
        `,
        [
          normalizedCompanyId,
          normalizedBranchId,
          normalizedMovementId,
          normalizedItemId,
          taxRule.id,
          taxRule.tax_id,
          taxRule.default_rate ?? 0,
          taxRule.default_cst ?? null,
          taxRule.default_csosn ?? null,
          taxRule.default_tax_classification ?? null,
          taxRule.nature_of_income ?? null,
        ]
      );
    } else {
      insertResult = await client.query(
        `
          INSERT INTO movement_header_taxes (
            company_id,
            branch_id,
            movement_id,
            movement_type_tax_id,
            tax_id,
            rate,
            cst,
            tax_classification,
            nature_of_income
          )

          SELECT
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9

          WHERE NOT EXISTS (
            SELECT 1
            FROM movement_header_taxes existing_tax
            WHERE existing_tax.company_id = $1
              AND existing_tax.branch_id = $2
              AND existing_tax.movement_id = $3
              AND existing_tax.movement_type_tax_id = $4
              AND existing_tax.tax_id = $5
          )
        `,
        [
          normalizedCompanyId,
          normalizedBranchId,
          normalizedMovementId,
          taxRule.id,
          taxRule.tax_id,
          taxRule.default_rate ?? 0,
          taxRule.default_cst ?? null,
          taxRule.default_tax_classification ?? null,
          taxRule.nature_of_income ?? null,
        ]
      );
    }

    insertedCount += insertResult.rowCount;
  }

  return insertedCount;
}

/**
 * Valida se o movimento está apto a ser confirmado.
 *
 * @param {import("pg").PoolClient} client
 * @param {object} movement
 * @param {number} companyId
 * @param {number} branchId
 * @returns {Promise<{errors: string[], warnings: string[], itemCount: number}>}
 */
export async function validateMovementForConfirmation(
  client,
  movement,
  companyId,
  branchId
) {
  const errors = [];
  const warnings = [];

  const itemsResult = await client.query(
    `
      SELECT
        item.id,
        item.catalog_item_id,
        item.quantity,
        item.unit_price,
        item.total_amount,
        item.warehouse_id

      FROM billing_movement_items item

      WHERE item.movement_id = $1
        AND item.company_id = $2
        AND item.branch_id = $3

      ORDER BY item.id
    `,
    [
      movement.id,
      companyId,
      branchId,
    ]
  );

  pushRequiredFieldError(
    errors,
    itemsResult.rowCount === 0,
    "Inclua ao menos um item."
  );

  for (const item of itemsResult.rows) {
    pushRequiredFieldError(
      errors,
      !item.catalog_item_id,
      `O item ${item.id} não possui produto ou serviço.`
    );

    pushRequiredFieldError(
      errors,
      Number(item.quantity || 0) <= 0,
      `O item ${item.id} possui quantidade inválida.`
    );

    pushRequiredFieldError(
      errors,
      Number(item.unit_price || 0) < 0,
      `O item ${item.id} possui valor unitário inválido.`
    );

    if (
      toBoolean(movement.updates_stock) &&
      movement.stock_moment === "CONFIRMACAO" &&
      !item.warehouse_id &&
      !movement.default_warehouse_id
    ) {
      errors.push(
        `O item ${item.id} não possui local de estoque e o tipo de movimento não define um local padrão.`
      );
    }
  }

  if (toBoolean(movement.updates_stock)) {
    pushRequiredFieldError(
      errors,
      !movement.stock_moment,
      "O tipo de movimento atualiza estoque, mas o momento de atualização não foi configurado."
    );
  }

  if (
    toBoolean(movement.creates_fiscal_posting) ||
    toBoolean(movement.creates_nfe) ||
    toBoolean(movement.creates_nfse)
  ) {
    pushRequiredFieldError(
      errors,
      !movement.fiscal_nature_id,
      "Informe a natureza fiscal do tipo de movimento."
    );
  }

  if (toBoolean(movement.creates_financial)) {
    pushRequiredFieldError(
      errors,
      !movement.partner_id,
      "O movimento gera financeiro, mas não possui cliente ou fornecedor."
    );

    pushRequiredFieldError(
      errors,
      !movement.payment_condition_id,
      "O movimento gera financeiro, mas não possui condição de pagamento."
    );
  }

  if (toBoolean(movement.creates_nfe)) {
    pushRequiredFieldError(
      errors,
      !movement.partner_id,
      "O movimento gera NF-e, mas não possui destinatário."
    );
  }

  if (toBoolean(movement.creates_nfse)) {
    pushRequiredFieldError(
      errors,
      !movement.partner_id,
      "O movimento gera NFS-e, mas não possui tomador."
    );
  }

  if (Number(movement.total_amount || 0) < 0) {
    errors.push("O valor total do movimento não pode ser negativo.");
  }

  if (Number(movement.total_amount || 0) === 0) {
    warnings.push("O movimento possui valor total igual a zero.");
  }

  return {
    errors,
    warnings,
    itemCount: itemsResult.rowCount,
  };
}

async function enqueueMovementProcess(
  client,
  {
    companyId,
    branchId,
    movementId,
    processCode,
    userId,
  }
) {
  const result = await client.query(
    `
      INSERT INTO movement_process_queue (
        company_id,
        branch_id,
        movement_id,
        process_code,
        payload
      )

      SELECT
        $1,
        $2,
        $3,
        $4,
        $5::jsonb

      WHERE NOT EXISTS (
        SELECT 1
        FROM movement_process_queue queued_process
        WHERE queued_process.company_id = $1
          AND queued_process.branch_id = $2
          AND queued_process.movement_id = $3
          AND queued_process.process_code = $4
          AND COALESCE(
            queued_process.status,
            'PENDENTE'
          ) IN (
            'PENDENTE',
            'PROCESSANDO'
          )
      )
    `,
    [
      companyId,
      branchId,
      movementId,
      processCode,
      JSON.stringify({ userId }),
    ]
  );

  return result.rowCount > 0;
}

/**
 * Confirma um movimento e enfileira os processos decorrentes.
 *
 * @param {object} params
 * @param {number} params.movementId
 * @param {number} params.companyId
 * @param {number} params.branchId
 * @param {number} params.userId
 * @returns {Promise<{movementId: number, status: string, queue: string[], warnings: string[]}>}
 */
export async function confirmMovement({
  movementId,
  companyId,
  branchId,
  userId,
}) {
  const normalizedMovementId = toPositiveInteger(
    movementId,
    "Movimento"
  );
  const normalizedCompanyId = toPositiveInteger(companyId, "Empresa");
  const normalizedBranchId = toPositiveInteger(branchId, "Filial");
  const normalizedUserId = toPositiveInteger(userId, "Usuário");

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const movementResult = await client.query(
      `
        SELECT
          movement.*,

          movement_type.status_initial,
          COALESCE(
            movement_type.creates_financial,
            FALSE
          ) AS creates_financial,
          COALESCE(
            movement_type.creates_fiscal_posting,
            FALSE
          ) AS creates_fiscal_posting,
          COALESCE(
            movement_type.creates_nfe,
            movement_parameters.generates_nfe,
            FALSE
          ) AS creates_nfe,
          COALESCE(
            movement_type.creates_nfse,
            FALSE
          ) AS creates_nfse,

          movement_parameters.fiscal_nature_id,
          movement_parameters.default_warehouse_id,
          COALESCE(
            movement_parameters.updates_stock,
            FALSE
          ) AS updates_stock,
          movement_parameters.stock_moment

        FROM billing_movements movement

        INNER JOIN movement_types movement_type
          ON movement_type.id = movement.movement_type_id
         AND movement_type.company_id = movement.company_id
         AND (
           movement_type.branch_id = movement.branch_id
           OR movement_type.branch_id IS NULL
         )
         AND movement_type.active = TRUE

        LEFT JOIN movement_type_parameters movement_parameters
          ON movement_parameters.movement_type_id = movement_type.id
         AND movement_parameters.company_id = movement.company_id
         AND movement_parameters.branch_id = movement.branch_id

        WHERE movement.id = $1
          AND movement.company_id = $2
          AND movement.branch_id = $3

        FOR UPDATE OF movement
      `,
      [
        normalizedMovementId,
        normalizedCompanyId,
        normalizedBranchId,
      ]
    );

    const movement = movementResult.rows[0];

    if (!movement) {
      throw new Error("Movimento não encontrado.");
    }

    if (
      movement.status !== MOVEMENT_STATUS_DRAFT &&
      movement.status !== MOVEMENT_STATUS_OPEN
    ) {
      throw new Error(
        "Somente movimentos em rascunho ou abertos podem ser confirmados."
      );
    }

    const validation = await validateMovementForConfirmation(
      client,
      movement,
      normalizedCompanyId,
      normalizedBranchId
    );

    if (validation.errors.length > 0) {
      throw new Error(
        `O movimento não pode ser confirmado: ${validation.errors.join(" ")}`
      );
    }

    await applyTypeTaxes(client, {
      movementId: normalizedMovementId,
      typeId: movement.movement_type_id,
      companyId: normalizedCompanyId,
      branchId: normalizedBranchId,
    });

    const itemIdsResult = await client.query(
      `
        SELECT id
        FROM billing_movement_items
        WHERE movement_id = $1
          AND company_id = $2
          AND branch_id = $3
        ORDER BY id
      `,
      [
        normalizedMovementId,
        normalizedCompanyId,
        normalizedBranchId,
      ]
    );

    for (const item of itemIdsResult.rows) {
      await applyTypeTaxes(client, {
        movementId: normalizedMovementId,
        itemId: item.id,
        typeId: movement.movement_type_id,
        companyId: normalizedCompanyId,
        branchId: normalizedBranchId,
      });
    }

    const updatesStockOnConfirmation =
      toBoolean(movement.updates_stock) &&
      movement.stock_moment === "CONFIRMACAO";

    await client.query(
      `
        UPDATE billing_movements
        SET
          status = $1,
          stock_status = $2,
          financial_status = $3,
          posting_status = $4,
          updated_at = NOW()
        WHERE id = $5
          AND company_id = $6
          AND branch_id = $7
      `,
      [
        MOVEMENT_STATUS_CONFIRMED,
        updatesStockOnConfirmation
          ? PROCESS_STATUS_PENDING
          : PROCESS_STATUS_NO_EFFECT,
        toBoolean(movement.creates_financial)
          ? PROCESS_STATUS_PENDING
          : PROCESS_STATUS_NO_EFFECT,
        toBoolean(movement.creates_fiscal_posting)
          ? PROCESS_STATUS_PENDING
          : PROCESS_STATUS_NO_EFFECT,
        normalizedMovementId,
        normalizedCompanyId,
        normalizedBranchId,
      ]
    );

    const requestedProcesses = [];

    if (updatesStockOnConfirmation) {
      requestedProcesses.push(PROCESS_STOCK);
    }

    if (toBoolean(movement.creates_financial)) {
      requestedProcesses.push(PROCESS_FINANCIAL);
    }

    if (toBoolean(movement.creates_fiscal_posting)) {
      requestedProcesses.push(PROCESS_FISCAL_POSTING);
    }

    if (toBoolean(movement.creates_nfe)) {
      requestedProcesses.push(PROCESS_NFE);
    }

    if (toBoolean(movement.creates_nfse)) {
      requestedProcesses.push(PROCESS_NFSE);
    }

    const queuedProcesses = [];

    for (const processCode of requestedProcesses) {
      const inserted = await enqueueMovementProcess(client, {
        companyId: normalizedCompanyId,
        branchId: normalizedBranchId,
        movementId: normalizedMovementId,
        processCode,
        userId: normalizedUserId,
      });

      if (inserted) {
        queuedProcesses.push(processCode);
      }
    }

    const historyMessageParts = [
      "Movimento confirmado.",
    ];

    if (queuedProcesses.length > 0) {
      historyMessageParts.push(
        `Processos enfileirados: ${queuedProcesses.join(", ")}.`
      );
    } else {
      historyMessageParts.push(
        "Nenhum novo processo precisou ser enfileirado."
      );
    }

    if (validation.warnings.length > 0) {
      historyMessageParts.push(
        `Avisos: ${validation.warnings.join(" ")}`
      );
    }

    await client.query(
      `
        INSERT INTO movement_status_history (
          company_id,
          branch_id,
          movement_id,
          previous_status,
          new_status,
          operation,
          message,
          user_id
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          'CONFIRMACAO',
          $6,
          $7
        )
      `,
      [
        normalizedCompanyId,
        normalizedBranchId,
        normalizedMovementId,
        movement.status,
        MOVEMENT_STATUS_CONFIRMED,
        historyMessageParts.join(" "),
        normalizedUserId,
      ]
    );

    await client.query("COMMIT");

    return {
      movementId: normalizedMovementId,
      status: MOVEMENT_STATUS_CONFIRMED,
      queue: queuedProcesses,
      warnings: validation.warnings,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
