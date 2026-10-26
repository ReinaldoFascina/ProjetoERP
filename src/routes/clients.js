import { Router } from "express";

import { db } from "../database/db.js";
import {
    requireAuth,
    allow,
} from "../middleware/auth.js";

export const clientsRouter = Router();

const canManageClients = [
    requireAuth,
    allow("ADMIN", "COORDENADOR"),
];

const onlyAdmin = [
    requireAuth,
    allow("ADMIN"),
];

const asyncRoute = (handler) =>
    (req, res, next) =>
        Promise.resolve(
            handler(req, res, next)
        ).catch(next);

const validPartnerTypes = [
    "CLIENTE",
    "FORNECEDOR",
    "AMBOS",
];

function getContext(req) {
    return {
        companyId: Number(
            req.session?.companyId || 0
        ),
        branchId: Number(
            req.session?.branchId || 0
        ),
    };
}

function normalizePartnerBody(body) {
    return {
        corporateName: String(
            body.corporate_name || ""
        ).trim(),
        tradeName:
            String(body.trade_name || "").trim() || null,
        document:
            String(body.document || "").trim() || null,
        email:
            String(body.email || "").trim().toLowerCase() || null,
        phone:
            String(body.phone || "").trim() || null,
        contactName:
            String(body.contact_name || "").trim() || null,
        address:
            String(body.address || "").trim() || null,
        addressNumber:
            String(body.address_number || "").trim() || null,
        addressComplement:
            String(body.address_complement || "").trim() || null,
        district:
            String(body.district || "").trim() || null,
        city:
            String(body.city || "").trim() || null,
        state:
            String(body.state || "").trim().toUpperCase() || null,
        postalCode:
            String(body.postal_code || "").trim() || null,
        contractHours: Number(body.contract_hours || 0),
        usedHours: Number(body.used_hours || 0),
        hourlyRate: Number(body.hourly_rate || 0),
        notes:
            String(body.notes || "").trim() || null,
        active: body.active === "on" || body.active === "true",
        partnerType: String(body.partner_type || "").trim().toUpperCase(),
    };
}

function validatePartner(partner) {
    if (!partner.corporateName) {
        return "Informe a razão social ou o nome da pessoa.";
    }

    if (!validPartnerTypes.includes(partner.partnerType)) {
        return "Tipo de relacionamento inválido.";
    }

    if (
        !Number.isFinite(partner.contractHours) ||
        partner.contractHours < 0 ||
        !Number.isFinite(partner.usedHours) ||
        partner.usedHours < 0 ||
        !Number.isFinite(partner.hourlyRate) ||
        partner.hourlyRate < 0
    ) {
        return "Horas e valor por hora devem ser números iguais ou maiores que zero.";
    }

    if (partner.state && partner.state.length !== 2) {
        return "A UF deve conter duas letras.";
    }

    return null;
}

// Lista clientes e fornecedores.
clientsRouter.get(
    "/clients",
    ...canManageClients,
    asyncRoute(async (req, res) => {
        const { companyId, branchId } = getContext(req);
        const q = String(req.query.q || "").trim();
        const status = String(req.query.status || "").trim().toUpperCase();
        const partnerType = String(req.query.partner_type || "").trim().toUpperCase();

        const params = [
            companyId,
            branchId,
        ];

        const where = [
            "c.company_id = $1",
            "c.branch_id = $2",
        ];

        if (q) {
            params.push(`%${q}%`);
            const index = params.length;

            where.push(`
        (
          c.corporate_name ILIKE $${index}
          OR COALESCE(c.trade_name, '') ILIKE $${index}
          OR COALESCE(c.document, '') ILIKE $${index}
        )
      `);
        }

        if (status === "ATIVO" || status === "INATIVO") {
            params.push(status === "ATIVO");
            where.push(`c.active = $${params.length}`);
        }

        if (validPartnerTypes.includes(partnerType)) {
            params.push(partnerType);
            where.push(`c.partner_type = $${params.length}`);
        }

        const { rows } = await db.query(
            `
        SELECT
          c.*,
          GREATEST(
            COALESCE(c.contract_hours, 0) -
            COALESCE(c.used_hours, 0),
            0
          ) AS balance_hours
        FROM clients c
        WHERE ${where.join(" AND ")}
        ORDER BY c.corporate_name
      `,
            params
        );

        return res.render(
            "clients/list",
            {
                pageTitle:
                    "Clientes e fornecedores",
                clients: rows,
                filters: {
                    q,
                    status,
                    partner_type: partnerType,
                },
            }
        );
    })
);

// Abre o formulário de inclusão.
clientsRouter.get(
    "/clients/new",
    ...canManageClients,
    (req, res) =>
        res.render(
            "clients/form",
            {
                client: null,
                action: "/clients",
                pageTitle: "Nova pessoa",
            }
        )
);

// Inclui cliente ou fornecedor.
clientsRouter.post(
    "/clients",
    ...canManageClients,
    asyncRoute(async (req, res) => {
        const { companyId, branchId } = getContext(req);
        const partner = normalizePartnerBody(req.body);
        const validationError = validatePartner(partner);

        if (validationError) {
            return res.status(400).render(
                "clients/form",
                {
                    client: req.body,
                    action: "/clients",
                    pageTitle: "Nova pessoa",
                    formError: validationError,
                }
            );
        }

        await db.query(
            `
        INSERT INTO clients (
          company_id,
          branch_id,
          corporate_name,
          trade_name,
          document,
          email,
          phone,
          contact_name,
          address,
          address_number,
          address_complement,
          district,
          city,
          state,
          postal_code,
          contract_hours,
          used_hours,
          hourly_rate,
          notes,
          active,
          partner_type,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20,
          $21, NOW()
        )
      `,
            [
                companyId,
                branchId,
                partner.corporateName,
                partner.tradeName,
                partner.document,
                partner.email,
                partner.phone,
                partner.contactName,
                partner.address,
                partner.addressNumber,
                partner.addressComplement,
                partner.district,
                partner.city,
                partner.state,
                partner.postalCode,
                partner.contractHours,
                partner.usedHours,
                partner.hourlyRate,
                partner.notes,
                partner.active,
                partner.partnerType,
            ]
        );

        return res.redirect(
            `/clients?message=${encodeURIComponent("Pessoa cadastrada com sucesso.")}`
        );
    })
);

// Abre o formulário de edição.
clientsRouter.get(
    "/clients/:id/edit",
    ...canManageClients,
    asyncRoute(async (req, res) => {
        const companyId = Number(req.session?.companyId || 0);
        const branchId = Number(req.session?.branchId || 0);
        const personId = Number(req.params.id || 0);

        if (!personId) {
            return res.status(400).render(
                "error",
                {
                    message:
                        "ID de pessoa inválido.",
                }
            );
        }

        const rs = await db.query(
            `
        SELECT *
        FROM clients
        WHERE id = $1
          AND company_id = $2
          AND branch_id = $3
        LIMIT 1
      `,
            [
                personId,
                companyId,
                branchId,
            ]
        );

        const person = rs.rows[0];

        if (!person) {
            return res.status(404).render(
                "error",
                {
                    message:
                        "Pessoa não encontrada para a empresa e filial selecionadas.",
                }
            );
        }

        /*
         * Envie o cadastro dentro de client.
         * Não espalhe suas colunas diretamente
         * no objeto usado pelo EJS.
         */

        return res.render(
            "clients/form",
            {
                client: person,
                action:
                    `/clients/${personId}`,
                pageTitle:
                    "Editar pessoa",
                formError: "",
            }
        );
    })
);

// Atualiza cliente ou fornecedor.
clientsRouter.post(
    "/clients/:id",
    ...canManageClients,
    asyncRoute(async (req, res) => {
        const { companyId, branchId } = getContext(req);
        const partner = normalizePartnerBody(req.body);
        const validationError = validatePartner(partner);

        if (validationError) {
            return res.status(400).render(
                "clients/form",
                {
                    client: {
                        ...req.body,
                        id: req.params.id,
                    },
                    action:
                        `/clients/${req.params.id}`,
                    pageTitle:
                        "Editar pessoa",
                    error: validationError,
                }
            );
        }

        const result = await db.query(
            `
        UPDATE clients
        SET
          corporate_name = $1,
          trade_name = $2,
          document = $3,
          email = $4,
          phone = $5,
          contact_name = $6,
          address = $7,
          address_number = $8,
          address_complement = $9,
          district = $10,
          city = $11,
          state = $12,
          postal_code = $13,
          contract_hours = $14,
          used_hours = $15,
          hourly_rate = $16,
          notes = $17,
          active = $18,
          partner_type = $19,
          updated_at = NOW()
        WHERE id = $20
          AND company_id = $21
          AND branch_id = $22
        RETURNING id
      `,
            [
                partner.corporateName,
                partner.tradeName,
                partner.document,
                partner.email,
                partner.phone,
                partner.contactName,
                partner.address,
                partner.addressNumber,
                partner.addressComplement,
                partner.district,
                partner.city,
                partner.state,
                partner.postalCode,
                partner.contractHours,
                partner.usedHours,
                partner.hourlyRate,
                partner.notes,
                partner.active,
                partner.partnerType,
                req.params.id,
                companyId,
                branchId,
            ]
        );

        if (!result.rowCount) {
            return res.status(404).render(
                "error",
                {
                    message:
                        "Pessoa não encontrada para atualização.",
                }
            );
        }

        return res.redirect(
            `/clients?message=${encodeURIComponent("Cadastro atualizado com sucesso.")}`
        );
    })
);

// Ativa ou inativa. Somente administrador.
clientsRouter.post(
    "/clients/:id/toggle",
    ...onlyAdmin,
    asyncRoute(async (req, res) => {
        const { companyId, branchId } = getContext(req);

        const result = await db.query(
            `
        UPDATE clients
        SET
          active = NOT active,
          updated_at = NOW()
        WHERE id = $1
          AND company_id = $2
          AND branch_id = $3
        RETURNING active
      `,
            [
                req.params.id,
                companyId,
                branchId,
            ]
        );

        if (!result.rowCount) {
            return res.status(404).render(
                "error",
                {
                    message:
                        "Pessoa não encontrada para alteração de status.",
                }
            );
        }

        const message = result.rows[0].active
            ? "Cadastro ativado com sucesso."
            : "Cadastro inativado com sucesso.";

        return res.redirect(
            `/clients?message=${encodeURIComponent(message)}`
        );
    })
);
