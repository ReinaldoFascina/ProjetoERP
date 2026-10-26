const ROLE_TOOLS = {
  ADMIN: ["*"],
  COORDENADOR: [
    "consultar_estoque","consultar_financeiro","consultar_manutencao",
    "consultar_processo_comex","validar_duimp","criar_rascunho_manutencao"
  ],
  CLIENTE: ["consultar_financeiro"],
  TECNICO: ["consultar_manutencao","criar_rascunho_manutencao"],
};

export function assertToolPermission({ role, toolName }) {
  const allowed = ROLE_TOOLS[role] || [];
  if (!allowed.includes("*") && !allowed.includes(toolName)) {
    throw Object.assign(new Error(`Seu perfil não possui permissão para utilizar ${toolName}.`),{status:403,code:"AI_TOOL_DENIED"});
  }
}

export function sessionContext(req) {
  const companyId=Number(req.session.companyId);
  const branchId=Number(req.session.branchId);
  const userId=Number(req.session.user?.id);
  const role=String(req.session.user?.role||"");
  if(!Number.isInteger(companyId)||!Number.isInteger(branchId)||!Number.isInteger(userId)) {
    throw Object.assign(new Error("Contexto de empresa, filial ou usuário inválido."),{status:401});
  }
  return {companyId,branchId,userId,role};
}
