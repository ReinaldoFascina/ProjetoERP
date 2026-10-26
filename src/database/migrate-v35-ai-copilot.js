import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
const directory = dirname(fileURLToPath(import.meta.url));
try {
  const sql = await fs.readFile(join(directory,"sql","v35-ai-copilot.sql"),"utf8");
  await db.query(sql);
  console.log("Versão 35: Copiloto Operacional instalado.");
} catch (error) {
  console.error("Falha ao instalar o Copiloto:",error);
  process.exitCode=1;
} finally { await db.end(); }
