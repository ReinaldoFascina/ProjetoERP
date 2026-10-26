import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
const directory = dirname(fileURLToPath(import.meta.url));
try {
  const sql = await fs.readFile(join(directory,"sql","v34-duimp-catalog.sql"),"utf8");
  await db.query(sql);
  console.log("Versão 34: DUIMP, obrigações e catálogo do importador instalados.");
} catch (error) {
  console.error("Falha na migração DUIMP/Catálogo:", error);
  process.exitCode = 1;
} finally { await db.end(); }
