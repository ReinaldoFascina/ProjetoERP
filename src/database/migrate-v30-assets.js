import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

try {
  const sql = await fs.readFile(
    join(currentDirectory, "sql", "v30-assets.sql"),
    "utf8"
  );
  await db.query(sql);
  console.log("Versão 30: controle patrimonial instalado.");
} catch (error) {
  console.error("Falha na migração patrimonial:", error);
  process.exitCode = 1;
} finally {
  await db.end();
}
