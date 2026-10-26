import fs from 'node:fs';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';

function certificateMaterial() {
  const path = process.env.NFSE_NATIONAL_CERT_PFX_PATH;
  const password = process.env.NFSE_NATIONAL_CERT_PFX_PASSWORD || '';
  if (!path) throw new Error('NFSE_NATIONAL_CERT_PFX_PATH não configurado.');
  const der = fs.readFileSync(path).toString('binary');
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), false, password);
  let key, cert;
  for (const safeContent of p12.safeContents) for (const bag of safeContent.safeBags) {
    if (!key && bag.key) key = forge.pki.privateKeyToPem(bag.key);
    if (!cert && bag.cert) cert = forge.pki.certificateToPem(bag.cert);
  }
  if (!key || !cert) throw new Error('Certificado A1 não contém chave privada e certificado utilizáveis.');
  return { key, cert };
}

export function signDpsXml(xml) {
  const { key, cert } = certificateMaterial();
  const signature = new SignedXml({ privateKey: key, publicCert: cert });
  signature.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  signature.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
  signature.addReference({
    xpath: "//*[local-name()='infDPS']",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  signature.computeSignature(xml, {
    location: { reference: "//*[local-name()='infDPS']", action: 'after' },
  });
  return signature.getSignedXml();
}
