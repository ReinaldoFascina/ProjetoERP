import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
const directory = dirname(fileURLToPath(import.meta.url));
try {
  const sql = await fs.readFile(join(directory, "sql", "v33-comex.sql"), "utf8");
  await db.query(sql);
  console.log("Versão 33: controle de importação e exportação instalado.");
} catch (error) {
  console.error("Falha na migração COMEX:", error);
  process.exitCode = 1;
} finally {
  await db.end();
}
