import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from './db.js';
const here=dirname(fileURLToPath(import.meta.url));
const sql=await fs.readFile(join(here,'sql','v26-stock-management.sql'),'utf8');
try { await db.query(sql); console.log('Versão 26: contexto Gestão de Estoque instalado.'); }
catch(error){ console.error('Falha na migração v26:',error); process.exitCode=1; }
finally { await db.end(); }
