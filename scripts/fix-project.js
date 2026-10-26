import fs from "fs";
import path from "path";

const ROOTS = [
  "./server.js",
  "./src/routes",
  "./src/middleware",
  "./src/controllers",
  "./src/services",
  "./src/views"
];

function fixContent(content) {
  return content

    // HTML
    .replace(/<br\s*\/?>/gi, "")
    .replace(/<br[^>]*>/gi, "")

    // Entidades HTML
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

    // Operadores JS
    .replace(/=&gt;/g, "=>")
    .replace(/&lt;=/g, "<=")
    .replace(/&gt;=/g, ">=")
    .replace(/&lt;&gt;/g, "<>")

    // Escapes incorretos
    .replace(/=\\>/g, "=>")
    .replace(/\\\|\\\|/g, "||")
    .replace(/\\>=/g, ">=")
    .replace(/\\<=/g, "<=")
    .replace(/\\</g, "<")
    .replace(/\\>/g, ">")

    // Linha em excesso
    .replace(/\n{3,}/g, "\n\n");
}

function processFile(file) {
  const ext = path.extname(file);

  if (![
    ".js",
    ".mjs",
    ".cjs",
    ".ejs",
    ".html",
    ".json"
  ].includes(ext)) {
    return;
  }

  try {
    const original = fs.readFileSync(file, "utf8");

    const fixed = fixContent(original);

    if (original !== fixed) {

      const backup = `${file}.bak`;

      if (!fs.existsSync(backup)) {
        fs.writeFileSync(backup, original);
      }

      fs.writeFileSync(file, fixed);

      console.log(`✓ Corrigido: ${file}`);
    }
  } catch (err) {
    console.error(`✗ Erro: ${file}`);
    console.error(err.message);
  }
}

function walk(target) {
  if (!fs.existsSync(target)) {
    return;
  }

  const stat = fs.statSync(target);

  if (stat.isFile()) {
    processFile(target);
    return;
  }

  for (const item of fs.readdirSync(target)) {
    walk(path.join(target, item));
  }
}

console.log("====================================");
console.log(" CORREÇÃO AUTOMÁTICA RESISTEMAS ");
console.log("====================================");

for (const root of ROOTS) {
  walk(root);
}

console.log("");
console.log("Processamento concluído.");