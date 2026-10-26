export const systemModules = {
  technical: {
    key: "technical",
    code: "AT",
    name:
      "Gestão de Atendimento Técnico",
    shortName:
      "Atendimento Técnico",
    description:
      "Chamados, agenda, técnicos, RATs, horas e autorizações.",
    home: "/dashboardTickets",
    roles: [
      "ADMIN",
      "COORDENADOR",
      "TECNICO",
      "CLIENTE",
    ],
  },

  stock: {
    key: "stock",
    code: "ES",
    name:
      "Gestão de Estoque, Compras e Faturamento",
    shortName:
      "Estoque",
    description:
      "Movimentos, compras, vendas, estoque, tributos e documentos eletrônicos.",
    home:
      "/stock-management/dashboard",
    roles: [
      "ADMIN",
      "COORDENADOR",
      "CLIENTE",
    ],
  },

  finance: {
    key: "finance",
    code: "FI",
    name:
      "Gestão Financeira e Bancária",
    shortName:
      "Financeiro",
    description:
      "Bancos, títulos, caixas, baixas e conciliação.",
    home: "/finance",
    roles: [
      "ADMIN",
      "COORDENADOR",
      "CLIENTE",
    ],
  },

  fiscal: {
    key: "fiscal",
    code: "FS",
    name:
      "Gestão Fiscal",
    shortName:
      "Fiscal",
    description:
      "Movimentos fiscais, NFS-e, tributos, escrituração, livros e apuração.",
    home: "/fiscal",
    roles: [
      "ADMIN",
      "COORDENADOR",
    ],
  },

  production: {
    key: "production",
    code: "MR",
    name:
      "Gestão de Produção",
    shortName:
      "Produção",
    description:
      "Planejamento, execução e controle da produção.",
    home: "/production",
    roles: [
      "ADMIN",
      "COORDENADOR",
    ],
  },

  assets: {
    key: "assets",
    code: "PT",
    name:
      "Gestão de Ativos e Patrimônio",
    shortName:
      "Ativos e Patrimônio",
    description:
      "Controle e gestão dos bens e ativos da organização.",
    home: "/assets",
    roles: [
      "ADMIN",
      "COORDENADOR",
    ],
  },

  maintenance: {
    key: "maintenance",
    code: "MN",
    name:
      "Gestão de Manutenção",
    shortName:
      "Manutenção",
    description:
      "Controle e gestão das atividades de manutenção.",
    home: "/maintenance",
    roles: [
      "ADMIN",
      "COORDENADOR",
    ],
  },

  empr: {
    key: "empr",
    code: "EM",
    name:
      "Gestão de Empreendimentos",
    shortName:
      "Empreendimentos",
    description:
      "Controle e gestão das atividades de empreendimentos.",
    home: "/real-estate",
    roles: [
      "ADMIN",
      "COORDENADOR",
    ],
  },
  accounting: {
    key: "accounting",
    code: "CT",
    name: "Gestão Contábil",
    shortName: "Contabilidade",
    description:
      "Plano de contas, centros de custo, lançamentos, livros e SPED Contábil.",
    home: "/accounting",
    roles: [
      "ADMIN",
      "COORDENADOR",
    ],
  },

  expimpo: {
    key: "expimpo",
    code: "EX",
    name:
      "Gestão de Exportação e Importação",
    shortName:
      "Exportação/Importação",
    description:
      "Controle e gestão das atividades de exportação e importação.",
    home: "/comex",
    roles: [
      "ADMIN",
      "COORDENADOR",
    ],
  },
};

export function modulesForRole(role) {
  if (!role) {
    return [];
  }

  return Object
    .values(systemModules)
    .filter(
      (module) =>
        Array.isArray(module.roles) &&
        module.roles.includes(role)
    );
}

export function getModuleByKey(
  moduleKey
) {
  return (
    systemModules[moduleKey] ||
    systemModules.technical
  );
}