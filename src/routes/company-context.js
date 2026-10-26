import { Router } from "express";
import { db } from "../database/db.js";
import { requireAuth, allow } from "../middleware/auth.js";

export const companyContextRouter = Router();

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeState(value) {
  const state = String(value ?? "").trim().toUpperCase();
  return state || null;
}

function readSelectedContext(body) {
  if (body.context) {
    const [companyValue, branchValue] = String(body.context).split(":");
    return {
      companyId: Number(companyValue),
      branchId: Number(branchValue),
    };
  }

  return {
    companyId: Number(body.company_id),
    branchId: Number(body.branch_id),
  };
}

companyContextRouter.get(
  "/company-context",
  requireAuth,
  asyncRoute(async (req, res) => {
    const { rows } = await db.query(
      `SELECT
         c.id AS company_id,
         c.code AS company_code,
         c.corporate_name,
         c.trade_name,
         COALESCE(c.trade_name, c.corporate_name) AS company_name,
         b.id AS branch_id,
         b.code AS branch_code,
         b.name AS branch_name,
         a.is_default
       FROM user_company_access a
       JOIN companies c
         ON c.id = a.company_id
        AND c.active = TRUE
       JOIN branches b
         ON b.company_id = c.id
        AND b.active = TRUE
       WHERE a.user_id = $1
         AND a.active = TRUE
       ORDER BY
         a.is_default DESC,
         c.code,
         b.code`,
      [req.session.user.id]
    );

    return res.render("context/select", {
      pageTitle: "Selecionar empresa e filial",
      contexts: rows,
      error: rows.length ? null : "Nenhuma empresa ou filial está liberada para este usuário.",
    });
  })
);

companyContextRouter.post(
  "/company-context",
  requireAuth,
  asyncRoute(async (req, res, next) => {
    const { companyId, branchId } = readSelectedContext(req.body);

    if (!Number.isInteger(companyId) || companyId <= 0 || !Number.isInteger(branchId) || branchId <= 0) {
      const { rows } = await db.query(
        `SELECT
           c.id AS company_id,
           c.code AS company_code,
           c.corporate_name,
           c.trade_name,
           COALESCE(c.trade_name, c.corporate_name) AS company_name,
           b.id AS branch_id,
           b.code AS branch_code,
           b.name AS branch_name,
           a.is_default
         FROM user_company_access a
         JOIN companies c
           ON c.id = a.company_id
          AND c.active = TRUE
         JOIN branches b
           ON b.company_id = c.id
          AND b.active = TRUE
         WHERE a.user_id = $1
           AND a.active = TRUE
         ORDER BY a.is_default DESC, c.code, b.code`,
        [req.session.user.id]
      );

      return res.status(400).render("context/select", {
        pageTitle: "Selecionar empresa e filial",
        contexts: rows,
        error: "Selecione uma empresa e uma filial válidas.",
      });
    }

    const access = await db.query(
      `SELECT
         c.id AS company_id,
         b.id AS branch_id
       FROM user_company_access a
       JOIN companies c
         ON c.id = a.company_id
        AND c.active = TRUE
       JOIN branches b
         ON b.id = $3
        AND b.company_id = c.id
        AND b.active = TRUE
       WHERE a.user_id = $1
         AND a.company_id = $2
         AND a.active = TRUE`,
      [req.session.user.id, companyId, branchId]
    );

    if (!access.rowCount) {
      return res.status(403).render("error", {
        message: "Empresa ou filial não permitida para este usuário.",
      });
    }

    req.session.companyId = companyId;
    req.session.branchId = branchId;
    req.session.activeModule = "technical";

    return req.session.save((error) => {
      if (error) return next(error);
      return res.redirect("/modules");
    });
  })
);

companyContextRouter.get(
  "/companies",
  requireAuth,
  allow("ADMIN"),
  asyncRoute(async (req, res) => {
    const [companies, users] = await Promise.all([
      db.query(
        `SELECT
           c.*,
           COUNT(DISTINCT b.id)::int AS branch_count,
           COUNT(DISTINCT a.user_id)::int AS user_count
         FROM companies c
         LEFT JOIN branches b
           ON b.company_id = c.id
         LEFT JOIN user_company_access a
           ON a.company_id = c.id
          AND a.active = TRUE
         GROUP BY c.id
         ORDER BY c.code`
      ),
      db.query(
        `SELECT id, name, email, role
         FROM users
         WHERE active = TRUE
         ORDER BY name`
      ),
    ]);

    return res.render("companies/list", {
      pageTitle: "Empresas, filiais e acessos",
      companies: companies.rows,
      users: users.rows,
    });
  })
);

companyContextRouter.get(
  "/companies/new",
  requireAuth,
  allow("ADMIN"),
  (req, res) => {
    return res.render("companies/form", {
      pageTitle: "Nova empresa",
      company: null,
      action: "/companies",
      error: null,
    });
  }
);

companyContextRouter.post(
  "/companies",
  requireAuth,
  allow("ADMIN"),
  asyncRoute(async (req, res) => {
    const body = req.body;
    const code = String(body.code ?? "").trim().toUpperCase();
    const corporateName = String(body.corporate_name ?? "").trim();
    const tradeName = normalizeText(body.trade_name) || corporateName;
    const document = normalizeText(body.document)?.replace(/\D/g, "") || null;
    const branchCode = String(body.branch_code || "01").trim().toUpperCase();
    const branchName = String(body.branch_name || "Matriz").trim();

    if (!code || !corporateName || !branchCode || !branchName) {
      return res.status(400).render("companies/form", {
        pageTitle: "Nova empresa",
        company: body,
        action: "/companies",
        error: "Código, razão social, código da filial e nome da filial são obrigatórios.",
      });
    }

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const companyResult = await client.query(
        `INSERT INTO companies(
           code, corporate_name, trade_name, document,
           state_registration, municipal_registration,
           email, phone, city, state, active
         )
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE)
         RETURNING id`,
        [
          code,
          corporateName,
          tradeName,
          document,
          normalizeText(body.state_registration),
          normalizeText(body.municipal_registration),
          normalizeText(body.email),
          normalizeText(body.phone),
          normalizeText(body.city),
          normalizeState(body.state),
        ]
      );

      const company = companyResult.rows[0];

      await client.query(
        `INSERT INTO branches(
           company_id, code, name, document,
           state_registration, municipal_registration,
           city, state, active
         )
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,TRUE)`,
        [
          company.id,
          branchCode,
          branchName,
          document,
          normalizeText(body.state_registration),
          normalizeText(body.municipal_registration),
          normalizeText(body.city),
          normalizeState(body.state),
        ]
      );

      await client.query(
        `INSERT INTO user_company_access(
           user_id, company_id, is_default, active
         )
         VALUES($1,$2,FALSE,TRUE)
         ON CONFLICT(user_id,company_id)
         DO UPDATE SET active=TRUE`,
        [req.session.user.id, company.id]
      );

      await client.query("COMMIT");
      return res.redirect("/companies");
    } catch (error) {
      await client.query("ROLLBACK");

      if (error.code === "23505") {
        return res.status(409).render("companies/form", {
          pageTitle: "Nova empresa",
          company: body,
          action: "/companies",
          error: "Já existe uma empresa com esse código ou documento.",
        });
      }

      throw error;
    } finally {
      client.release();
    }
  })
);

companyContextRouter.post(
  "/companies/:id/branches",
  requireAuth,
  allow("ADMIN"),
  asyncRoute(async (req, res) => {
    const companyId = Number(req.params.id);
    const body = req.body;
    const code = String(body.code ?? "").trim().toUpperCase();
    const name = String(body.name ?? "").trim();

    if (!Number.isInteger(companyId) || companyId <= 0 || !code || !name) {
      return res.status(400).render("error", {
        message: "Empresa, código da filial e nome da filial são obrigatórios.",
      });
    }

    try {
      await db.query(
        `INSERT INTO branches(
           company_id, code, name, document,
           state_registration, municipal_registration,
           city, state, active
         )
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,TRUE)`,
        [
          companyId,
          code,
          name,
          normalizeText(body.document)?.replace(/\D/g, "") || null,
          normalizeText(body.state_registration),
          normalizeText(body.municipal_registration),
          normalizeText(body.city),
          normalizeState(body.state),
        ]
      );

      return res.redirect("/companies");
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).render("error", {
          message: "Já existe uma filial com esse código nesta empresa.",
        });
      }
      throw error;
    }
  })
);

companyContextRouter.post(
  "/companies/:id/access",
  requireAuth,
  allow("ADMIN"),
  asyncRoute(async (req, res) => {
    const companyId = Number(req.params.id);
    const userId = Number(req.body.user_id);
    const isDefault = req.body.is_default === "on";

    if (!Number.isInteger(companyId) || companyId <= 0 || !Number.isInteger(userId) || userId <= 0) {
      return res.status(400).render("error", {
        message: "Empresa e usuário são obrigatórios.",
      });
    }

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      if (isDefault) {
        await client.query(
          `UPDATE user_company_access
           SET is_default=FALSE
           WHERE user_id=$1`,
          [userId]
        );
      }

      await client.query(
        `INSERT INTO user_company_access(
           user_id, company_id, is_default, active
         )
         VALUES($1,$2,$3,TRUE)
         ON CONFLICT(user_id,company_id)
         DO UPDATE SET
           active=TRUE,
           is_default=EXCLUDED.is_default`,
        [userId, companyId, isDefault]
      );

      await client.query("COMMIT");
      return res.redirect("/companies");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);
