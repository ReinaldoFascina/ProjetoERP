import { spawn } from 'node:child_process';

const migrations = [
  'src/database/migrate-v21-multicompany-all.js',
  'src/database/migrate-v21-nfse-module.js',
  'src/database/migrate-v22-nfse-national.js',
  'src/database/migrate-v23-fiscal.js',
  'src/database/migrate-v23-fiscal-books.js',
  'src/database/migrate-v24.1-movements.js',
];

function run(file) {
  return new Promise((resolve, reject) => {
    console.log(`\n==> Executando ${file}`);
    const child = spawn(process.execPath, [file], { stdio: 'inherit', env: process.env });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${file} terminou com código ${code}`)));
  });
}

try {
  for (const migration of migrations) await run(migration);
  console.log('\nRESistemas 24.0.0: migrações concluídas.');
} catch (error) {
  console.error('\nFalha na consolidação da versão 24:', error.message);
  process.exitCode = 1;
}
