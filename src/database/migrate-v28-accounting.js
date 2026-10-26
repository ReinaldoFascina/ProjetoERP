import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
const here = dirname(fileURLToPath(import.meta.url));
try {
  const sql = await fs.readFile(join(here, "sql", "v28-accounting.sql"), "utf8");
  await db.query(sql);
  console.log("Versão 28: controle contábil instalado.");
} catch (error) {
  console.error("Falha na migração contábil:", error);
  process.exitCode = 1;
} finally {
  await db.end();
}
