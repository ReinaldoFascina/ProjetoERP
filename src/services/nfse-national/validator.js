const digits=(v)=>String(v||'').replace(/\D/g,'');
const positive=(v)=>Number(v||0)>0;
const dateOnly=(v)=>v?new Date(v).toISOString().slice(0,10):'';

export function validateMovementFiscal(data,{today=new Date()}={}){
 const {movement,items,company,branch,customer}=data;const errors=[],warnings=[];
 if(!movement)errors.push('Movimento não encontrado.');
 if(!items?.length)errors.push('Movimento sem itens.');
 if(movement?.status!=='CONFIRMADO')errors.push('O movimento precisa estar CONFIRMADO.');
 if(!company?.document&&!branch?.document)errors.push('CNPJ do prestador não informado.');
 if(!branch?.municipal_registration&&!company?.municipal_registration)errors.push('Inscrição municipal do prestador não informada.');
 if(!branch?.city||!branch?.state)errors.push('Cidade e UF da filial não informadas.');
 if(!customer?.document)errors.push('CPF/CNPJ do tomador não informado.');
 if(!customer?.corporate_name)errors.push('Nome ou razão social do tomador não informado.');
 if(!movement?.competence)errors.push('Competência não informada.');
 if(movement?.competence&&dateOnly(movement.competence)>dateOnly(today))errors.push('A competência não pode estar no futuro.');
 if(!movement?.service_location_code||digits(movement.service_location_code).length!==7)errors.push('Código IBGE do local da prestação inválido.');
 if(!movement?.incidence_location_code||digits(movement.incidence_location_code).length!==7)errors.push('Código IBGE de incidência inválido.');

 let services=0,ibs=0,cbs=0,pis=0,cofins=0;
 for(const [index,item] of (items||[]).entries()){
  const pos=index+1,prefix=`Item ${pos}`;
  if(item.fiscal_nature==='PRODUTO_FISICO')errors.push(`${prefix}: produto físico não pode ser transmitido na NFS-e.`);
  if(!['SERVICO','BEM_IMATERIAL','LOCACAO'].includes(item.fiscal_nature))errors.push(`${prefix}: natureza fiscal inválida.`);
  if(!item.description)errors.push(`${prefix}: descrição obrigatória.`);
  if(!positive(item.quantity)||!positive(item.unit_price))errors.push(`${prefix}: quantidade e valor unitário devem ser positivos.`);
  if(!item.nbs_code)errors.push(`${prefix}: código NBS obrigatório.`);
  if(!item.national_service_code)errors.push(`${prefix}: código de tributação nacional obrigatório.`);
  if(!item.lc116_code&&item.fiscal_nature==='SERVICO')errors.push(`${prefix}: subitem LC 116 obrigatório para serviço sujeito ao ISS.`);
  if(digits(item.municipality_code).length!==7)errors.push(`${prefix}: município de incidência inválido.`);
  const total=Number(item.total||0),issBase=Number(item.iss_base||0),issRate=Number(item.iss_rate||0),issValue=Number(item.iss_value||0);
  if(Math.abs(issValue-(issBase*issRate/100))>0.02)errors.push(`${prefix}: valor do ISS não confere com base e alíquota.`);
  if(movement.ibscbs_required){
   if(!item.ibscbs_tax_class)errors.push(`${prefix}: classificação tributária IBS/CBS obrigatória.`);
   if(!item.ibscbs_operation_indicator)errors.push(`${prefix}: indicador da operação IBS/CBS obrigatório.`);
   const base=Number(item.ibscbs_base||0),ibsCalc=base*(Number(item.ibs_state_rate||0)+Number(item.ibs_municipal_rate||0))/100,cbsCalc=base*Number(item.cbs_rate||0)/100;
   const ibsValue=Number(item.ibs_state_value||0)+Number(item.ibs_municipal_value||0);
   if(Math.abs(ibsValue-ibsCalc)>0.02)errors.push(`${prefix}: IBS não confere com base e alíquotas.`);
   if(Math.abs(Number(item.cbs_value||0)-cbsCalc)>0.02)errors.push(`${prefix}: CBS não confere com base e alíquota.`);
  }
  if(Number(item.unconditional_discount||0)>total)errors.push(`${prefix}: desconto incondicional maior que o item.`);
  services+=total;ibs+=Number(item.ibs_state_value||0)+Number(item.ibs_municipal_value||0);cbs+=Number(item.cbs_value||0);pis+=Number(item.pis_value||0);cofins+=Number(item.cofins_value||0);
 }
 if(Math.abs(services-Number(movement.service_total||0))>0.02)errors.push('Total de serviços diverge da soma dos itens fiscais.');
 if(Math.abs(ibs-Number(movement.ibs_total||0))>0.02)errors.push('Total do IBS diverge dos itens.');
 if(Math.abs(cbs-Number(movement.cbs_total||0))>0.02)errors.push('Total da CBS diverge dos itens.');
 if(Math.abs(pis-Number(movement.pis_total||0))>0.02)errors.push('Total do PIS diverge dos itens.');
 if(Math.abs(cofins-Number(movement.cofins_total||0))>0.02)errors.push('Total da COFINS diverge dos itens.');
 if(!movement.ibscbs_required)warnings.push('Grupo IBS/CBS marcado como não obrigatório para este movimento. Verifique o cronograma fiscal vigente.');
 return{valid:errors.length===0,errors,warnings,totals:{services,ibs,cbs,pis,cofins}};
}
