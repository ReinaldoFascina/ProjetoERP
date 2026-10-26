import { Router } from "express";
import { db } from "../database/db.js";
import { requireAuth, allow } from "../middleware/auth.js";
import { calculateMaintenanceTotals } from "../services/maintenance/costs.js";

export const maintenanceRouter = Router();
const guard = [requireAuth, allow("ADMIN", "COORDENADOR")];
const asyncRoute = (handler) => (req,res,next) => Promise.resolve(handler(req,res,next)).catch(next);
const context = (req) => ({companyId:Number(req.session.companyId),branchId:Number(req.session.branchId),userId:Number(req.session.user.id)});
const numericId = (value,name) => {const result=Number(value);if(!Number.isInteger(result)||result<=0)throw Object.assign(new Error(`${name} inválido.`),{status:400});return result;};

async function loadLookups(companyId,branchId){
 const [machines,assets,products,costCenters,responsibles,serviceTypes,users,suppliers]=await Promise.all([
  db.query("SELECT id,code,name FROM production_machines WHERE company_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY code",[companyId,branchId]),
  db.query("SELECT id,asset_number,description FROM assets WHERE company_id=$1 AND branch_id=$2 AND status NOT IN ('SOLD','WRITTEN_OFF') ORDER BY asset_number",[companyId,branchId]),
  db.query("SELECT id,code,description,unit,COALESCE(cost_price,0) cost_price FROM catalog_items WHERE company_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY description",[companyId,branchId]),
  db.query("SELECT id,code,name FROM accounting_cost_centers WHERE company_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY code",[companyId,branchId]),
  db.query("SELECT id,name FROM asset_responsibles WHERE company_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY name",[companyId,branchId]),
  db.query("SELECT * FROM maintenance_service_types WHERE company_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY name",[companyId,branchId]),
  db.query("SELECT id,name FROM users WHERE active=TRUE ORDER BY name"),
  db.query("SELECT id,corporate_name FROM clients WHERE company_id=$1 AND branch_id=$2 AND active=TRUE AND partner_type IN ('FORNECEDOR','AMBOS') ORDER BY corporate_name",[companyId,branchId]),
 ]);
 return {machines:machines.rows,patrimonialAssets:assets.rows,products:products.rows,costCenters:costCenters.rows,responsibles:responsibles.rows,serviceTypes:serviceTypes.rows,users:users.rows,suppliers:suppliers.rows};
}

maintenanceRouter.get("/maintenance",...guard,asyncRoute(async(req,res)=>{const c=context(req);const [assets,open,preventive,cost]=await Promise.all([db.query("SELECT COUNT(*)::integer total FROM maintenance_assets WHERE company_id=$1 AND branch_id=$2 AND active=TRUE",[c.companyId,c.branchId]),db.query("SELECT COUNT(*)::integer total FROM maintenance_orders WHERE company_id=$1 AND branch_id=$2 AND status NOT IN ('COMPLETED','CANCELLED')",[c.companyId,c.branchId]),db.query("SELECT COUNT(*)::integer total FROM maintenance_plans WHERE company_id=$1 AND branch_id=$2 AND active=TRUE AND next_execution_date<=CURRENT_DATE+INTERVAL '30 days'",[c.companyId,c.branchId]),db.query("SELECT COALESCE(SUM(total_cost),0) total FROM maintenance_orders WHERE company_id=$1 AND branch_id=$2 AND actual_end>=CURRENT_DATE-INTERVAL '30 days'",[c.companyId,c.branchId])]);res.render("maintenance/dashboard",{pageTitle:"Gestão de Manutenção",summary:{assets:assets.rows[0].total,openOrders:open.rows[0].total,duePlans:preventive.rows[0].total,cost30:cost.rows[0].total}})}));

maintenanceRouter.get("/maintenance/assets",...guard,asyncRoute(async(req,res)=>{const c=context(req);const rows=await db.query(`SELECT a.*,m.code machine_code,p.asset_number,cc.code cost_center_code,r.name responsible_name FROM maintenance_assets a LEFT JOIN production_machines m ON m.id=a.production_machine_id LEFT JOIN assets p ON p.id=a.patrimonial_asset_id LEFT JOIN accounting_cost_centers cc ON cc.id=a.cost_center_id LEFT JOIN asset_responsibles r ON r.id=a.responsible_id WHERE a.company_id=$1 AND a.branch_id=$2 ORDER BY a.code`,[c.companyId,c.branchId]);res.render("maintenance/assets",{pageTitle:"Equipamentos e bens mantidos",assets:rows.rows,...await loadLookups(c.companyId,c.branchId)})}));
maintenanceRouter.post("/maintenance/assets",...guard,asyncRoute(async(req,res)=>{const c=context(req),b=req.body;await db.query(`INSERT INTO maintenance_assets(company_id,branch_id,code,name,asset_type,production_machine_id,patrimonial_asset_id,catalog_item_id,manufacturer,model,serial_number,plate_number,odometer,hour_meter,location,cost_center_id,responsible_id,status,criticality,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,[c.companyId,c.branchId,b.code,b.name,b.asset_type,b.production_machine_id||null,b.patrimonial_asset_id||null,b.catalog_item_id||null,b.manufacturer||null,b.model||null,b.serial_number||null,b.plate_number||null,Number(b.odometer||0),Number(b.hour_meter||0),b.location||null,b.cost_center_id||null,b.responsible_id||null,b.status||"AVAILABLE",b.criticality||"MEDIUM",b.notes||null]);res.redirect("/maintenance/assets")}));

maintenanceRouter.get("/maintenance/service-types",...guard,asyncRoute(async(req,res)=>{const c=context(req);const rows=await db.query("SELECT * FROM maintenance_service_types WHERE company_id=$1 AND branch_id=$2 ORDER BY code",[c.companyId,c.branchId]);res.render("maintenance/service-types",{pageTitle:"Tipos de manutenção",serviceTypes:rows.rows})}));
maintenanceRouter.post("/maintenance/service-types",...guard,asyncRoute(async(req,res)=>{const c=context(req),b=req.body;await db.query("INSERT INTO maintenance_service_types(company_id,branch_id,code,name,maintenance_type,default_duration_minutes)VALUES($1,$2,$3,$4,$5,$6)",[c.companyId,c.branchId,b.code,b.name,b.maintenance_type,Number(b.default_duration_minutes||0)]);res.redirect("/maintenance/service-types")}));

maintenanceRouter.get(
  "/maintenance/plans",
  ...guard,
  asyncRoute(async (req, res) => {
    const {
      companyId,
      branchId,
    } = context(req);

    const [
      plansResult,
      lookupData,
    ] = await Promise.all([
      db.query(
        `
          SELECT
            plan.*,

            maintenance_asset.code
              AS asset_code,

            maintenance_asset.name
              AS asset_name,

            maintenance_asset.asset_type,

            service_type.code
              AS service_code,

            service_type.name
              AS service_name,

            service_type.maintenance_type,

            CASE
              WHEN plan.next_execution_date
                   IS NOT NULL
                   AND plan.next_execution_date
                       < CURRENT_DATE
                THEN TRUE
              ELSE FALSE
            END AS date_overdue

          FROM maintenance_plans plan

          LEFT JOIN maintenance_assets
            maintenance_asset
            ON maintenance_asset.id =
               plan.maintenance_asset_id
           AND maintenance_asset.company_id =
               plan.company_id
           AND maintenance_asset.branch_id =
               plan.branch_id

          INNER JOIN maintenance_service_types
            service_type
            ON service_type.id =
               plan.service_type_id
           AND service_type.company_id =
               plan.company_id
           AND service_type.branch_id =
               plan.branch_id

          WHERE plan.company_id = $1
            AND plan.branch_id = $2

          ORDER BY
            plan.active DESC,
            plan.next_execution_date
              NULLS LAST,
            plan.code
        `,
        [
          companyId,
          branchId,
        ]
      ),

      loadLookups(
        companyId,
        branchId
      ),
    ]);

    return res.render(
      "maintenance/plans",
      {
        pageTitle:
          "Planos de manutenção preventiva",

        plans:
          plansResult.rows,

        /*
         * Inclui assets, serviceTypes
         * e os demais cadastros.
         */
        ...lookupData,
      }
    );
  })
);

maintenanceRouter.post("/maintenance/plans",...guard,asyncRoute(async(req,res)=>{const c=context(req),b=req.body;await db.query(`INSERT INTO maintenance_plans(company_id,branch_id,code,name,maintenance_asset_id,asset_type,service_type_id,trigger_type,interval_days,interval_odometer,interval_hours,next_execution_date,next_odometer,next_hour_meter,priority,instructions) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,[c.companyId,c.branchId,b.code,b.name,b.maintenance_asset_id||null,b.asset_type||null,numericId(b.service_type_id,"Tipo de serviço"),b.trigger_type,Number(b.interval_days||0)||null,Number(b.interval_odometer||0)||null,Number(b.interval_hours||0)||null,b.next_execution_date||null,Number(b.next_odometer||0)||null,Number(b.next_hour_meter||0)||null,b.priority||"NORMAL",b.instructions||null]);res.redirect("/maintenance/plans")}));

maintenanceRouter.get(
  "/maintenance/orders",
  ...guard,
  asyncRoute(async (req, res) => {
    const {
      companyId,
      branchId,
    } = context(req);

    const {
      status = "",
      maintenance_type = "",
      q = "",
    } = req.query;

    const params = [
      companyId,
      branchId,
    ];

    const where = [
      "orders.company_id = $1",
      "orders.branch_id = $2",
    ];

    if (status) {
      params.push(status);

      where.push(
        `orders.status = $${params.length}`
      );
    }

    if (maintenance_type) {
      params.push(maintenance_type);

      where.push(
        `orders.maintenance_type = $${params.length}`
      );
    }

    if (q) {
      params.push(`%${q}%`);

      where.push(`
        (
          orders.order_number
            ILIKE $${params.length}
          OR
          orders.title
            ILIKE $${params.length}
          OR
          maintenance_asset.code
            ILIKE $${params.length}
          OR
          maintenance_asset.name
            ILIKE $${params.length}
        )
      `);
    }

    const [
      ordersResult,
      assetsResult,
      lookupData,
    ] = await Promise.all([
      db.query(
        `
          SELECT
            orders.*,

            maintenance_asset.code
              AS asset_code,

            maintenance_asset.name
              AS asset_name,

            maintenance_asset.asset_type,

            service_type.code
              AS service_code,

            service_type.name
              AS service_name,

            cost_center.code
              AS cost_center_code,

            cost_center.name
              AS cost_center_name,

            assigned_user.name
              AS assigned_to_name,

            supplier.corporate_name
              AS supplier_name

          FROM maintenance_orders orders

          INNER JOIN maintenance_assets
            maintenance_asset
            ON maintenance_asset.id =
               orders.maintenance_asset_id
           AND maintenance_asset.company_id =
               orders.company_id
           AND maintenance_asset.branch_id =
               orders.branch_id

          LEFT JOIN maintenance_service_types
            service_type
            ON service_type.id =
               orders.service_type_id

          LEFT JOIN accounting_cost_centers
            cost_center
            ON cost_center.id =
               orders.cost_center_id

          LEFT JOIN users assigned_user
            ON assigned_user.id =
               orders.assigned_to

          LEFT JOIN clients supplier
            ON supplier.id =
               orders.supplier_id

          WHERE ${where.join(" AND ")}

          ORDER BY
            CASE orders.status
              WHEN 'IN_PROGRESS' THEN 1
              WHEN 'APPROVED' THEN 2
              WHEN 'PLANNED' THEN 3
              WHEN 'OPEN' THEN 4
              WHEN 'PAUSED' THEN 5
              WHEN 'COMPLETED' THEN 6
              WHEN 'CANCELLED' THEN 7
              ELSE 8
            END,

            CASE orders.priority
              WHEN 'URGENT' THEN 1
              WHEN 'HIGH' THEN 2
              WHEN 'NORMAL' THEN 3
              WHEN 'LOW' THEN 4
              ELSE 5
            END,

            orders.id DESC
        `,
        params
      ),

      /*
       * Esta consulta fornece a variável
       * `assets` usada no formulário EJS.
       */
      db.query(
        `
          SELECT
            maintenance_asset.id,
            maintenance_asset.code,
            maintenance_asset.name,
            maintenance_asset.asset_type,
            maintenance_asset.status,
            maintenance_asset.odometer,
            maintenance_asset.hour_meter,
            maintenance_asset.cost_center_id,

            cost_center.code
              AS cost_center_code,

            cost_center.name
              AS cost_center_name

          FROM maintenance_assets
            maintenance_asset

          LEFT JOIN accounting_cost_centers
            cost_center
            ON cost_center.id =
               maintenance_asset.cost_center_id

          WHERE maintenance_asset.company_id = $1
            AND maintenance_asset.branch_id = $2
            AND maintenance_asset.active = TRUE
            AND maintenance_asset.status
                <> 'DISABLED'

          ORDER BY
            maintenance_asset.code,
            maintenance_asset.name
        `,
        [
          companyId,
          branchId,
        ]
      ),

      loadLookups(
        companyId,
        branchId
      ),
    ]);

    return res.render(
      "maintenance/orders",
      {
        pageTitle:
          "Ordens de manutenção",

        orders:
          ordersResult.rows,

        /*
         * Esta variável estava ausente.
         */
        assets:
          assetsResult.rows,

        filters: {
          status,
          maintenance_type,
          q,
        },

        ...lookupData,
      }
    );
  })
);maintenanceRouter.post("/maintenance/orders",...guard,asyncRoute(async(req,res)=>{const c=context(req),b=req.body,number=b.order_number||`OM-${Date.now().toString().slice(-10)}`;const row=(await db.query(`INSERT INTO maintenance_orders(company_id,branch_id,order_number,maintenance_asset_id,plan_id,service_type_id,maintenance_type,title,problem_description,priority,status,scheduled_start,scheduled_end,odometer,hour_meter,supplier_id,cost_center_id,requested_by,assigned_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'OPEN',$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,[c.companyId,c.branchId,number,numericId(b.maintenance_asset_id,"Equipamento"),b.plan_id||null,b.service_type_id||null,b.maintenance_type,b.title,b.problem_description||null,b.priority||"NORMAL",b.scheduled_start||null,b.scheduled_end||null,Number(b.odometer||0)||null,Number(b.hour_meter||0)||null,b.supplier_id||null,b.cost_center_id||null,c.userId,b.assigned_to||null])).rows[0];res.redirect(`/maintenance/orders/${row.id}`)}));

maintenanceRouter.get("/maintenance/reports/costs",...guard,asyncRoute(async(req,res)=>{const c=context(req);const rows=await db.query(`SELECT a.code,a.name,a.asset_type,COUNT(o.id)::integer order_count,COALESCE(SUM(o.parts_cost),0) parts_cost,COALESCE(SUM(o.internal_labor_cost),0) labor_cost,COALESCE(SUM(o.external_service_cost),0) external_cost,COALESCE(SUM(o.total_cost),0) total_cost,COALESCE(SUM(o.downtime_minutes),0) downtime FROM maintenance_assets a LEFT JOIN maintenance_orders o ON o.maintenance_asset_id=a.id AND o.status='COMPLETED' WHERE a.company_id=$1 AND a.branch_id=$2 GROUP BY a.id,a.code,a.name,a.asset_type ORDER BY total_cost DESC`,[c.companyId,c.branchId]);res.render("maintenance/cost-report",{pageTitle:"Custos de manutenção",rows:rows.rows})}));

maintenanceRouter.get("/maintenance/orders/:id(\\d+)",...guard,asyncRoute(async(req,res)=>{const c=context(req),orderId=numericId(req.params.id,"Ordem");const [order,parts,labor,components]=await Promise.all([db.query(`SELECT o.*,a.code asset_code,a.name asset_name,a.asset_type,a.odometer current_odometer,a.hour_meter current_hour_meter,s.name service_name,cc.code cost_center_code FROM maintenance_orders o JOIN maintenance_assets a ON a.id=o.maintenance_asset_id LEFT JOIN maintenance_service_types s ON s.id=o.service_type_id LEFT JOIN accounting_cost_centers cc ON cc.id=o.cost_center_id WHERE o.id=$1 AND o.company_id=$2 AND o.branch_id=$3`,[orderId,c.companyId,c.branchId]),db.query(`SELECT p.*,i.code item_code,i.description item_name FROM maintenance_order_parts p JOIN catalog_items i ON i.id=p.catalog_item_id WHERE p.order_id=$1 ORDER BY p.id`,[orderId]),db.query(`SELECT l.*,u.name technician_name FROM maintenance_order_labor l LEFT JOIN users u ON u.id=l.technician_id WHERE l.order_id=$1 ORDER BY l.work_date,l.id`,[orderId]),db.query(`SELECT c.*,i.code item_code,i.description item_name FROM maintenance_asset_components c LEFT JOIN catalog_items i ON i.id=c.catalog_item_id WHERE c.maintenance_asset_id=(SELECT maintenance_asset_id FROM maintenance_orders WHERE id=$1) AND c.status='INSTALLED' ORDER BY c.component_type,c.position`,[orderId])]);if(!order.rows[0])return res.status(404).render("error",{message:"Ordem de manutenção não encontrada."});res.render("maintenance/order-detail",{pageTitle:`Ordem ${order.rows[0].order_number}`,order:order.rows[0],parts:parts.rows,labor:labor.rows,components:components.rows,...await loadLookups(c.companyId,c.branchId)})}));

maintenanceRouter.post("/maintenance/orders/:id(\\d+)/parts",...guard,asyncRoute(async(req,res)=>{const c=context(req),orderId=numericId(req.params.id,"Ordem"),b=req.body,qty=Number(b.quantity),unit=Number(b.unit_cost||0);await db.query(`INSERT INTO maintenance_order_parts(company_id,branch_id,order_id,catalog_item_id,quantity,unit_cost,total_cost,old_part_serial,new_part_serial,position,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[c.companyId,c.branchId,orderId,numericId(b.catalog_item_id,"Peça"),qty,unit,Number((qty*unit).toFixed(2)),b.old_part_serial||null,b.new_part_serial||null,b.position||null,b.notes||null]);res.redirect(`/maintenance/orders/${orderId}`)}));
maintenanceRouter.post("/maintenance/orders/:id(\\d+)/labor",...guard,asyncRoute(async(req,res)=>{const c=context(req),orderId=numericId(req.params.id,"Ordem"),b=req.body,minutes=Number(b.minutes_worked),hourly=Number(b.hourly_cost||0);await db.query(`INSERT INTO maintenance_order_labor(company_id,branch_id,order_id,technician_id,work_date,minutes_worked,hourly_cost,total_cost,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[c.companyId,c.branchId,orderId,b.technician_id||null,b.work_date,minutes,hourly,Number((minutes/60*hourly).toFixed(2)),b.description||null]);res.redirect(`/maintenance/orders/${orderId}`)}));
maintenanceRouter.post("/maintenance/orders/:id(\\d+)/complete",...guard,asyncRoute(async(req,res)=>{const c=context(req),orderId=numericId(req.params.id,"Ordem"),b=req.body,client=await db.connect();try{await client.query("BEGIN");const [parts,labor,orderResult]=await Promise.all([client.query("SELECT * FROM maintenance_order_parts WHERE order_id=$1",[orderId]),client.query("SELECT * FROM maintenance_order_labor WHERE order_id=$1",[orderId]),client.query("SELECT * FROM maintenance_orders WHERE id=$1 AND company_id=$2 AND branch_id=$3 FOR UPDATE",[orderId,c.companyId,c.branchId])]);const order=orderResult.rows[0];if(!order)throw Object.assign(new Error("Ordem não encontrada."),{status:404});const totals=calculateMaintenanceTotals({parts:parts.rows,labor:labor.rows,externalServiceCost:b.external_service_cost,otherCost:b.other_cost});await client.query(`UPDATE maintenance_orders SET diagnosis=$1,solution=$2,status='COMPLETED',actual_start=COALESCE(actual_start,NOW()),actual_end=NOW(),downtime_minutes=$3,parts_cost=$4,internal_labor_cost=$5,external_service_cost=$6,other_cost=$7,total_cost=$8,closed_by=$9,updated_at=NOW() WHERE id=$10`,[b.diagnosis||null,b.solution||null,Number(b.downtime_minutes||0),totals.partsCost,totals.internalLaborCost,totals.externalServiceCost,totals.otherCost,totals.totalCost,c.userId,orderId]);await client.query(`UPDATE maintenance_assets SET status='AVAILABLE',odometer=GREATEST(odometer,COALESCE($1,odometer)),hour_meter=GREATEST(hour_meter,COALESCE($2,hour_meter)),updated_at=NOW() WHERE id=$3`,[order.odometer,order.hour_meter,order.maintenance_asset_id]);if(order.plan_id){await client.query(`UPDATE maintenance_plans SET last_execution_date=CURRENT_DATE,last_odometer=$1,last_hour_meter=$2,next_execution_date=CASE WHEN interval_days IS NOT NULL THEN CURRENT_DATE+interval_days ELSE next_execution_date END,next_odometer=CASE WHEN interval_odometer IS NOT NULL THEN COALESCE($1,0)+interval_odometer ELSE next_odometer END,next_hour_meter=CASE WHEN interval_hours IS NOT NULL THEN COALESCE($2,0)+interval_hours ELSE next_hour_meter END,updated_at=NOW() WHERE id=$3`,[order.odometer,order.hour_meter,order.plan_id]);}await client.query("COMMIT");res.redirect(`/maintenance/orders/${orderId}`)}catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}}));
