import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
try {
  const sql = await fs.readFile(join(currentDirectory, "sql", "v32-real-estate.sql"), "utf8");
  await db.query(sql);
  console.log("Versão 32: controle de empreendimentos instalado.");
} catch (error) {
  console.error("Falha na migração de empreendimentos:", error);
  process.exitCode = 1;
} finally {
  await db.end();
}
