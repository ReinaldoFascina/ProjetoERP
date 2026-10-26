import { db } from "../../../database/db.js";

const definitions = [
  {name:"consultar_estoque",description:"Consulta saldo, reserva e disponibilidade de um produto.",parameters:{type:"object",properties:{productCode:{type:"string"}},required:["productCode"]}},
  {name:"consultar_financeiro",description:"Consulta títulos financeiros por tipo e situação.",parameters:{type:"object",properties:{type:{type:"string",enum:["PAYABLE","RECEIVABLE"]},status:{type:"string"},days:{type:"integer"}},required:["type"]}},
  {name:"consultar_manutencao",description:"Consulta histórico, custos e ordens de um equipamento.",parameters:{type:"object",properties:{assetCode:{type:"string"},months:{type:"integer"}},required:["assetCode"]}},
  {name:"consultar_processo_comex",description:"Consulta processo COMEX, embarques, documentos, custos e pendências.",parameters:{type:"object",properties:{processNumber:{type:"string"}},required:["processNumber"]}},
  {name:"validar_duimp",description:"Valida uma DUIMP e retorna bloqueios e obrigações.",parameters:{type:"object",properties:{duimpId:{type:"integer"}},required:["duimpId"]}},
  {name:"criar_rascunho_manutencao",description:"Prepara uma proposta auditável de ordem de manutenção, sem criar a ordem definitiva.",parameters:{type:"object",properties:{maintenanceAssetId:{type:"integer"},title:{type:"string"},maintenanceType:{type:"string"},priority:{type:"string"},problemDescription:{type:"string"}},required:["maintenanceAssetId","title","maintenanceType"]}},
];
export const toolDefinitions = definitions.map((item)=>({type:"function",function:item}));

async function consultarEstoque(args,ctx){
  const product=(await db.query(`SELECT id,code,description,unit FROM catalog_items WHERE company_id=$1 AND branch_id=$2 AND code=$3 LIMIT 1`,[ctx.companyId,ctx.branchId,args.productCode])).rows[0];
  if(!product)return {found:false,message:"Produto não encontrado."};
  const balances=await db.query(`SELECT w.name warehouse,COALESCE(b.quantity,0) physical,COALESCE(b.reserved_quantity,0) reserved,COALESCE(b.quantity,0)-COALESCE(b.reserved_quantity,0) available FROM stock_balances b JOIN stock_warehouses w ON w.id=b.warehouse_id WHERE b.company_id=$1 AND b.branch_id=$2 AND b.catalog_item_id=$3 ORDER BY w.name`,[ctx.companyId,ctx.branchId,product.id]);
  return {found:true,product,balances:balances.rows,links:[{label:"Ver posição de estoque",url:`/stock-management/stock?product=${encodeURIComponent(product.code)}`} ]};
}

async function consultarFinanceiro(args,ctx){
  const days=Math.min(Math.max(Number(args.days||30),1),365);
  const rows=await db.query(`SELECT id,type,description,due_date,amount,paid_amount,status,client_id FROM financial_entries WHERE company_id=$1 AND branch_id=$2 AND type=$3 AND ($4='' OR status=$4) AND due_date<=CURRENT_DATE+$5::integer ORDER BY due_date LIMIT 100`,[ctx.companyId,ctx.branchId,args.type,args.status||"",days]);
  const total=rows.rows.reduce((sum,row)=>sum+Number(row.amount||0)-Number(row.paid_amount||0),0);
  return {count:rows.rowCount,totalOpen:Number(total.toFixed(2)),entries:rows.rows,links:[{label:"Abrir Financeiro",url:"/finance"}]};
}

async function consultarManutencao(args,ctx){
  const months=Math.min(Math.max(Number(args.months||12),1),60);
  const asset=(await db.query(`SELECT * FROM maintenance_assets WHERE company_id=$1 AND branch_id=$2 AND code=$3 LIMIT 1`,[ctx.companyId,ctx.branchId,args.assetCode])).rows[0];
  if(!asset)return {found:false,message:"Equipamento não encontrado."};
  const orders=await db.query(`SELECT id,order_number,maintenance_type,title,status,priority,requested_at,actual_end,total_cost,downtime_minutes FROM maintenance_orders WHERE company_id=$1 AND branch_id=$2 AND maintenance_asset_id=$3 AND requested_at>=CURRENT_DATE-($4::text||' months')::interval ORDER BY id DESC LIMIT 50`,[ctx.companyId,ctx.branchId,asset.id,months]);
  const totalCost=orders.rows.reduce((sum,row)=>sum+Number(row.total_cost||0),0);
  return {found:true,asset,orderCount:orders.rowCount,totalCost:Number(totalCost.toFixed(2)),orders:orders.rows,links:[{label:"Abrir equipamento",url:"/maintenance/assets"}]};
}

async function consultarComex(args,ctx){
  const process=(await db.query(`SELECT * FROM comex_processes WHERE company_id=$1 AND branch_id=$2 AND process_number=$3 LIMIT 1`,[ctx.companyId,ctx.branchId,args.processNumber])).rows[0];
  if(!process)return {found:false,message:"Processo COMEX não encontrado."};
  const [shipments,documents,costs]=await Promise.all([
    db.query(`SELECT id,shipment_number,transport_mode,booking_number,eta,etd,free_time_days,status FROM comex_shipments WHERE process_id=$1 ORDER BY id`,[process.id]),
    db.query(`SELECT document_type,document_number,expiry_date,status FROM comex_documents WHERE process_id=$1 ORDER BY id`,[process.id]),
    db.query(`SELECT cost_type,description,amount_brl,status FROM comex_costs WHERE process_id=$1 ORDER BY id`,[process.id]),
  ]);
  const totalCost=costs.rows.reduce((sum,row)=>sum+Number(row.amount_brl||0),0);
  return {found:true,process,shipments:shipments.rows,documents:documents.rows,costs:costs.rows,totalCost:Number(totalCost.toFixed(2)),links:[{label:"Abrir processo",url:`/comex/processes/${process.id}`}]};
}

async function validarDuimp(args,ctx){
  const declaration=(await db.query(`SELECT d.*,p.process_number,ip.importer_document,cl.corporate_name importer_name FROM comex_duimp_declarations d JOIN comex_processes p ON p.id=d.process_id JOIN comex_importer_profiles ip ON ip.id=d.importer_profile_id JOIN clients cl ON cl.id=ip.client_id WHERE d.id=$1 AND d.company_id=$2 AND d.branch_id=$3`,[Number(args.duimpId),ctx.companyId,ctx.branchId])).rows[0];
  if(!declaration)return {found:false,message:"DUIMP não encontrada."};
  const [items,obligations]=await Promise.all([
    db.query(`SELECT i.*,cp.internal_product_code,cp.siscomex_product_code,cp.version_number,cp.ncm_code,cp.status product_status FROM comex_duimp_items i JOIN comex_import_product_catalog cp ON cp.id=i.catalog_product_id WHERE i.duimp_id=$1 ORDER BY i.sequence`,[declaration.id]),
    db.query(`SELECT * FROM comex_obligations WHERE duimp_id=$1 ORDER BY id`,[declaration.id]),
  ]);
  const blockers=[];
  if(!declaration.dispatch_unit_code)blockers.push("Unidade de despacho não informada.");
  if(!declaration.entry_unit_code)blockers.push("Unidade de entrada não informada.");
  if(!declaration.operation_consumption_state||!declaration.operation_consumption_city_code)blockers.push("Local da operação de consumo incompleto.");
  if(!items.rowCount)blockers.push("DUIMP sem itens.");
  items.rows.forEach(item=>{if(!item.siscomex_product_code||item.product_status!=="ACTIVE")blockers.push(`Item ${item.sequence}: produto não está ativo no catálogo.`);});
  obligations.rows.filter(o=>o.required_before_submission&&!["COMPLETED","WAIVED"].includes(o.status)).forEach(o=>blockers.push(`Obrigação pendente: ${o.description}.`));
  return {found:true,declaration,items:items.rows,obligations:obligations.rows,ready:blockers.length===0,blockers,links:[{label:"Abrir DUIMP",url:`/comex/duimp/${declaration.id}`} ]};
}

async function criarRascunhoManutencao(args,ctx){
  const asset=(await db.query(`SELECT id,code,name,cost_center_id FROM maintenance_assets WHERE id=$1 AND company_id=$2 AND branch_id=$3`,[Number(args.maintenanceAssetId),ctx.companyId,ctx.branchId])).rows[0];
  if(!asset)throw new Error("Equipamento não encontrado para a empresa e filial.");
  return {actionProposal:{actionType:"CREATE_MAINTENANCE_DRAFT",entityType:"MAINTENANCE_ASSET",entityId:asset.id,title:`Criar rascunho de manutenção para ${asset.code}`,description:args.problemDescription||args.title,riskLevel:"MEDIUM",payload:{maintenanceAssetId:asset.id,maintenanceType:args.maintenanceType,title:args.title,priority:args.priority||"NORMAL",problemDescription:args.problemDescription||null,costCenterId:asset.cost_center_id}}};
}

export const toolHandlers={
  consultar_estoque:consultarEstoque,
  consultar_financeiro:consultarFinanceiro,
  consultar_manutencao:consultarManutencao,
  consultar_processo_comex:consultarComex,
  validar_duimp:validarDuimp,
  criar_rascunho_manutencao:criarRascunhoManutencao,
};
