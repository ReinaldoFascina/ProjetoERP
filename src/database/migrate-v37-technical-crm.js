import fs from "node:fs/promises";
import { dirname,join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
const dir=dirname(fileURLToPath(import.meta.url));
try{const sql=await fs.readFile(join(dir,"sql","v37-technical-crm.sql"),"utf8");await db.query(sql);console.log("Versão 37: CRM técnico instalado.");}catch(error){console.error("Falha ao instalar CRM técnico:",error);process.exitCode=1;}finally{await db.end();}
