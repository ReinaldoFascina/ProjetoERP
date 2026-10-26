import { Router } from "express";
import { db } from "../database/db.js";
import { requireAuth, allow } from "../middleware/auth.js";

export const productionRouter = Router();

const guard = [requireAuth, allow("ADMIN", "COORDENADOR")];
const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

function context(req) {
  const companyId = Number(req.session?.companyId);
  const branchId = Number(req.session?.branchId);
  const userId = Number(req.session?.user?.id);

  if (![companyId, branchId, userId].every(Number.isInteger)) {
    const error = new Error("Contexto de empresa, filial ou usuário inválido.");
    error.status = 400;
    throw error;
  }

  return { companyId, branchId, userId };
}

function positiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    const error = new Error(`${field} deve ser maior que zero.`);
    error.status = 400;
    throw error;
  }
  return number;
}

function nonNegativeNumber(value, field) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) {
    const error = new Error(`${field} deve ser igual ou maior que zero.`);
    error.status = 400;
    throw error;
  }
  return number;
}

function integerId(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    const error = new Error(`${field} inválido.`);
    error.status = 400;
    throw error;
  }
  return number;
}

async function loadProducts(companyId, branchId) {
  const result = await db.query(
    `SELECT id, code, description, unit, item_type
       FROM catalog_items
      WHERE company_id = $1
        AND branch_id = $2
        AND active = TRUE
      ORDER BY description`,
    [companyId, branchId]
  );
  return result.rows;
}

productionRouter.get("/production", ...guard, asyncRoute(async (req, res) => {
  const { companyId, branchId } = context(req);
  const [machines, orders, released, productivity] = await Promise.all([
    db.query(`SELECT COUNT(*)::integer total FROM production_machines WHERE company_id=$1 AND branch_id=$2 AND active=TRUE`, [companyId, branchId]),
    db.query(`SELECT COUNT(*)::integer total FROM production_orders WHERE company_id=$1 AND branch_id=$2`, [companyId, branchId]),
    db.query(`SELECT COUNT(*)::integer total FROM production_orders WHERE company_id=$1 AND branch_id=$2 AND status IN ('RELEASED','IN_PROGRESS')`, [companyId, branchId]),
    db.query(`SELECT COALESCE(SUM(produced_quantity),0) produced, COALESCE(SUM(rejected_quantity),0) rejected, COALESCE(SUM(worked_minutes),0) minutes FROM production_reports WHERE company_id=$1 AND branch_id=$2 AND report_date >= CURRENT_DATE - INTERVAL '30 days'`, [companyId, branchId]),
  ]);

  return res.render("production/dashboard", {
    pageTitle: "Gestão de Produção",
    summary: {
      machines: machines.rows[0].total,
      orders: orders.rows[0].total,
      activeOrders: released.rows[0].total,
      produced: productivity.rows[0].produced,
      rejected: productivity.rows[0].rejected,
      minutes: productivity.rows[0].minutes,
    },
  });
}));

productionRouter.get("/production/machines", ...guard, asyncRoute(async (req, res) => {
  const { companyId, branchId } = context(req);
  const result = await db.query(`SELECT * FROM production_machines WHERE company_id=$1 AND branch_id=$2 ORDER BY code`, [companyId, branchId]);
  return res.render("production/machines", { pageTitle: "Máquinas", machines: result.rows });
}));

productionRouter.post("/production/machines", ...guard, asyncRoute(async (req, res) => {
  const { companyId, branchId } = context(req);
  const body = req.body;
  await db.query(
    `INSERT INTO production_machines(company_id,branch_id,code,name,machine_group,manufacturer,model,serial_number,hourly_cost,efficiency_percent,capacity_minutes_day,status,active,notes)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,$13)`,
    [companyId, branchId, String(body.code).trim(), String(body.name).trim(), body.machine_group || null, body.manufacturer || null, body.model || null, body.serial_number || null, nonNegativeNumber(body.hourly_cost, "Custo por hora"), positiveNumber(body.efficiency_percent || 100, "Eficiência"), nonNegativeNumber(body.capacity_minutes_day || 480, "Capacidade diária"), body.status || "AVAILABLE", body.notes || null]
  );
  return res.redirect("/production/machines?message=" + encodeURIComponent("Máquina cadastrada."));
}));

productionRouter.get("/production/capacity", ...guard, asyncRoute(async (req, res) => {
  const { companyId, branchId } = context(req);
  const [machines, capacity] = await Promise.all([
    db.query(`SELECT id,code,name,capacity_minutes_day FROM production_machines WHERE company_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY code`, [companyId, branchId]),
    db.query(`SELECT c.*,m.code machine_code,m.name machine_name,(c.available_minutes-c.planned_stop_minutes-c.allocated_minutes) free_minutes FROM production_machine_capacity c JOIN production_machines m ON m.id=c.machine_id WHERE c.company_id=$1 AND c.branch_id=$2 ORDER BY c.capacity_date DESC,m.code`, [companyId, branchId]),
  ]);
  return res.render("production/capacity", { pageTitle: "Capacidade produtiva", machines: machines.rows, capacities: capacity.rows });
}));

productionRouter.post("/production/capacity", ...guard, asyncRoute(async (req, res) => {
  const { companyId, branchId } = context(req);
  const body = req.body;
  await db.query(
    `INSERT INTO production_machine_capacity(company_id,branch_id,machine_id,capacity_date,shift_code,available_minutes,planned_stop_minutes,allocated_minutes,notes)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT(company_id,branch_id,machine_id,capacity_date,shift_code)
     DO UPDATE SET available_minutes=EXCLUDED.available_minutes,planned_stop_minutes=EXCLUDED.planned_stop_minutes,allocated_minutes=EXCLUDED.allocated_minutes,notes=EXCLUDED.notes,updated_at=NOW()`,
    [companyId, branchId, integerId(body.machine_id, "Máquina"), body.capacity_date, body.shift_code || "GENERAL", nonNegativeNumber(body.available_minutes, "Minutos disponíveis"), nonNegativeNumber(body.planned_stop_minutes, "Parada planejada"), nonNegativeNumber(body.allocated_minutes, "Minutos alocados"), body.notes || null]
  );
  return res.redirect("/production/capacity");
}));

productionRouter.get("/production/structures", ...guard, asyncRoute(async (req, res) => {
  const { companyId, branchId } = context(req);
  const [products, structures] = await Promise.all([
    loadProducts(companyId, branchId),
    db.query(`SELECT b.*,p.code product_code,p.description product_name,(SELECT COUNT(*) FROM production_bom_items i WHERE i.bom_id=b.id) item_count FROM production_bom_headers b JOIN catalog_items p ON p.id=b.product_id WHERE b.company_id=$1 AND b.branch_id=$2 ORDER BY p.description,b.version DESC`, [companyId, branchId]),
  ]);
  return res.render("production/structures", { pageTitle: "Estruturas de produto", products, structures: structures.rows });
}));

productionRouter.post("/production/structures", ...guard, asyncRoute(async (req, res) => {
  const { companyId, branchId } = context(req);
  const body = req.body;
  await db.query(`INSERT INTO production_bom_headers(company_id,branch_id,product_id,version,description,base_quantity,valid_from,valid_to,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [companyId, branchId, integerId(body.product_id, "Produto final"), body.version || "1.0", body.description || null, positiveNumber(body.base_quantity || 1, "Quantidade base"), body.valid_from || null, body.valid_to || null, body.status || "DRAFT"]);
  return res.redirect("/production/structures");
}));

productionRouter.get("/production/structures/:id", ...guard, asyncRoute(async (req, res) => {
  const { companyId, branchId } = context(req);
  const id = integerId(req.params.id, "Estrutura");
  const [header, items, products] = await Promise.all([
    db.query(`SELECT b.*,p.code product_code,p.description product_name FROM production_bom_headers b JOIN catalog_items p ON p.id=b.product_id WHERE b.id=$1 AND b.company_id=$2 AND b.branch_id=$3`, [id, companyId, branchId]),
    db.query(`SELECT i.*,p.code component_code,p.description component_name,p.unit FROM production_bom_items i JOIN catalog_items p ON p.id=i.component_id WHERE i.bom_id=$1 AND i.company_id=$2 AND i.branch_id=$3 ORDER BY i.sequence`, [id, companyId, branchId]),
    loadProducts(companyId, branchId),
  ]);
  if (!header.rows[0]) return res.status(404).render("error", { message: "Estrutura não encontrada." });
  return res.render("production/structure-detail", { pageTitle: "Estrutura de produto", structure: header.rows[0], items: items.rows, products });
}));

productionRouter.post("/production/structures/:id/items", ...guard, asyncRoute(async (req, res) => {
  const { companyId, branchId } = context(req);
  const id = integerId(req.params.id, "Estrutura");
  const body = req.body;
  await db.query(`INSERT INTO production_bom_items(company_id,branch_id,bom_id,sequence,component_id,quantity,loss_percent,issue_type,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [companyId, branchId, id, Number(body.sequence), integerId(body.component_id, "Componente"), positiveNumber(body.quantity, "Quantidade"), nonNegativeNumber(body.loss_percent, "Perda"), body.issue_type || "MANUAL", body.notes || null]);
  return res.redirect(`/production/structures/${id}`);
}));

productionRouter.get("/production/routings", ...guard, asyncRoute(async (req, res) => {
  const { companyId, branchId } = context(req);
  const [products, routings] = await Promise.all([
    loadProducts(companyId, branchId),
    db.query(`SELECT r.*,p.code product_code,p.description product_name,(SELECT COUNT(*) FROM production_routing_operations o WHERE o.routing_id=r.id) operation_count FROM production_routings r JOIN catalog_items p ON p.id=r.product_id WHERE r.company_id=$1 AND r.branch_id=$2 ORDER BY p.description,r.version DESC`, [companyId, branchId]),
  ]);
  return res.render("production/routings", { pageTitle: "Roteiros e tempos", products, routings: routings.rows });
}));

productionRouter.post("/production/routings", ...guard, asyncRoute(async (req, res) => {
  const { companyId, branchId } = context(req);
  const body = req.body;
  await db.query(`INSERT INTO production_routings(company_id,branch_id,product_id,version,description,base_quantity,status) VALUES($1,$2,$3,$4,$5,$6,$7)`, [companyId, branchId, integerId(body.product_id, "Produto"), body.version || "1.0", body.description || null, positiveNumber(body.base_quantity || 1, "Quantidade base"), body.status || "DRAFT"]);
  return res.redirect("/production/routings");
}));

productionRouter.get("/production/routings/:id", ...guard, asyncRoute(async (req, res) => {
  const { companyId, branchId } = context(req);
  const id = integerId(req.params.id, "Roteiro");
  const [routing, operations, machines] = await Promise.all([
    db.query(`SELECT r.*,p.code product_code,p.description product_name FROM production_routings r JOIN catalog_items p ON p.id=r.product_id WHERE r.id=$1 AND r.company_id=$2 AND r.branch_id=$3`, [id, companyId, branchId]),
    db.query(`SELECT o.*,m.code machine_code,m.name machine_name FROM production_routing_operations o LEFT JOIN production_machines m ON m.id=o.machine_id WHERE o.routing_id=$1 AND o.company_id=$2 AND o.branch_id=$3 ORDER BY o.sequence`, [id, companyId, branchId]),
    db.query(`SELECT id,code,name FROM production_machines WHERE company_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY code`, [companyId, branchId]),
  ]);
  if (!routing.rows[0]) return res.status(404).render("error", { message: "Roteiro não encontrado." });
  return res.render("production/routing-detail", { pageTitle: "Roteiro de produção", routing: routing.rows[0], operations: operations.rows, machines: machines.rows });
}));

productionRouter.post("/production/routings/:id/operations", ...guard, asyncRoute(async (req, res) => {
  const { companyId, branchId } = context(req);
  const id = integerId(req.params.id, "Roteiro");
  const body = req.body;
  await db.query(`INSERT INTO production_routing_operations(company_id,branch_id,routing_id,sequence,operation_code,operation_name,machine_id,setup_minutes,run_minutes,queue_minutes,labor_quantity,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [companyId, branchId, id, Number(body.sequence), body.operation_code, body.operation_name, body.machine_id || null, nonNegativeNumber(body.setup_minutes, "Setup"), nonNegativeNumber(body.run_minutes, "Tempo de produção"), nonNegativeNumber(body.queue_minutes, "Fila"), nonNegativeNumber(body.labor_quantity || 1, "Mão de obra"), body.notes || null]);
  return res.redirect(`/production/routings/${id}`);
}));

productionRouter.get("/production/orders", ...guard, asyncRoute(async (req, res) => {
  const { companyId, branchId } = context(req);
  const [orders, products, boms, routings] = await Promise.all([
    db.query(`SELECT o.*,p.code product_code,p.description product_name FROM production_orders o JOIN catalog_items p ON p.id=o.product_id WHERE o.company_id=$1 AND o.branch_id=$2 ORDER BY o.id DESC`, [companyId, branchId]),
    loadProducts(companyId, branchId),
    db.query(`SELECT b.id,b.product_id,b.version,p.code,p.description FROM production_bom_headers b JOIN catalog_items p ON p.id=b.product_id WHERE b.company_id=$1 AND b.branch_id=$2 AND b.status='RELEASED' ORDER BY p.description`, [companyId, branchId]),
    db.query(`SELECT r.id,r.product_id,r.version,p.code,p.description FROM production_routings r JOIN catalog_items p ON p.id=r.product_id WHERE r.company_id=$1 AND r.branch_id=$2 AND r.status='RELEASED' ORDER BY p.description`, [companyId, branchId]),
  ]);
  return res.render("production/orders", { pageTitle: "Ordens de produção", orders: orders.rows, products, boms: boms.rows, routings: routings.rows });
}));

productionRouter.post("/production/orders", ...guard, asyncRoute(async (req, res) => {
  const client = await db.connect();
  const { companyId, branchId, userId } = context(req);
  const body = req.body;
  const productId = integerId(body.product_id, "Produto");
  const routingId = integerId(body.routing_id, "Roteiro");
  const quantity = positiveNumber(body.planned_quantity, "Quantidade planejada");
  try {
    await client.query("BEGIN");
    const orderNumber = body.order_number || `OP-${Date.now().toString().slice(-10)}`;
    const order = (await client.query(`INSERT INTO production_orders(company_id,branch_id,order_number,product_id,bom_id,routing_id,planned_quantity,planned_start,planned_end,priority,status,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PLANNED',$11,$12) RETURNING id`, [companyId, branchId, orderNumber, productId, body.bom_id || null, routingId, quantity, body.planned_start || null, body.planned_end || null, Number(body.priority || 5), body.notes || null, userId])).rows[0];
    const operations = await client.query(`SELECT * FROM production_routing_operations WHERE routing_id=$1 AND company_id=$2 AND branch_id=$3 ORDER BY sequence`, [routingId, companyId, branchId]);
    const routing = await client.query(`SELECT base_quantity FROM production_routings WHERE id=$1 AND company_id=$2 AND branch_id=$3`, [routingId, companyId, branchId]);
    const factor = quantity / Number(routing.rows[0]?.base_quantity || 1);
    for (const operation of operations.rows) {
      await client.query(`INSERT INTO production_order_operations(company_id,branch_id,order_id,routing_operation_id,sequence,operation_code,operation_name,machine_id,setup_minutes_planned,run_minutes_planned,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDING')`, [companyId, branchId, order.id, operation.id, operation.sequence, operation.operation_code, operation.operation_name, operation.machine_id, operation.setup_minutes, Number(operation.run_minutes) * factor]);
    }
    await client.query("COMMIT");
    return res.redirect(`/production/orders/${order.id}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

productionRouter.get("/production/orders/:id", ...guard, asyncRoute(async (req, res) => {
  const { companyId, branchId } = context(req);
  const id = integerId(req.params.id, "Ordem");
  const [order, operations, reports] = await Promise.all([
    db.query(`SELECT o.*,p.code product_code,p.description product_name FROM production_orders o JOIN catalog_items p ON p.id=o.product_id WHERE o.id=$1 AND o.company_id=$2 AND o.branch_id=$3`, [id, companyId, branchId]),
    db.query(`SELECT op.*,m.code machine_code,m.name machine_name FROM production_order_operations op LEFT JOIN production_machines m ON m.id=op.machine_id WHERE op.order_id=$1 AND op.company_id=$2 AND op.branch_id=$3 ORDER BY op.sequence`, [id, companyId, branchId]),
    db.query(`SELECT r.*,op.operation_code,m.code machine_code,u.name operator_name FROM production_reports r JOIN production_order_operations op ON op.id=r.operation_id LEFT JOIN production_machines m ON m.id=r.machine_id LEFT JOIN users u ON u.id=r.operator_id WHERE r.order_id=$1 AND r.company_id=$2 AND r.branch_id=$3 ORDER BY r.id DESC`, [id, companyId, branchId]),
  ]);
  if (!order.rows[0]) return res.status(404).render("error", { message: "Ordem não encontrada." });
  return res.render("production/order-detail", { pageTitle: "Ordem de produção", order: order.rows[0], operations: operations.rows, reports: reports.rows });
}));

productionRouter.post("/production/orders/:id/report", ...guard, asyncRoute(async (req, res) => {
  const { companyId, branchId, userId } = context(req);
  const orderId = integerId(req.params.id, "Ordem");
  const body = req.body;
  const operationId = integerId(body.operation_id, "Operação");
  const produced = nonNegativeNumber(body.produced_quantity, "Quantidade produzida");
  const rejected = nonNegativeNumber(body.rejected_quantity, "Quantidade rejeitada");
  const worked = nonNegativeNumber(body.worked_minutes, "Minutos trabalhados");
  await db.query(`INSERT INTO production_reports(company_id,branch_id,order_id,operation_id,machine_id,report_date,start_time,end_time,worked_minutes,produced_quantity,rejected_quantity,downtime_minutes,downtime_reason,operator_id,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [companyId, branchId, orderId, operationId, body.machine_id || null, body.report_date, body.start_time || null, body.end_time || null, worked, produced, rejected, nonNegativeNumber(body.downtime_minutes, "Parada"), body.downtime_reason || null, userId, body.notes || null]);
  await db.query(`UPDATE production_order_operations SET run_minutes_actual=run_minutes_actual+$1,good_quantity=good_quantity+$2,rejected_quantity=rejected_quantity+$3,status=CASE WHEN status='PENDING' THEN 'IN_PROGRESS' ELSE status END,started_at=COALESCE(started_at,NOW()) WHERE id=$4 AND order_id=$5 AND company_id=$6 AND branch_id=$7`, [worked, produced, rejected, operationId, orderId, companyId, branchId]);
  await db.query(`UPDATE production_orders SET produced_quantity=produced_quantity+$1,rejected_quantity=rejected_quantity+$2,status=CASE WHEN status IN ('PLANNED','RELEASED') THEN 'IN_PROGRESS' ELSE status END,actual_start=COALESCE(actual_start,NOW()),updated_at=NOW() WHERE id=$3 AND company_id=$4 AND branch_id=$5`, [produced, rejected, orderId, companyId, branchId]);
  return res.redirect(`/production/orders/${orderId}`);
}));

productionRouter.get("/production/productivity", ...guard, asyncRoute(async (req, res) => {
  const { companyId, branchId } = context(req);
  const result = await db.query(`SELECT m.id,m.code,m.name,COALESCE(SUM(r.worked_minutes),0) worked_minutes,COALESCE(SUM(r.downtime_minutes),0) downtime_minutes,COALESCE(SUM(r.produced_quantity),0) produced_quantity,COALESCE(SUM(r.rejected_quantity),0) rejected_quantity,CASE WHEN COALESCE(SUM(r.worked_minutes),0)>0 THEN ROUND(COALESCE(SUM(r.produced_quantity),0)/SUM(r.worked_minutes)*60,4) ELSE 0 END units_hour,CASE WHEN COALESCE(SUM(r.produced_quantity+r.rejected_quantity),0)>0 THEN ROUND(SUM(r.produced_quantity)/SUM(r.produced_quantity+r.rejected_quantity)*100,2) ELSE 0 END quality_percent FROM production_machines m LEFT JOIN production_reports r ON r.machine_id=m.id AND r.report_date BETWEEN COALESCE($3::date,CURRENT_DATE-30) AND COALESCE($4::date,CURRENT_DATE) WHERE m.company_id=$1 AND m.branch_id=$2 GROUP BY m.id,m.code,m.name ORDER BY m.code`, [companyId, branchId, req.query.start_date || null, req.query.end_date || null]);
  return res.render("production/productivity", { pageTitle: "Produtividade de máquinas", rows: result.rows, filters: req.query });
}));
