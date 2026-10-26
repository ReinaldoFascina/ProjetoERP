import { Router } from "express";

import { db } from "../database/db.js";
import { requireAuth, allow } from "../middleware/auth.js";
import { buildEcdFile } from "../services/accounting/sped-ecd.js";

export const accountingRouter = Router();

const accountingGuard = [
  requireAuth,
  allow("ADMIN", "COORDENADOR"),
];

const VALID_ACCOUNT_TYPES = new Set([
  "ATIVO",
  "PASSIVO",
  "PATRIMONIO_LIQUIDO",
  "RECEITA",
  "DESPESA",
  "COMPENSACAO",
]);

const VALID_ACCOUNT_NATURES = new Set([
  "DEVEDORA",
  "CREDORA",
]);

const VALID_BOOK_TYPES = new Set([
  "G",
  "R",
  "A",
  "Z",
  "B",
]);

const BALANCE_TOLERANCE = 0.005;

const asyncRoute = (handler) =>
  (req, res, next) =>
    Promise.resolve(
      handler(req, res, next)
    ).catch(next);

function getContext(req) {
  const companyId = Number(req.session?.companyId);
  const branchId = Number(req.session?.branchId);
  const userId = Number(req.session?.user?.id);

  if (
    !Number.isInteger(companyId) ||
    companyId <= 0 ||
    !Number.isInteger(branchId) ||
    branchId <= 0 ||
    !Number.isInteger(userId) ||
    userId <= 0
  ) {
    const error = new Error(
      "Empresa, filial ou usuário não foram definidos na sessão."
    );

    error.status = 400;
    throw error;
  }

  return {
    companyId,
    branchId,
    userId,
  };
}

function parsePositiveInteger(value, fieldName) {
  const parsedValue = Number(value);

  if (
    !Number.isInteger(parsedValue) ||
    parsedValue <= 0
  ) {
    const error = new Error(
      `${fieldName} inválido.`
    );

    error.status = 400;
    throw error;
  }

  return parsedValue;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function optionalText(value) {
  const normalizedValue = normalizeText(value);
  return normalizedValue || null;
}

function checkboxValue(value) {
  return [
    "on",
    "true",
    "1",
    "yes",
  ].includes(
    String(value ?? "").toLowerCase()
  );
}

function moneyValue(value, fieldName) {
  const parsedValue = Number(value ?? 0);

  if (
    !Number.isFinite(parsedValue) ||
    parsedValue < 0
  ) {
    const error = new Error(
      `${fieldName} deve ser um valor igual ou maior que zero.`
    );

    error.status = 400;
    throw error;
  }

  return Number(parsedValue.toFixed(2));
}

function parseEntryLines(rawLines) {
  let lines;

  try {
    lines = typeof rawLines === "string"
      ? JSON.parse(rawLines)
      : rawLines;
  } catch {
    const error = new Error(
      "O conteúdo das partidas não é um JSON válido."
    );

    error.status = 400;
    throw error;
  }

  if (
    !Array.isArray(lines) ||
    lines.length < 2
  ) {
    const error = new Error(
      "Informe ao menos duas partidas contábeis."
    );

    error.status = 400;
    throw error;
  }

  return lines.map(
    (line, index) => {
      const accountId = parsePositiveInteger(
        line.account_id,
        `Conta da partida ${index + 1}`
      );

      const costCenterId = line.cost_center_id
        ? parsePositiveInteger(
            line.cost_center_id,
            `Centro de custo da partida ${index + 1}`
          )
        : null;

      const participantId = line.participant_id
        ? parsePositiveInteger(
            line.participant_id,
            `Participante da partida ${index + 1}`
          )
        : null;

      const debit = moneyValue(
        line.debit,
        `Débito da partida ${index + 1}`
      );

      const credit = moneyValue(
        line.credit,
        `Crédito da partida ${index + 1}`
      );

      if (
        (debit > 0 && credit > 0) ||
        (debit === 0 && credit === 0)
      ) {
        const error = new Error(
          `A partida ${index + 1} deve possuir somente débito ou somente crédito.`
        );

        error.status = 400;
        throw error;
      }

      return {
        accountId,
        costCenterId,
        participantId,
        debit,
        credit,
        history: optionalText(line.history),
        documentNumber: optionalText(
          line.document_number
        ),
      };
    }
  );
}

function calculateEntryTotals(lines) {
  const debit = Number(
    lines.reduce(
      (total, line) => total + line.debit,
      0
    ).toFixed(2)
  );

  const credit = Number(
    lines.reduce(
      (total, line) => total + line.credit,
      0
    ).toFixed(2)
  );

  const difference = Number(
    (debit - credit).toFixed(2)
  );

  return {
    debit,
    credit,
    difference,
    balanced:
      Math.abs(difference) <= BALANCE_TOLERANCE,
  };
}

async function validateEntryReferences(
  client,
  context,
  bookId,
  lines
) {
  const {
    companyId,
    branchId,
  } = context;

  const bookResult = await client.query(
    `
      SELECT
        id,
        code,
        name,
        status,
        period_start,
        period_end
      FROM accounting_books
      WHERE id = $1
        AND company_id = $2
        AND branch_id = $3
      FOR UPDATE
    `,
    [
      bookId,
      companyId,
      branchId,
    ]
  );

  const book = bookResult.rows[0];

  if (!book) {
    const error = new Error(
      "Livro contábil não encontrado."
    );

    error.status = 404;
    throw error;
  }

  if (book.status !== "ABERTO") {
    const error = new Error(
      `O livro ${book.code} não está aberto para lançamentos.`
    );

    error.status = 409;
    throw error;
  }

  const accountIds = [
    ...new Set(
      lines.map((line) => line.accountId)
    ),
  ];

  const accountsResult = await client.query(
    `
      SELECT
        id,
        code,
        name,
        analytical,
        accepts_cost_center
      FROM accounting_accounts
      WHERE company_id = $1
        AND branch_id = $2
        AND active = TRUE
        AND id = ANY($3::bigint[])
    `,
    [
      companyId,
      branchId,
      accountIds,
    ]
  );

  if (
    accountsResult.rowCount !==
    accountIds.length
  ) {
    const foundIds = new Set(
      accountsResult.rows.map(
        (account) => Number(account.id)
      )
    );

    const missingIds = accountIds.filter(
      (id) => !foundIds.has(id)
    );

    const error = new Error(
      `Contas contábeis inválidas ou inativas: ${missingIds.join(", ")}.`
    );

    error.status = 400;
    throw error;
  }

  const accountsById = new Map(
    accountsResult.rows.map(
      (account) => [
        Number(account.id),
        account,
      ]
    )
  );

  for (const line of lines) {
    const account = accountsById.get(
      line.accountId
    );

    if (!account.analytical) {
      const error = new Error(
        `A conta ${account.code} é sintética e não aceita lançamentos.`
      );

      error.status = 400;
      throw error;
    }

    if (
      account.accepts_cost_center &&
      !line.costCenterId
    ) {
      const error = new Error(
        `A conta ${account.code} exige centro de custo.`
      );

      error.status = 400;
      throw error;
    }
  }

  const costCenterIds = [
    ...new Set(
      lines
        .map((line) => line.costCenterId)
        .filter(Boolean)
    ),
  ];

  if (costCenterIds.length) {
    const costCentersResult = await client.query(
      `
        SELECT id
        FROM accounting_cost_centers
        WHERE company_id = $1
          AND branch_id = $2
          AND active = TRUE
          AND analytical = TRUE
          AND id = ANY($3::bigint[])
      `,
      [
        companyId,
        branchId,
        costCenterIds,
      ]
    );

    if (
      costCentersResult.rowCount !==
      costCenterIds.length
    ) {
      const error = new Error(
        "Um ou mais centros de custo são inválidos, inativos ou sintéticos."
      );

      error.status = 400;
      throw error;
    }
  }

  return book;
}

async function loadEntryDetails(
  entryId,
  context
) {
  const {
    companyId,
    branchId,
  } = context;

  const [
    entryResult,
    linesResult,
  ] = await Promise.all([
    db.query(
      `
        SELECT
          e.id,
          e.entry_number,
          e.entry_date,
          e.source_module,
          e.source_id,
          e.history,
          e.total_debit,
          e.total_credit,
          e.status,
          e.created_at,
          e.updated_at,
          e.posted_at,
          b.id AS book_id,
          b.code AS book_code,
          b.name AS book_name,
          b.book_type,
          b.book_number,
          b.period_start,
          b.period_end,
          b.status AS book_status,
          creator.name AS created_by_name,
          poster.name AS posted_by_name
        FROM accounting_entries e
        INNER JOIN accounting_books b
          ON b.id = e.book_id
         AND b.company_id = e.company_id
         AND b.branch_id = e.branch_id
        LEFT JOIN users creator
          ON creator.id = e.created_by
        LEFT JOIN users poster
          ON poster.id = e.posted_by
        WHERE e.id = $1
          AND e.company_id = $2
          AND e.branch_id = $3
        LIMIT 1
      `,
      [
        entryId,
        companyId,
        branchId,
      ]
    ),
    db.query(
      `
        SELECT
          line.id,
          line.sequence,
          line.debit,
          line.credit,
          line.history_complement,
          line.document_number,
          account.id AS account_id,
          account.code AS account_code,
          account.name AS account_name,
          account.account_type,
          account.nature AS account_nature,
          account.accepts_cost_center,
          reference_account.id AS reference_account_id,
          reference_account.code AS reference_account_code,
          reference_account.description AS reference_account_name,
          reference_account.institution AS reference_institution,
          reference_account.layout_code AS reference_layout,
          cost_center.id AS cost_center_id,
          cost_center.code AS cost_center_code,
          cost_center.name AS cost_center_name,
          participant.id AS participant_id,
          participant.corporate_name AS participant_name,
          participant.document AS participant_document
        FROM accounting_entry_lines line
        INNER JOIN accounting_accounts account
          ON account.id = line.account_id
         AND account.company_id = line.company_id
         AND account.branch_id = line.branch_id
        LEFT JOIN accounting_reference_accounts reference_account
          ON reference_account.id = account.reference_account_id
         AND reference_account.company_id = line.company_id
         AND reference_account.branch_id = line.branch_id
        LEFT JOIN accounting_cost_centers cost_center
          ON cost_center.id = line.cost_center_id
         AND cost_center.company_id = line.company_id
         AND cost_center.branch_id = line.branch_id
        LEFT JOIN clients participant
          ON participant.id = line.participant_id
         AND participant.company_id = line.company_id
         AND participant.branch_id = line.branch_id
        WHERE line.entry_id = $1
          AND line.company_id = $2
          AND line.branch_id = $3
        ORDER BY
          line.sequence,
          line.id
      `,
      [
        entryId,
        companyId,
        branchId,
      ]
    ),
  ]);

  const entry = entryResult.rows[0];

  if (!entry) {
    return null;
  }

  const lines = linesResult.rows;
  const totals = calculateEntryTotals(
    lines.map((line) => ({
      debit: Number(line.debit || 0),
      credit: Number(line.credit || 0),
    }))
  );

  return {
    entry,
    lines,
    totals,
  };
}

// Dashboard contábil.
accountingRouter.get(
  "/accounting",
  ...accountingGuard,
  asyncRoute(async (req, res) => {
    const {
      companyId,
      branchId,
    } = getContext(req);

    const [
      accountsResult,
      costCentersResult,
      booksResult,
      entriesResult,
    ] = await Promise.all([
      db.query(
        `
          SELECT COUNT(*)::integer AS total
          FROM accounting_accounts
          WHERE company_id = $1
            AND branch_id = $2
            AND active = TRUE
        `,
        [companyId, branchId]
      ),
      db.query(
        `
          SELECT COUNT(*)::integer AS total
          FROM accounting_cost_centers
          WHERE company_id = $1
            AND branch_id = $2
            AND active = TRUE
        `,
        [companyId, branchId]
      ),
      db.query(
        `
          SELECT COUNT(*)::integer AS total
          FROM accounting_books
          WHERE company_id = $1
            AND branch_id = $2
        `,
        [companyId, branchId]
      ),
      db.query(
        `
          SELECT
            COUNT(*)::integer AS total,
            COALESCE(SUM(total_debit), 0) AS debit
          FROM accounting_entries
          WHERE company_id = $1
            AND branch_id = $2
            AND status = 'LANCADO'
        `,
        [companyId, branchId]
      ),
    ]);

    return res.render(
      "accounting/dashboard",
      {
        pageTitle: "Gestão Contábil",
        summary: {
          accounts:
            accountsResult.rows[0].total,
          costCenters:
            costCentersResult.rows[0].total,
          books:
            booksResult.rows[0].total,
          entries:
            entriesResult.rows[0].total,
          debit:
            entriesResult.rows[0].debit,
        },
      }
    );
  })
);

// Plano de contas.
accountingRouter.get(
  "/accounting/accounts",
  ...accountingGuard,
  asyncRoute(async (req, res) => {
    const {
      companyId,
      branchId,
    } = getContext(req);

    const [
      accountsResult,
      referencesResult,
    ] = await Promise.all([
      db.query(
        `
          SELECT
            account.*,
            reference.code AS reference_code,
            reference.description AS reference_name
          FROM accounting_accounts account
          LEFT JOIN accounting_reference_accounts reference
            ON reference.id = account.reference_account_id
           AND reference.company_id = account.company_id
           AND reference.branch_id = account.branch_id
          WHERE account.company_id = $1
            AND account.branch_id = $2
          ORDER BY account.code
        `,
        [companyId, branchId]
      ),
      db.query(
        `
          SELECT
            id,
            code,
            description
          FROM accounting_reference_accounts
          WHERE company_id = $1
            AND branch_id = $2
            AND active = TRUE
          ORDER BY code
        `,
        [companyId, branchId]
      ),
    ]);

    return res.render(
      "accounting/accounts",
      {
        pageTitle: "Plano de contas",
        accounts: accountsResult.rows,
        references:
          referencesResult.rows,
      }
    );
  })
);

accountingRouter.post(
  "/accounting/accounts",
  ...accountingGuard,
  asyncRoute(async (req, res) => {
    const {
      companyId,
      branchId,
    } = getContext(req);

    const code = normalizeText(
      req.body.code
    );

    const name = normalizeText(
      req.body.name
    );

    const accountType = normalizeText(
      req.body.account_type
    ).toUpperCase();

    const nature = normalizeText(
      req.body.nature
    ).toUpperCase();

    const referenceAccountId =
      req.body.reference_account_id
        ? parsePositiveInteger(
            req.body.reference_account_id,
            "Conta referencial"
          )
        : null;

    if (!code || !name) {
      const error = new Error(
        "Informe o código e a descrição da conta."
      );

      error.status = 400;
      throw error;
    }

    if (!VALID_ACCOUNT_TYPES.has(accountType)) {
      const error = new Error(
        "Tipo de conta contábil inválido."
      );

      error.status = 400;
      throw error;
    }

    if (!VALID_ACCOUNT_NATURES.has(nature)) {
      const error = new Error(
        "Natureza da conta contábil inválida."
      );

      error.status = 400;
      throw error;
    }

    await db.query(
      `
        INSERT INTO accounting_accounts (
          company_id,
          branch_id,
          code,
          name,
          account_type,
          nature,
          analytical,
          accepts_cost_center,
          reference_account_id,
          active
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, TRUE
        )
      `,
      [
        companyId,
        branchId,
        code,
        name,
        accountType,
        nature,
        checkboxValue(req.body.analytical),
        checkboxValue(
          req.body.accepts_cost_center
        ),
        referenceAccountId,
      ]
    );

    return res.redirect(
      "/accounting/accounts?message=" +
      encodeURIComponent(
        "Conta contábil cadastrada com sucesso."
      )
    );
  })
);

// Centros de custo.
accountingRouter.get(
  "/accounting/cost-centers",
  ...accountingGuard,
  asyncRoute(async (req, res) => {
    const {
      companyId,
      branchId,
    } = getContext(req);

    const result = await db.query(
      `
        SELECT *
        FROM accounting_cost_centers
        WHERE company_id = $1
          AND branch_id = $2
        ORDER BY code
      `,
      [companyId, branchId]
    );

    return res.render(
      "accounting/cost-centers",
      {
        pageTitle: "Centros de custo",
        costCenters: result.rows,
      }
    );
  })
);

accountingRouter.post(
  "/accounting/cost-centers",
  ...accountingGuard,
  asyncRoute(async (req, res) => {
    const {
      companyId,
      branchId,
    } = getContext(req);

    const code = normalizeText(
      req.body.code
    );

    const name = normalizeText(
      req.body.name
    );

    if (!code || !name) {
      const error = new Error(
        "Informe o código e a descrição do centro de custo."
      );

      error.status = 400;
      throw error;
    }

    await db.query(
      `
        INSERT INTO accounting_cost_centers (
          company_id,
          branch_id,
          code,
          name,
          analytical,
          active
        )
        VALUES ($1, $2, $3, $4, $5, TRUE)
      `,
      [
        companyId,
        branchId,
        code,
        name,
        checkboxValue(req.body.analytical),
      ]
    );

    return res.redirect(
      "/accounting/cost-centers?message=" +
      encodeURIComponent(
        "Centro de custo cadastrado com sucesso."
      )
    );
  })
);

// Contas referenciais.
accountingRouter.get(
  "/accounting/reference-accounts",
  ...accountingGuard,
  asyncRoute(async (req, res) => {
    const {
      companyId,
      branchId,
    } = getContext(req);

    const result = await db.query(
      `
        SELECT *
        FROM accounting_reference_accounts
        WHERE company_id = $1
          AND branch_id = $2
        ORDER BY code
      `,
      [companyId, branchId]
    );

    return res.render(
      "accounting/reference-accounts",
      {
        pageTitle: "Contas referenciais",
        references: result.rows,
      }
    );
  })
);

accountingRouter.post(
  "/accounting/reference-accounts",
  ...accountingGuard,
  asyncRoute(async (req, res) => {
    const {
      companyId,
      branchId,
    } = getContext(req);

    const code = normalizeText(
      req.body.code
    );

    const description = normalizeText(
      req.body.description
    );

    if (!code || !description) {
      const error = new Error(
        "Informe o código e a descrição da conta referencial."
      );

      error.status = 400;
      throw error;
    }

    await db.query(
      `
        INSERT INTO accounting_reference_accounts (
          company_id,
          branch_id,
          code,
          description,
          institution,
          layout_code,
          valid_from,
          valid_to,
          active
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, TRUE
        )
      `,
      [
        companyId,
        branchId,
        code,
        description,
        optionalText(
          req.body.institution
        ) || "RFB",
        optionalText(
          req.body.layout_code
        ) || "ECD_9",
        req.body.valid_from || null,
        req.body.valid_to || null,
      ]
    );

    return res.redirect(
      "/accounting/reference-accounts?message=" +
      encodeURIComponent(
        "Conta referencial cadastrada com sucesso."
      )
    );
  })
);

// Livros contábeis.
accountingRouter.get(
  "/accounting/books",
  ...accountingGuard,
  asyncRoute(async (req, res) => {
    const {
      companyId,
      branchId,
    } = getContext(req);

    const result = await db.query(
      `
        SELECT *
        FROM accounting_books
        WHERE company_id = $1
          AND branch_id = $2
        ORDER BY
          period_start DESC,
          book_number DESC
      `,
      [companyId, branchId]
    );

    return res.render(
      "accounting/books",
      {
        pageTitle: "Livros contábeis",
        books: result.rows,
      }
    );
  })
);

accountingRouter.post(
  "/accounting/books",
  ...accountingGuard,
  asyncRoute(async (req, res) => {
    const {
      companyId,
      branchId,
    } = getContext(req);

    const code = normalizeText(
      req.body.code
    );

    const name = normalizeText(
      req.body.name
    );

    const bookType = normalizeText(
      req.body.book_type
    ).toUpperCase();

    const bookNumber = Number(
      req.body.book_number || 1
    );

    if (!code || !name) {
      const error = new Error(
        "Informe o código e o nome do livro."
      );

      error.status = 400;
      throw error;
    }

    if (!VALID_BOOK_TYPES.has(bookType)) {
      const error = new Error(
        "Tipo de livro contábil inválido."
      );

      error.status = 400;
      throw error;
    }

    if (
      !Number.isInteger(bookNumber) ||
      bookNumber <= 0
    ) {
      const error = new Error(
        "Número do livro inválido."
      );

      error.status = 400;
      throw error;
    }

    if (
      !req.body.period_start ||
      !req.body.period_end
    ) {
      const error = new Error(
        "Informe o período do livro contábil."
      );

      error.status = 400;
      throw error;
    }

    if (
      req.body.period_start >
      req.body.period_end
    ) {
      const error = new Error(
        "A data inicial não pode ser posterior à data final."
      );

      error.status = 400;
      throw error;
    }

    await db.query(
      `
        INSERT INTO accounting_books (
          company_id,
          branch_id,
          code,
          name,
          book_type,
          book_number,
          period_start,
          period_end,
          sped_layout
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9
        )
      `,
      [
        companyId,
        branchId,
        code,
        name,
        bookType,
        bookNumber,
        req.body.period_start,
        req.body.period_end,
        optionalText(
          req.body.sped_layout
        ) || "ECD_9",
      ]
    );

    return res.redirect(
      "/accounting/books?message=" +
      encodeURIComponent(
        "Livro contábil aberto com sucesso."
      )
    );
  })
);

// Lista os lançamentos.
accountingRouter.get(
  "/accounting/entries",
  ...accountingGuard,
  asyncRoute(async (req, res) => {
    const {
      companyId,
      branchId,
    } = getContext(req);

    const [
      entriesResult,
      booksResult,
    ] = await Promise.all([
      db.query(
        `
          SELECT
            entry.*,
            book.code AS book_code,
            book.name AS book_name
          FROM accounting_entries entry
          INNER JOIN accounting_books book
            ON book.id = entry.book_id
           AND book.company_id = entry.company_id
           AND book.branch_id = entry.branch_id
          WHERE entry.company_id = $1
            AND entry.branch_id = $2
          ORDER BY
            entry.entry_date DESC,
            entry.id DESC
        `,
        [companyId, branchId]
      ),
      db.query(
        `
          SELECT
            id,
            code,
            name
          FROM accounting_books
          WHERE company_id = $1
            AND branch_id = $2
            AND status = 'ABERTO'
          ORDER BY code
        `,
        [companyId, branchId]
      ),
    ]);

    return res.render(
      "accounting/entries",
      {
        pageTitle:
          "Lançamentos contábeis",
        entries: entriesResult.rows,
        books: booksResult.rows,
      }
    );
  })
);

// Exibe os detalhes de um lançamento.
accountingRouter.get(
  "/accounting/entries/:id",
  ...accountingGuard,
  asyncRoute(async (req, res) => {
    const context = getContext(req);
    const entryId = parsePositiveInteger(
      req.params.id,
      "Identificador do lançamento"
    );

    const details = await loadEntryDetails(
      entryId,
      context
    );

    if (!details) {
      return res.status(404).render(
        "error",
        {
          message:
            "Lançamento contábil não encontrado para a empresa e filial selecionadas.",
        }
      );
    }

    return res.render(
      "accounting/entry-detail",
      {
        pageTitle:
          `Lançamento ${details.entry.entry_number}`,
        entry: details.entry,
        lines: details.lines,
        totals: details.totals,
      }
    );
  })
);

// Inclui um lançamento contábil balanceado.
accountingRouter.post(
  "/accounting/entries",
  ...accountingGuard,
  asyncRoute(async (req, res) => {
    const context = getContext(req);
    const {
      companyId,
      branchId,
      userId,
    } = context;

    const bookId = parsePositiveInteger(
      req.body.book_id,
      "Livro contábil"
    );

    const entryNumber = normalizeText(
      req.body.entry_number
    );

    const entryDate = normalizeText(
      req.body.entry_date
    );

    const history = normalizeText(
      req.body.history
    );

    if (
      !entryNumber ||
      !entryDate ||
      !history
    ) {
      const error = new Error(
        "Informe número, data e histórico do lançamento."
      );

      error.status = 400;
      throw error;
    }

    const lines = parseEntryLines(
      req.body.lines
    );

    const totals = calculateEntryTotals(
      lines
    );

    if (!totals.balanced) {
      const error = new Error(
        `Débitos e créditos não estão balanceados. Diferença: ${totals.difference.toFixed(2)}.`
      );

      error.status = 400;
      throw error;
    }

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const book = await validateEntryReferences(
        client,
        context,
        bookId,
        lines
      );

      if (
        entryDate < book.period_start ||
        entryDate > book.period_end
      ) {
        const error = new Error(
          "A data do lançamento está fora do período do livro contábil."
        );

        error.status = 400;
        throw error;
      }

      const entryResult = await client.query(
        `
          INSERT INTO accounting_entries (
            company_id,
            branch_id,
            book_id,
            entry_number,
            entry_date,
            source_module,
            history,
            total_debit,
            total_credit,
            status,
            created_by,
            posted_by,
            posted_at
          )
          VALUES (
            $1, $2, $3, $4, $5,
            'CT', $6, $7, $8, 'LANCADO',
            $9, $9, NOW()
          )
          RETURNING
            id,
            entry_number
        `,
        [
          companyId,
          branchId,
          bookId,
          entryNumber,
          entryDate,
          history,
          totals.debit,
          totals.credit,
          userId,
        ]
      );

      const entry = entryResult.rows[0];

      for (
        let index = 0;
        index < lines.length;
        index += 1
      ) {
        const line = lines[index];

        await client.query(
          `
            INSERT INTO accounting_entry_lines (
              company_id,
              branch_id,
              entry_id,
              sequence,
              account_id,
              cost_center_id,
              debit,
              credit,
              history_complement,
              participant_id,
              document_number
            )
            VALUES (
              $1, $2, $3, $4, $5,
              $6, $7, $8, $9, $10,
              $11
            )
          `,
          [
            companyId,
            branchId,
            entry.id,
            index + 1,
            line.accountId,
            line.costCenterId,
            line.debit,
            line.credit,
            line.history,
            line.participantId,
            line.documentNumber,
          ]
        );
      }

      await client.query("COMMIT");

      return res.redirect(
        `/accounting/entries/${entry.id}?message=${encodeURIComponent(
          `Lançamento ${entry.entry_number} gerado com sucesso.`
        )}`
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

// Central SPED.
accountingRouter.get(
  "/accounting/sped",
  ...accountingGuard,
  asyncRoute(async (req, res) => {
    const {
      companyId,
      branchId,
    } = getContext(req);

    const [
      filesResult,
      booksResult,
    ] = await Promise.all([
      db.query(
        `
          SELECT
            file.*,
            book.code AS book_code,
            book.name AS book_name
          FROM accounting_sped_files file
          INNER JOIN accounting_books book
            ON book.id = file.book_id
           AND book.company_id = file.company_id
           AND book.branch_id = file.branch_id
          WHERE file.company_id = $1
            AND file.branch_id = $2
          ORDER BY file.id DESC
        `,
        [companyId, branchId]
      ),
      db.query(
        `
          SELECT
            id,
            code,
            name,
            period_start,
            period_end
          FROM accounting_books
          WHERE company_id = $1
            AND branch_id = $2
          ORDER BY period_start DESC
        `,
        [companyId, branchId]
      ),
    ]);

    return res.render(
      "accounting/sped",
      {
        pageTitle: "SPED Contábil",
        files: filesResult.rows,
        books: booksResult.rows,
      }
    );
  })
);

accountingRouter.post(
  "/accounting/sped/generate",
  ...accountingGuard,
  asyncRoute(async (req, res) => {
    const {
      companyId,
      branchId,
      userId,
    } = getContext(req);

    const bookId = parsePositiveInteger(
      req.body.book_id,
      "Livro contábil"
    );

    const [
      bookResult,
      companyResult,
      accountsResult,
      costCentersResult,
      entriesResult,
      linesResult,
    ] = await Promise.all([
      db.query(
        `
          SELECT *
          FROM accounting_books
          WHERE id = $1
            AND company_id = $2
            AND branch_id = $3
        `,
        [bookId, companyId, branchId]
      ),
      db.query(
        `
          SELECT *
          FROM companies
          WHERE id = $1
        `,
        [companyId]
      ),
      db.query(
        `
          SELECT
            account.*,
            reference.code AS reference_code
          FROM accounting_accounts account
          LEFT JOIN accounting_reference_accounts reference
            ON reference.id = account.reference_account_id
           AND reference.company_id = account.company_id
           AND reference.branch_id = account.branch_id
          WHERE account.company_id = $1
            AND account.branch_id = $2
            AND account.active = TRUE
          ORDER BY account.code
        `,
        [companyId, branchId]
      ),
      db.query(
        `
          SELECT *
          FROM accounting_cost_centers
          WHERE company_id = $1
            AND branch_id = $2
            AND active = TRUE
          ORDER BY code
        `,
        [companyId, branchId]
      ),
      db.query(
        `
          SELECT *
          FROM accounting_entries
          WHERE book_id = $1
            AND company_id = $2
            AND branch_id = $3
            AND status = 'LANCADO'
          ORDER BY
            entry_date,
            entry_number
        `,
        [bookId, companyId, branchId]
      ),
      db.query(
        `
          SELECT
            line.*,
            account.code AS account_code,
            cost_center.code AS cost_center_code,
            participant.document AS participant_code
          FROM accounting_entry_lines line
          INNER JOIN accounting_entries entry
            ON entry.id = line.entry_id
           AND entry.company_id = line.company_id
           AND entry.branch_id = line.branch_id
          INNER JOIN accounting_accounts account
            ON account.id = line.account_id
           AND account.company_id = line.company_id
           AND account.branch_id = line.branch_id
          LEFT JOIN accounting_cost_centers cost_center
            ON cost_center.id = line.cost_center_id
           AND cost_center.company_id = line.company_id
           AND cost_center.branch_id = line.branch_id
          LEFT JOIN clients participant
            ON participant.id = line.participant_id
           AND participant.company_id = line.company_id
           AND participant.branch_id = line.branch_id
          WHERE entry.book_id = $1
            AND entry.company_id = $2
            AND entry.branch_id = $3
            AND entry.status = 'LANCADO'
          ORDER BY
            line.entry_id,
            line.sequence
        `,
        [bookId, companyId, branchId]
      ),
    ]);

    const book = bookResult.rows[0];
    const company = companyResult.rows[0];

    if (!book) {
      const error = new Error(
        "Livro contábil não encontrado."
      );

      error.status = 404;
      throw error;
    }

    if (!company) {
      const error = new Error(
        "Empresa não encontrada."
      );

      error.status = 404;
      throw error;
    }

    const linesByEntry = new Map();

    for (const line of linesResult.rows) {
      const entryId = Number(line.entry_id);

      if (!linesByEntry.has(entryId)) {
        linesByEntry.set(entryId, []);
      }

      linesByEntry.get(entryId).push(line);
    }

    const entries = entriesResult.rows.map(
      (entry) => ({
        ...entry,
        lines:
          linesByEntry.get(
            Number(entry.id)
          ) || [],
      })
    );

    const content = buildEcdFile({
      company,
      book,
      accounts: accountsResult.rows,
      costCenters:
        costCentersResult.rows,
      entries,
    });

    const fileName = [
      "ECD",
      companyId,
      book.period_start,
      book.period_end,
    ].join("-") + ".txt";

    const fileResult = await db.query(
      `
        INSERT INTO accounting_sped_files (
          company_id,
          branch_id,
          book_id,
          obligation,
          layout_version,
          period_start,
          period_end,
          status,
          file_name,
          file_content,
          generated_by,
          generated_at
        )
        VALUES (
          $1, $2, $3, 'ECD', $4,
          $5, $6, 'GERADO', $7, $8,
          $9, NOW()
        )
        RETURNING id
      `,
      [
        companyId,
        branchId,
        bookId,
        String(
          book.sped_layout || "ECD_9"
        ).replace("ECD_", ""),
        book.period_start,
        book.period_end,
        fileName,
        content,
        userId,
      ]
    );

    const file = fileResult.rows[0];

    return res.redirect(
      `/accounting/sped/${file.id}/download`
    );
  })
);

accountingRouter.get(
  "/accounting/sped/:id/download",
  ...accountingGuard,
  asyncRoute(async (req, res) => {
    const {
      companyId,
      branchId,
    } = getContext(req);

    const fileId = parsePositiveInteger(
      req.params.id,
      "Identificador do arquivo"
    );

    const fileResult = await db.query(
      `
        SELECT
          file_name,
          file_content
        FROM accounting_sped_files
        WHERE id = $1
          AND company_id = $2
          AND branch_id = $3
        LIMIT 1
      `,
      [
        fileId,
        companyId,
        branchId,
      ]
    );

    const file = fileResult.rows[0];

    if (!file) {
      return res.status(404).render(
        "error",
        {
          message:
            "Arquivo SPED não encontrado.",
        }
      );
    }

    return res
      .type("text/plain; charset=utf-8")
      .attachment(
        file.file_name ||
        `ECD-${fileId}.txt`
      )
      .send(file.file_content || "");
  })
);
