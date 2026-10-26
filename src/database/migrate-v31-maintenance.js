import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
const currentDirectory = dirname(fileURLToPath(import.meta.url));
try {
  const sql = await fs.readFile(join(currentDirectory,"sql","v31-maintenance.sql"),"utf8");
  await db.query(sql);
  console.log("Versão 31: controle de manutenção instalado.");
} catch (error) {
  console.error("Falha na migração de manutenção:",error);
  process.exitCode=1;
} finally { await db.end(); }
