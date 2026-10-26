import fs from "fs";
import path from "path";

const arquivo = "server.js";

const original = fs.readFileSync(arquivo, "utf8");

const backup = `${arquivo}.bak`;

fs.writeFileSync(backup, original, "utf8");

let conteudo = original;

const substituicoes = [
  [/&gt;/g, ">"],
  [/&lt;/g, "<"],
  [/&amp;/g, "&"],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/<br\s*\/?>/gi, ""],
  [/<br[^>]*>/gi, ""],
  [/=\\>/g, "=>"],
  [/\\\|\\\|/g, "||"],
  [/\\>=/g, ">="],
  [/\\<=/g, "<="],
  [/\\</g, "<"],
  [/\\>/g, ">"],
  [/\n{3,}/g, "\n\n"],
];

for (const [regex, valor] of substituicoes) {
  conteudo = conteudo.replace(regex, valor);
}

fs.writeFileSync(arquivo, conteudo, "utf8");

console.log(`Backup criado: ${backup}`);
console.log(`Arquivo corrigido: ${arquivo}`);
