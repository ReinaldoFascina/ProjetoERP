import { Router } from "express";
import { db } from "../database/db.js";
import { requireAuth, allow } from "../middleware/auth.js";
import {
    calculateDepreciableAmount,
    calculatePeriodDepreciation,
    calculateResidualValue
} from "../services/assets/depreciation.js";
import { createAccountingEntry } from "../services/assets/accounting.js";

export const assetsRouter = Router();

const guard = [requireAuth, allow("ADMIN", "COORDENADOR")];

const asyncRoute = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const ctx = (req) => ({
    companyId: Number(req.session.companyId),
    branchId: Number(req.session.branchId),
    userId: Number(req.session.user.id)
});

const id = (v, n) => {
    const x = Number(v);
    if (!Number.isInteger(x) || x <= 0) {
        throw Object.assign(new Error(`${n} inválido.`), { status: 400 });
    }
    return x;
};

// ─────────────────────────────────────────────────────────────
// Lookups compartilhados (combos de formulário)
// ─────────────────────────────────────────────────────────────
async function lookups(companyId, branchId) {
    const [categories, responsibles, costCenters, products, accounts, books] =
        await Promise.all([
            db.query(
                "SELECT * FROM asset_categories WHERE company_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY code",
                [companyId, branchId]
            ),
            db.query(
                "SELECT * FROM asset_responsibles WHERE company_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY name",
                [companyId, branchId]
            ),
            db.query(
                "SELECT id,code,name FROM accounting_cost_centers WHERE company_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY code",
                [companyId, branchId]
            ),
            db.query(
                "SELECT id,code,description FROM catalog_items WHERE company_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY description",
                [companyId, branchId]
            ),
            db.query(
                "SELECT id,code,name FROM accounting_accounts WHERE company_id=$1 AND branch_id=$2 AND active=TRUE AND analytical=TRUE ORDER BY code",
                [companyId, branchId]
            ),
            db.query(
                "SELECT id,code,name FROM accounting_books WHERE company_id=$1 AND branch_id=$2 AND status='ABERTO' ORDER BY code",
                [companyId, branchId]
            )
        ]);

    return {
        categories: categories.rows,
        responsibles: responsibles.rows,
        costCenters: costCenters.rows,
        products: products.rows,
        accounts: accounts.rows,
        books: books.rows
    };
}

// ─────────────────────────────────────────────────────────────
// Listagem de patrimônios
// ─────────────────────────────────────────────────────────────
assetsRouter.get(
    "/assets",
    ...guard,
    asyncRoute(async (req, res) => {
        const { companyId, branchId } = ctx(req);

        const [assets, summary] = await Promise.all([
            db.query(
                `SELECT
           a.*,
           c.code             AS category_code,
           c.name             AS category_name,
           r.name             AS responsible_name,
           cc.code            AS cost_center_code
         FROM assets a
         JOIN asset_categories c       ON c.id  = a.category_id
         LEFT JOIN asset_responsibles r ON r.id = a.responsible_id
         LEFT JOIN accounting_cost_centers cc ON cc.id = a.cost_center_id
         WHERE a.company_id = $1 AND a.branch_id = $2
         ORDER BY a.id DESC`,
                [companyId, branchId]
            ),
            db.query(
                `SELECT
           COUNT(*)::integer                       AS total,
           COALESCE(SUM(acquisition_cost), 0)      AS acquisition,
           COALESCE(SUM(accumulated_depreciation), 0) AS depreciation,
           COALESCE(SUM(book_value), 0)            AS book_value
         FROM assets
         WHERE company_id = $1
           AND branch_id  = $2
           AND status NOT IN ('SOLD', 'WRITTEN_OFF')`,
                [companyId, branchId]
            )
        ]);

        res.render("assets/index", {
            pageTitle: "Gestão de Patrimônio",
            assets: assets.rows,
            summary: summary.rows[0]
        });
    })
);

// ─────────────────────────────────────────────────────────────
// Formulário de novo patrimônio
// ─────────────────────────────────────────────────────────────
assetsRouter.get(
    "/assets/new",
    ...guard,
    asyncRoute(async (req, res) => {
        const c = ctx(req);
        res.render("assets/form", {
            pageTitle: "Novo patrimônio",
            asset: null,
            ...(await lookups(c.companyId, c.branchId))
        });
    })
);

// ─────────────────────────────────────────────────────────────
// Criação de patrimônio
// ─────────────────────────────────────────────────────────────
assetsRouter.post(
    "/assets",
    ...guard,
    asyncRoute(async (req, res) => {
        const c = ctx(req);
        const b = req.body;

        const category = (
            await db.query(
                "SELECT * FROM asset_categories WHERE id=$1 AND company_id=$2 AND branch_id=$3",
                [id(b.category_id, "Categoria"), c.companyId, c.branchId]
            )
        ).rows[0];

        if (!category) {
            throw Object.assign(new Error("Categoria não encontrada."), {
                status: 404
            });
        }

        const cost = Number(b.acquisition_cost);
        const residual = b.residual_value
            ? Number(b.residual_value)
            : calculateResidualValue(cost, category.residual_percent);
        const depreciable = calculateDepreciableAmount(cost, residual);

        const row = (
            await db.query(
                `INSERT INTO assets (
           company_id,
           branch_id,
           asset_number,
           tag_number,
           description,
           category_id,
           catalog_item_id,
           supplier_id,
           invoice_number,
           invoice_key,
           purchase_date,
           acquisition_date,
           in_service_date,
           depreciation_start_date,
           acquisition_cost,
           residual_value,
           depreciable_amount,
           useful_life_months,
           depreciation_method,
           production_capacity_units,
           book_value,
           responsible_id,
           cost_center_id,
           location,
           status,
           notes,
           created_by
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
           $14, $15, $16, $17, $18, $19, $20, $15, $21, $22, $23,
           $24, $25, $26
         )
         RETURNING id`,
                [
                    c.companyId,
                    c.branchId,
                    b.asset_number,
                    b.tag_number || null,
                    b.description,
                    category.id,
                    b.catalog_item_id || null,
                    b.supplier_id || null,
                    b.invoice_number || null,
                    b.invoice_key || null,
                    b.purchase_date,
                    b.acquisition_date,
                    b.in_service_date || null,
                    b.depreciation_start_date || null,
                    cost,
                    residual,
                    depreciable,
                    Number(b.useful_life_months || category.useful_life_months),
                    b.depreciation_method || category.depreciation_method,
                    b.production_capacity_units || null,
                    b.responsible_id || null,
                    b.cost_center_id || null,
                    b.location || null,
                    b.status || "ACTIVE",
                    b.notes || null,
                    c.userId
                ]
            )
        ).rows[0];

        res.redirect(`/assets/${row.id}`);
    })
);

// ─────────────────────────────────────────────────────────────
// Categorias patrimoniais
// ─────────────────────────────────────────────────────────────
assetsRouter.get(
    "/assets/categories",
    ...guard,
    asyncRoute(async (req, res) => {
        const c = ctx(req);
        const data = await lookups(c.companyId, c.branchId);
        res.render("assets/categories", {
            pageTitle: "Categorias patrimoniais",
            ...data
        });
    })
);

assetsRouter.post(
    "/assets/categories",
    ...guard,
    asyncRoute(async (req, res) => {
        const c = ctx(req);
        const b = req.body;

        await db.query(
            `INSERT INTO asset_categories (
         company_id,
         branch_id,
         code,
         name,
         useful_life_months,
         residual_percent,
         depreciation_method,
         asset_account_id,
         accumulated_depreciation_account_id,
         depreciation_expense_account_id,
         gain_account_id,
         loss_account_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
                c.companyId,
                c.branchId,
                b.code,
                b.name,
                Number(b.useful_life_months),
                Number(b.residual_percent || 0),
                b.depreciation_method,
                b.asset_account_id || null,
                b.accumulated_depreciation_account_id || null,
                b.depreciation_expense_account_id || null,
                b.gain_account_id || null,
                b.loss_account_id || null
            ]
        );

        res.redirect("/assets/categories");
    })
);

// ─────────────────────────────────────────────────────────────
// Responsáveis por patrimônio
// ─────────────────────────────────────────────────────────────
assetsRouter.get(
    "/assets/responsibles",
    ...guard,
    asyncRoute(async (req, res) => {
        const c = ctx(req);
        const rows = await db.query(
            "SELECT * FROM asset_responsibles WHERE company_id=$1 AND branch_id=$2 ORDER BY name",
            [c.companyId, c.branchId]
        );
        res.render("assets/responsibles", {
            pageTitle: "Responsáveis por patrimônio",
            responsibles: rows.rows
        });
    })
);

assetsRouter.post(
    "/assets/responsibles",
    ...guard,
    asyncRoute(async (req, res) => {
        const c = ctx(req);
        const b = req.body;

        await db.query(
            "INSERT INTO asset_responsibles(company_id,branch_id,user_id,client_id,name,document,email) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
                c.companyId,
                c.branchId,
                b.user_id || null,
                b.client_id || null,
                b.name,
                b.document || null,
                b.email || null
            ]
        );

        res.redirect("/assets/responsibles");
    })
);

// ─────────────────────────────────────────────────────────────
// Regras de compra patrimonial
// ─────────────────────────────────────────────────────────────
assetsRouter.get(
    "/assets/purchase-rules",
    ...guard,
    asyncRoute(async (req, res) => {
        const c = ctx(req);

        const [rules, categories] = await Promise.all([
            db.query(
                `SELECT
           r.*,
           c.code AS category_code,
           c.name AS category_name
         FROM asset_purchase_rules r
         LEFT JOIN asset_categories c ON c.id = r.category_id
         WHERE r.company_id = $1 AND r.branch_id = $2
         ORDER BY r.movement_type_code`,
                [c.companyId, c.branchId]
            ),
            db.query(
                "SELECT id,code,name FROM asset_categories WHERE company_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY code",
                [c.companyId, c.branchId]
            )
        ]);

        res.render("assets/purchase-rules", {
            pageTitle: "Regras de compra patrimonial",
            rules: rules.rows,
            categories: categories.rows
        });
    })
);

assetsRouter.post(
    "/assets/purchase-rules",
    ...guard,
    asyncRoute(async (req, res) => {
        const c = ctx(req);
        const b = req.body;

        await db.query(
            `INSERT INTO asset_purchase_rules (
         company_id,
         branch_id,
         movement_type_code,
         category_id,
         minimum_value,
         auto_create,
         start_depreciation_rule
       ) VALUES ($1, $2, $3, $4, $5, TRUE, $6)
       ON CONFLICT (company_id, branch_id, movement_type_code) DO UPDATE SET
         category_id             = EXCLUDED.category_id,
         minimum_value           = EXCLUDED.minimum_value,
         auto_create             = TRUE,
         start_depreciation_rule = EXCLUDED.start_depreciation_rule,
         updated_at              = NOW()`,
            [
                c.companyId,
                c.branchId,
                b.movement_type_code,
                b.category_id || null,
                Number(b.minimum_value || 0),
                b.start_depreciation_rule
            ]
        );

        res.redirect("/assets/purchase-rules");
    })
);

// ─────────────────────────────────────────────────────────────
// Depreciação — listagem de períodos
// ─────────────────────────────────────────────────────────────
assetsRouter.get(
    "/assets/depreciation",
    ...guard,
    asyncRoute(async (req, res) => {
        const c = ctx(req);

        const [periods, books] = await Promise.all([
            db.query(
                `SELECT
           p.*,
           COUNT(d.id)::integer                    AS asset_count,
           COALESCE(SUM(d.depreciation_amount), 0) AS total
         FROM asset_depreciation_periods p
         LEFT JOIN asset_depreciation_entries d ON d.period_id = p.id
         WHERE p.company_id = $1 AND p.branch_id = $2
         GROUP BY p.id
         ORDER BY p.period_end DESC`,
                [c.companyId, c.branchId]
            ),
            db.query(
                "SELECT id,code,name FROM accounting_books WHERE company_id=$1 AND branch_id=$2 AND status='ABERTO'",
                [c.companyId, c.branchId]
            )
        ]);

        res.render("assets/depreciation", {
            pageTitle: "Depreciação patrimonial",
            periods: periods.rows,
            books: books.rows
        });
    })
);

// ─────────────────────────────────────────────────────────────
// Depreciação — processamento do período
// ─────────────────────────────────────────────────────────────
assetsRouter.post(
    "/assets/depreciation/process",
    ...guard,
    asyncRoute(async (req, res) => {
        const c = ctx(req);
        const b = req.body;

        const client = await db.connect();

        try {
            await client.query("BEGIN");

            const period = (
                await client.query(
                    `INSERT INTO asset_depreciation_periods (
             company_id, branch_id, period_start, period_end, status, processed_by
           ) VALUES ($1, $2, $3, $4, 'OPEN', $5)
           RETURNING id`,
                    [c.companyId, c.branchId, b.period_start, b.period_end, c.userId]
                )
            ).rows[0];

            const assets = (
                await client.query(
                    `SELECT
             a.*,
             cat.accumulated_depreciation_account_id,
             cat.depreciation_expense_account_id
           FROM assets a
           JOIN asset_categories cat ON cat.id = a.category_id
           WHERE a.company_id = $1
             AND a.branch_id  = $2
             AND a.status = 'ACTIVE'
             AND a.depreciation_start_date IS NOT NULL
             AND a.depreciation_start_date <= $3
             AND a.book_value > a.residual_value
           FOR UPDATE`,
                    [c.companyId, c.branchId, b.period_end]
                )
            ).rows;

            const grouped = new Map();

            for (const a of assets) {
                const amount = calculatePeriodDepreciation(a, 0);
                if (amount <= 0) continue;

                const closing = Math.max(
                    Number(a.book_value) - amount,
                    Number(a.residual_value)
                );

                await client.query(
                    `INSERT INTO asset_depreciation_entries (
             company_id,
             branch_id,
             period_id,
             asset_id,
             depreciation_date,
             opening_book_value,
             depreciation_amount,
             accumulated_depreciation,
             closing_book_value
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                    [
                        c.companyId,
                        c.branchId,
                        period.id,
                        a.id,
                        b.period_end,
                        a.book_value,
                        amount,
                        Number(a.accumulated_depreciation) + amount,
                        closing
                    ]
                );

                await client.query(
                    "UPDATE assets SET accumulated_depreciation=accumulated_depreciation+$1,book_value=$2,updated_at=NOW() WHERE id=$3",
                    [amount, closing, a.id]
                );

                const key = `${a.depreciation_expense_account_id}|${a.accumulated_depreciation_account_id}|${a.cost_center_id || ""}`;
                grouped.set(key, (grouped.get(key) || 0) + amount);
            }

            let accountingEntryId = null;

            if (grouped.size) {
                const lines = [];

                for (const [key, total] of grouped) {
                    const [expense, accumulated, costCenter] = key.split("|");

                    if (!expense || !accumulated) {
                        throw new Error(
                            "Categoria sem contas contábeis de depreciação configuradas."
                        );
                    }

                    lines.push({
                        accountId: Number(expense),
                        costCenterId: costCenter ? Number(costCenter) : null,
                        debit: Number(total.toFixed(2)),
                        credit: 0
                    });
                    lines.push({
                        accountId: Number(accumulated),
                        costCenterId: costCenter ? Number(costCenter) : null,
                        debit: 0,
                        credit: Number(total.toFixed(2))
                    });
                }

                accountingEntryId = await createAccountingEntry(client, {
                    companyId: c.companyId,
                    branchId: c.branchId,
                    userId: c.userId,
                    bookId: id(b.book_id, "Livro"),
                    entryNumber: `DEP-${b.period_end}`,
                    entryDate: b.period_end,
                    history: `Depreciação patrimonial ${b.period_start} a ${b.period_end}`,
                    sourceId: period.id,
                    lines
                });
            }

            await client.query(
                `UPDATE asset_depreciation_periods
         SET status='POSTED', processed_at=NOW(), accounting_entry_id=$1, updated_at=NOW()
         WHERE id=$2`,
                [accountingEntryId, period.id]
            );

            await client.query("COMMIT");

            res.redirect("/assets/depreciation");
        } catch (e) {
            await client.query("ROLLBACK");
            throw e;
        } finally {
            client.release();
        }
    })
);

// ─────────────────────────────────────────────────────────────
// Relatório: Posição patrimonial
// ─────────────────────────────────────────────────────────────
assetsRouter.get(
    "/assets/reports/position",
    ...guard,
    asyncRoute(async (req, res) => {
        const c = ctx(req);

        const rows = await db.query(
            `SELECT
         a.asset_number,
         a.tag_number,
         a.description,
         c.name  AS category,
         r.name  AS responsible,
         cc.code AS cost_center,
         a.acquisition_date,
         a.acquisition_cost,
         a.accumulated_depreciation,
         a.book_value,
         a.status
       FROM assets a
       JOIN asset_categories c       ON c.id  = a.category_id
       LEFT JOIN asset_responsibles r ON r.id = a.responsible_id
       LEFT JOIN accounting_cost_centers cc ON cc.id = a.cost_center_id
       WHERE a.company_id = $1 AND a.branch_id = $2
       ORDER BY c.name, a.asset_number`,
            [c.companyId, c.branchId]
        );

        res.render("assets/report", {
            pageTitle: "Posição patrimonial",
            title: "Posição patrimonial",
            rows: rows.rows
        });
    })
);


// ─────────────────────────────────────────────────────────────
// Detalhe do patrimônio
// ─────────────────────────────────────────────────────────────
assetsRouter.get(
  "/assets/:id(\\d+)",
    ...guard,
    asyncRoute(async (req, res) => {
        const c = ctx(req);
        const assetId = id(req.params.id, "Patrimônio");

        const [asset, transfers, depreciations] = await Promise.all([
            db.query(
                `SELECT
           a.*,
           c.name  AS category_name,
           r.name  AS responsible_name,
           cc.code AS cost_center_code,
           cc.name AS cost_center_name
         FROM assets a
         JOIN asset_categories c       ON c.id  = a.category_id
         LEFT JOIN asset_responsibles r ON r.id = a.responsible_id
         LEFT JOIN accounting_cost_centers cc ON cc.id = a.cost_center_id
         WHERE a.id         = $1
           AND a.company_id = $2
           AND a.branch_id  = $3`,
                [assetId, c.companyId, c.branchId]
            ),
            db.query(
                `SELECT
           t.*,
           r1.name AS previous_responsible,
           r2.name AS new_responsible,
           c1.code AS previous_cost_center,
           c2.code AS new_cost_center
         FROM asset_transfers t
         LEFT JOIN asset_responsibles r1      ON r1.id = t.previous_responsible_id
         LEFT JOIN asset_responsibles r2      ON r2.id = t.new_responsible_id
         LEFT JOIN accounting_cost_centers c1 ON c1.id = t.previous_cost_center_id
         LEFT JOIN accounting_cost_centers c2 ON c2.id = t.new_cost_center_id
         WHERE t.asset_id = $1
         ORDER BY t.id DESC`,
                [assetId]
            ),
            db.query(
                `SELECT
           d.*,
           p.period_start,
           p.period_end,
           p.status AS period_status
         FROM asset_depreciation_entries d
         JOIN asset_depreciation_periods p ON p.id = d.period_id
         WHERE d.asset_id = $1
         ORDER BY d.depreciation_date DESC`,
                [assetId]
            )
        ]);

        if (!asset.rows[0]) {
            return res
                .status(404)
                .render("error", { message: "Patrimônio não encontrado." });
        }

        res.render("assets/detail", {
            pageTitle: `Patrimônio ${asset.rows[0].asset_number}`,
            asset: asset.rows[0],
            transfers: transfers.rows,
            depreciations: depreciations.rows,
            ...(await lookups(c.companyId, c.branchId))
        });
    })
);

// ─────────────────────────────────────────────────────────────
// Transferência de responsável / centro de custo / local
// ─────────────────────────────────────────────────────────────
assetsRouter.post(
    "/assets/:id/transfer",
    ...guard,
    asyncRoute(async (req, res) => {
        const c = ctx(req);
        const assetId = id(req.params.id, "Patrimônio");
        const b = req.body;

        const client = await db.connect();

        try {
            await client.query("BEGIN");

            const a = (
                await client.query(
                    "SELECT * FROM assets WHERE id=$1 AND company_id=$2 AND branch_id=$3 FOR UPDATE",
                    [assetId, c.companyId, c.branchId]
                )
            ).rows[0];

            if (!a) {
                throw Object.assign(new Error("Patrimônio não encontrado."), {
                    status: 404
                });
            }

            await client.query(
                `INSERT INTO asset_transfers (
           company_id,
           branch_id,
           asset_id,
           transfer_date,
           previous_responsible_id,
           new_responsible_id,
           previous_cost_center_id,
           new_cost_center_id,
           previous_location,
           new_location,
           notes,
           created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [
                    c.companyId,
                    c.branchId,
                    assetId,
                    b.transfer_date,
                    a.responsible_id,
                    b.responsible_id || null,
                    a.cost_center_id,
                    b.cost_center_id || null,
                    a.location,
                    b.location || null,
                    b.notes || null,
                    c.userId
                ]
            );

            await client.query(
                "UPDATE assets SET responsible_id=$1,cost_center_id=$2,location=$3,updated_at=NOW() WHERE id=$4",
                [
                    b.responsible_id || null,
                    b.cost_center_id || null,
                    b.location || null,
                    assetId
                ]
            );

            await client.query("COMMIT");

            res.redirect(`/assets/${assetId}`);
        } catch (e) {
            await client.query("ROLLBACK");
            throw e;
        } finally {
            client.release();
        }
    })
);