import { Router } from 'express';
import { db } from '../database/db.js';
import { requireAuth, allow } from '../middleware/auth.js';

export const catalogRouter = Router();
const p = [requireAuth, allow('ADMIN', 'COORDENADOR')];

catalogRouter.get('/catalog',
    ...p,
    async (req, res) => {
        const { rows } = await db.query(
            `SELECT * FROM catalog_items ORDER BY description`);
        res.render('catalog/list', { items: rows });
    });

catalogRouter.get('/catalog/new',
    ...p,
    (req, res) => res.render('catalog/form', { item: null, action: '/catalog' })
);

catalogRouter.post(
    '/catalog',
    ...p,
    async (req, res) => {
        const b = req.body;
        await db.query(
            `INSERT INTO catalog_items(item_type,code,description,unit,sale_price,active,ncm,cfop,
            cst_icms,csosn,icms_rate,ipi_rate,pis_cst,pis_rate,cofins_cst,cofins_rate,
            national_service_code,lc116_code,nbs_code,cnae,municipality_code,iss_rate)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
            [b.item_type, b.code, b.description, b.unit, b.sale_price, b.active === 'on', b.ncm || null,
            b.cfop || null, b.cst_icms || null, b.csosn || null, b.icms_rate || 0, b.ipi_rate || 0, b.pis_cst || null,
            b.pis_rate || 0, b.cofins_cst || null, b.cofins_rate || 0, b.national_service_code || null,
            b.lc116_code || null, b.nbs_code || null, b.cnae || null, b.municipality_code || null, b.iss_rate || 0]);
        res.redirect('/catalog')
    });

catalogRouter.get('/catalog/:id/edit',
    ...p,
    async (req, res) => {
        const id = Number(req.params.id);
        const { rows } = await db.query(
            `SELECT * FROM catalog_items WHERE id=$1`, [id]);
        if (rows.length === 0) return res.status(404).render('error', { message: 'Item não encontrado' });
        res.render('catalog/form', { item: rows[0], action: `/catalog/${id}` });
    });

catalogRouter.post(
    '/catalog/:id',
    ...p,
    async (req, res) => {
        const id = Number(req.params.id);
        const b = req.body;
        await db.query(
            `UPDATE catalog_items SET item_type=$1,code=$2,description=$3,unit=$4,sale_price=$5,
            active=$6,ncm=$7,cfop=$8,cst_icms=$9,csosn=$10,icms_rate=$11,ipi_rate=$12,pis_cst=$13,
            pis_rate=$14,cofins_cst=$15,cofins_rate=$16,national_service_code=$17,lc116_code=$18,
            nbs_code=$19,cnae=$20,municipality_code=$21,iss_rate=$22 WHERE id=$23`,
            [b.item_type, b.code, b.description, b.unit, b.sale_price, b.active === 'on', b.ncm || null,
            b.cfop || null, b.cst_icms || null, b.csosn || null, b.icms_rate || 0, b.ipi_rate || 0, b.pis_cst || null,
            b.pis_rate || 0, b.cofins_cst || null, b.cofins_rate || 0, b.national_service_code || null,
            b.lc116_code || null, b.nbs_code || null, b.cnae || null, b.municipality_code || null, b.iss_rate || 0, id]);
        res.redirect('/catalog');
    });
