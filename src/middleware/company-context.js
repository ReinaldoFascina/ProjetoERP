import { db } from "../database/db.js";

import {
  runWithCompanyContext,
} from "../context/company-context.js";

function isPublicRoute(path) {
  return (
    path === "/login" ||
    path === "/health" ||
    path.startsWith("/rat-approval/")
  );
}

function isContextRoute(path) {
  return (
    path === "/company-context" ||
    path.startsWith("/company-context/")
  );
}

export async function companyContext(
  req,
  res,
  next
) {
  try {
    /*
     * Usuário ainda não autenticado.
     */
    if (!req.session?.user) {
      return runWithCompanyContext(
        {},
        () => next()
      );
    }

    /*
     * Rotas que não dependem de empresa e filial.
     */
    if (
      isPublicRoute(req.path) ||
      isContextRoute(req.path)
    ) {
      return runWithCompanyContext(
        {},
        () => next()
      );
    }

    const companyId = Number(
      req.session.companyId || 0
    );

    const branchId = Number(
      req.session.branchId || 0
    );

    if (!companyId || !branchId) {
      return res.redirect(
        "/company-context"
      );
    }

    const result = await db.query(
      `
        SELECT
          c.id AS company_id,
          c.code AS company_code,

          COALESCE(
            c.trade_name,
            c.corporate_name
          ) AS company_name,

          b.id AS branch_id,
          b.code AS branch_code,
          b.name AS branch_name

        FROM user_company_access a

        INNER JOIN companies c
          ON c.id = a.company_id
         AND c.active = TRUE

        INNER JOIN branches b
          ON b.id = $2
         AND b.company_id = c.id
         AND b.active = TRUE

        WHERE a.user_id = $1
          AND a.company_id = $3
          AND a.active = TRUE
      `,
      [
        req.session.user.id,
        branchId,
        companyId,
      ]
    );

    if (!result.rowCount) {
      delete req.session.companyId;
      delete req.session.branchId;

      return req.session.save(
        (saveError) => {
          if (saveError) {
            return next(saveError);
          }

          return res.redirect(
            "/company-context"
          );
        }
      );
    }

    const selectedContext =
      result.rows[0];

    res.locals.companyContext =
      selectedContext;

    return runWithCompanyContext(
      {
        companyId:
          selectedContext.company_id,

        branchId:
          selectedContext.branch_id,

        userId:
          req.session.user.id,
      },
      () => next()
    );
  } catch (error) {
    return next(error);
  }
}