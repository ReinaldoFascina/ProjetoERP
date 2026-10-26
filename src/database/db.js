import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

const requiredVariables = [
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
];

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    throw new Error(
      `Variável ${variable} não configurada no arquivo .env`
    );
  }
}

export const db = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  max: Number(process.env.DB_POOL_MAX || 10),

  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,

  ssl: {
    rejectUnauthorized: false,
  },
});

db.on("connect", () => {
  console.log("Conexão estabelecida com o PostgreSQL.");
});

db.on("error", (error) => {
  console.error("Erro inesperado no pool PostgreSQL:", error);
});