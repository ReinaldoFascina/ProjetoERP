export function buildNfsePayload({ movement, client, company, branch, items }) {
  const services = items.filter((item) => item.item_type === 'SERVICO');
  const serviceAmount = services.reduce((sum, item) => sum + Number(item.total || 0), 0);

  return {
    environment: process.env.NFSE_ENVIRONMENT || 'HOMOLOGACAO',
    externalReference: `billing:${movement.id}`,
    competence: movement.competence,
    issueDate: movement.date_issued,
    provider: {
      companyId: company.id,
      branchId: branch.id,
      corporateName: company.corporate_name,
      tradeName: company.trade_name,
      cnpj: branch.document || company.document,
      municipalRegistration: branch.municipal_registration || company.municipal_registration,
      city: branch.city || company.city,
      state: branch.state || company.state,
    },
    customer: {
      id: client.id,
      corporateName: client.corporate_name,
      tradeName: client.trade_name,
      document: client.document,
      municipalRegistration: client.municipal_registration,
      municipalityCode: client.municipality_code,
      email: client.email,
      phone: client.phone,
      address: client.address,
      addressNumber: client.address_number,
      addressComplement: client.address_complement,
      district: client.district,
      city: client.city,
      state: client.state,
      postalCode: client.postal_code,
    },
    totals: {
      services: serviceAmount,
      discount: Number(movement.discount || 0),
      netAmount: serviceAmount - Number(movement.discount || 0),
    },
    services: services.map((item) => ({
      sequence: item.sequence,
      code: item.code,
      description: item.description,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price),
      discount: Number(item.discount || 0),
      total: Number(item.total),
      nationalServiceCode: item.national_service_code,
      lc116Code: item.lc116_code,
      nbsCode: item.nbs_code,
      cnae: item.cnae,
      municipalityCode: item.municipality_code,
      issRate: Number(item.iss_rate || 0),
      issValue: Number(item.iss_value || 0),
    })),
  };
}
