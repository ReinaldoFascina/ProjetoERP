import fs from "node:fs";
import https from "node:https";

const ENVIRONMENTS = {
  VALIDATION: "https://val.portalunico.siscomex.gov.br",
  PRODUCTION: "https://portalunico.siscomex.gov.br",
};

function requestJson({ url, method, certificatePath, certificateKeyPath, certificatePassphrase, headers, payload }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = https.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method,
      cert: certificatePath ? fs.readFileSync(certificatePath) : undefined,
      key: certificateKeyPath ? fs.readFileSync(certificateKeyPath) : undefined,
      passphrase: certificatePassphrase || undefined,
      rejectUnauthorized: true,
      headers: { "content-type": "application/json; charset=utf-8", accept: "application/json", ...headers },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let body = raw;
        try { body = raw ? JSON.parse(raw) : null; } catch {}
        resolve({ status: response.statusCode || 0, headers: response.headers, body });
      });
    });
    request.on("error", reject);
    request.end(JSON.stringify(payload));
  });
}

export async function submitPortalResource({ environment, endpointPath, payload, idempotencyKey, dryRun = true }) {
  if (dryRun) return { status: 200, body: { simulated: true, idempotencyKey, endpointPath, payload } };
  if (!endpointPath || !endpointPath.startsWith("/")) throw new Error("Endpoint oficial não configurado para o recurso.");
  const baseUrl = ENVIRONMENTS[environment];
  if (!baseUrl) throw new Error("Ambiente do Portal Único inválido.");
  if (!process.env.SISCOMEX_CERT_PATH || !process.env.SISCOMEX_KEY_PATH) throw new Error("Certificado A1 e chave privada não configurados.");
  return requestJson({
    url: `${baseUrl}${endpointPath}`,
    method: "POST",
    certificatePath: process.env.SISCOMEX_CERT_PATH,
    certificateKeyPath: process.env.SISCOMEX_KEY_PATH,
    certificatePassphrase: process.env.SISCOMEX_CERT_PASSPHRASE,
    headers: { "x-idempotency-key": idempotencyKey },
    payload,
  });
}
