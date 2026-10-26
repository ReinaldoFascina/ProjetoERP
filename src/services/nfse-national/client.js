import fs from 'node:fs';
import https from 'node:https';
import { gzipSync } from 'node:zlib';

function config() {
  const production = process.env.NFSE_NATIONAL_ENVIRONMENT === 'PRODUCAO';
  const baseUrl = production ? process.env.NFSE_NATIONAL_PRODUCTION_URL : process.env.NFSE_NATIONAL_RESTRICTED_URL;
  if (!baseUrl) throw new Error('URL da API NFS-e Nacional não configurada.');
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    path: process.env.NFSE_NATIONAL_DPS_PATH || '/nfse',
    pfx: fs.readFileSync(process.env.NFSE_NATIONAL_CERT_PFX_PATH),
    passphrase: process.env.NFSE_NATIONAL_CERT_PFX_PASSWORD || '',
  };
}

function requestJson(url, options, body) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, options, (response) => {
      const chunks=[];
      response.on('data',(chunk)=>chunks.push(chunk));
      response.on('end',()=>{
        const text=Buffer.concat(chunks).toString('utf8');
        let data;try{data=JSON.parse(text)}catch{data={raw:text}}
        resolve({status:response.statusCode||0,headers:response.headers,data});
      });
    });
    request.setTimeout(Number(process.env.NFSE_NATIONAL_TIMEOUT_MS||45000),()=>request.destroy(new Error('Tempo limite da API NFS-e Nacional excedido.')));
    request.on('error',reject);request.write(body);request.end();
  });
}

export async function transmitDps(signedXml) {
  const cfg=config();
  const payload=JSON.stringify({dpsXmlGZipB64:gzipSync(Buffer.from(signedXml,'utf8')).toString('base64')});
  const result=await requestJson(`${cfg.baseUrl}${cfg.path}`,{method:'POST',pfx:cfg.pfx,passphrase:cfg.passphrase,rejectUnauthorized:true,headers:{'content-type':'application/json','accept':'application/json','content-length':Buffer.byteLength(payload)}},payload);
  const data=result.data||{};
  const approved=result.status>=200&&result.status<300&&Boolean(data.chaveAcesso||data.accessKey||data.nfseXmlGZipB64||data.nfseXml);
  const authorizedXml=data.nfseXmlGZipB64?Buffer.from(data.nfseXmlGZipB64,'base64'):null;
  return {approved,httpStatus:result.status,data,accessKey:data.chaveAcesso||data.accessKey||null,number:data.numero||data.number||null,protocol:data.protocolo||data.protocol||null,authorizedXml:authorizedXml?.toString('utf8')||data.nfseXml||null,errorCode:data.codigo||data.code||null,errorMessage:data.mensagem||data.message||data.erros?.map(e=>e.Descricao||e.descricao).join('; ')||null};
}
