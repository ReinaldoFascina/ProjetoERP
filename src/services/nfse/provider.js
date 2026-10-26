function normalizeStatus(value) {
  const status = String(value || '').toUpperCase();
  if (['AUTORIZADA','CANCELADA','PENDENTE','REJEITADA'].includes(status)) return status;
  if (['AUTHORIZED','APPROVED'].includes(status)) return 'AUTORIZADA';
  if (['CANCELED','CANCELLED'].includes(status)) return 'CANCELADA';
  if (['REJECTED','ERROR','FAILED'].includes(status)) return 'REJEITADA';
  return 'PENDENTE';
}

async function httpRequest(path, body) {
  const baseUrl = String(process.env.NFSE_API_URL || '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('NFSE_API_URL não configurada.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.NFSE_TIMEOUT_MS || 30000));
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.NFSE_API_TOKEN ? { authorization: `Bearer ${process.env.NFSE_API_TOKEN}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({ raw: 'Resposta não JSON' }));
    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
}

export async function issueNfse(payload) {
  const provider = String(process.env.NFSE_PROVIDER || 'MANUAL').toUpperCase();

  if (provider === 'MANUAL') {
    return {
      provider,
      status: 'PENDENTE',
      httpStatus: 202,
      message: 'Documento preparado. Configure o provedor fiscal para transmissão.',
      data: { prepared: true },
    };
  }

  const { response, data } = await httpRequest(process.env.NFSE_ISSUE_PATH || '/nfse', payload);
  return {
    provider,
    status: response.ok ? normalizeStatus(data.status || 'PENDENTE') : 'REJEITADA',
    httpStatus: response.status,
    message: data.message || data.error || null,
    data,
    documentNumber: data.number || data.documentNumber || null,
    accessKey: data.accessKey || data.key || null,
    protocol: data.protocol || null,
    verificationCode: data.verificationCode || null,
    documentUrl: data.documentUrl || data.pdfUrl || null,
    authorizedXml: data.xml || null,
    providerDocumentId: data.id || data.documentId || null,
  };
}

export async function cancelNfse(document, reason) {
  const provider = String(document.provider || process.env.NFSE_PROVIDER || 'MANUAL').toUpperCase();
  if (provider === 'MANUAL') {
    return { provider, status: 'PENDENTE', httpStatus: 202, message: 'Cancelamento não transmitido. Configure o provedor fiscal.', data: { manual: true, prepared: true } };
  }

  const { response, data } = await httpRequest(process.env.NFSE_CANCEL_PATH || '/nfse/cancel', {
    providerDocumentId: document.provider_document_id,
    documentNumber: document.document_number,
    accessKey: document.access_key,
    protocol: document.protocol,
    reason,
  });
  return {
    provider,
    status: response.ok ? normalizeStatus(data.status || 'CANCELADA') : 'REJEITADA',
    httpStatus: response.status,
    message: data.message || data.error || null,
    data,
    protocol: data.protocol || document.protocol,
  };
}
