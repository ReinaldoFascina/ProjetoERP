export function validateDuimp({ declaration, items, obligations }) {
  const errors = [];
  if (!declaration.importer_document) errors.push("Importador sem CNPJ/CPF configurado.");
  if (!declaration.dispatch_unit_code) errors.push("Unidade de despacho não informada.");
  if (!declaration.entry_unit_code) errors.push("Unidade de entrada não informada.");
  if (!declaration.operation_consumption_state) errors.push("UF do local da operação de consumo não informada.");
  if (!declaration.operation_consumption_city_code) errors.push("Município do local da operação de consumo não informado.");
  if (!items.length) errors.push("A DUIMP não possui itens.");
  items.forEach((item) => {
    if (!item.siscomex_product_code) errors.push(`Item ${item.sequence}: produto ainda não ativado no Catálogo Siscomex.`);
    if (!item.ncm_code) errors.push(`Item ${item.sequence}: NCM não informado.`);
    if (Number(item.quantity) <= 0) errors.push(`Item ${item.sequence}: quantidade inválida.`);
    if (item.other_taxes_due === null || item.other_taxes_due === undefined) errors.push(`Item ${item.sequence}: outros tributos/direitos não informado.`);
  });
  obligations.filter((item) => item.required_before_submission && !["COMPLETED","WAIVED"].includes(item.status))
    .forEach((item) => errors.push(`Obrigação pendente: ${item.description}.`));
  return errors;
}

export function buildDuimpPayload({ declaration, items }) {
  return {
    referenciaInterna: declaration.internal_reference,
    importador: { cpfCnpj: declaration.importer_document, tipo: declaration.importer_type },
    despacho: {
      unidadeDespacho: declaration.dispatch_unit_code,
      unidadeEntrada: declaration.entry_unit_code,
      localCarga: declaration.cargo_location_code || null,
      modalidadeTransporte: declaration.transport_mode || null,
    },
    localOperacaoConsumo: {
      uf: declaration.operation_consumption_state,
      codigoMunicipio: declaration.operation_consumption_city_code,
    },
    informacoesComplementares: declaration.general_information || null,
    itens: items.map((item) => ({
      sequencia: item.sequence,
      codigoProduto: item.siscomex_product_code,
      versaoProduto: item.product_version,
      ncm: item.ncm_code,
      quantidade: Number(item.quantity),
      unidadeComercial: item.commercial_unit,
      pesoLiquido: Number(item.net_weight || 0),
      moeda: item.currency_code,
      valorUnitario: Number(item.unit_value),
      valorTotal: Number(item.total_value),
      incoterm: item.incoterm || null,
      paisAquisicao: item.country_acquisition || null,
      paisOrigem: item.country_origin || null,
      lpco: item.lpco_number || null,
      fundamentoLegal: item.legal_basis_code || null,
      outrosTributosDireitos: Number(item.other_taxes_due || 0),
    })),
  };
}
