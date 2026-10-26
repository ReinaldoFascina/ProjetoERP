import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

try {
  const sql = await fs.readFile(
    join(
      currentDirectory,
      "sql",
      "v36-movement-confirmation.sql"
    ),
    "utf8"
  );

  await db.query(sql);

  console.log(
    "Versao 36: estrutura de confirmacao de movimentos instalada."
  );
} catch (error) {
  console.error(
    "Falha na migracao de confirmacao de movimentos:",
    error
  );

  process.exitCode = 1;
} finally {
  await db.end();
}
