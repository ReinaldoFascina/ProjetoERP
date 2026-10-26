import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

try {
  const sql = await fs.readFile(
    join(currentDirectory, "sql", "v29-production.sql"),
    "utf8"
  );

  await db.query(sql);
  console.log("Versão 29: controle de produção instalado.");
} catch (error) {
  console.error("Falha na migração de produção:", error);
  process.exitCode = 1;
} finally {
  await db.end();
}
