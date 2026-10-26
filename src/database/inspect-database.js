import fs from "node:fs";
import "dotenv/config";

import { db } from "./db.js";

const outputPath =
  "database-structure.json";

try {
  const tablesResult = await db.query(`
    SELECT
      table_schema,
      table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  const columnsResult = await db.query(`
    SELECT
      table_schema,
      table_name,
      ordinal_position,
      column_name,
      data_type,
      udt_name,
      is_nullable,
      column_default,
      character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY
      table_name,
      ordinal_position
  `);

  const primaryKeysResult =
    await db.query(`
      SELECT
        tc.table_schema,
        tc.table_name,
        kcu.column_name,
        kcu.ordinal_position
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name =
           tc.constraint_name
       AND kcu.table_schema =
           tc.table_schema
       AND kcu.table_name =
           tc.table_name
      WHERE tc.table_schema = 'public'
        AND tc.constraint_type =
            'PRIMARY KEY'
      ORDER BY
        tc.table_name,
        kcu.ordinal_position
    `);

  const foreignKeysResult =
    await db.query(`
      SELECT
        tc.table_schema,
        tc.table_name,
        kcu.column_name,
        ccu.table_schema
          AS referenced_schema,
        ccu.table_name
          AS referenced_table,
        ccu.column_name
          AS referenced_column,
        rc.update_rule,
        rc.delete_rule,
        tc.constraint_name

      FROM information_schema
           .table_constraints tc

      JOIN information_schema
           .key_column_usage kcu
        ON kcu.constraint_name =
           tc.constraint_name
       AND kcu.constraint_schema =
           tc.constraint_schema

      JOIN information_schema
           .constraint_column_usage ccu
        ON ccu.constraint_name =
           tc.constraint_name
       AND ccu.constraint_schema =
           tc.constraint_schema

      JOIN information_schema
           .referential_constraints rc
        ON rc.constraint_name =
           tc.constraint_name
       AND rc.constraint_schema =
           tc.constraint_schema

      WHERE tc.table_schema = 'public'
        AND tc.constraint_type =
            'FOREIGN KEY'

      ORDER BY
        tc.table_name,
        kcu.column_name
    `);

  const indexesResult =
    await db.query(`
      SELECT
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY
        tablename,
        indexname
    `);

  const policiesResult =
    await db.query(`
      SELECT
        schemaname,
        tablename,
        policyname,
        permissive,
        roles,
        cmd,
        qual,
        with_check
      FROM pg_policies
      WHERE schemaname = 'public'
      ORDER BY
        tablename,
        policyname
    `);

  const triggersResult =
    await db.query(`
      SELECT
        event_object_schema,
        event_object_table,
        trigger_name,
        event_manipulation,
        action_timing,
        action_statement
      FROM information_schema.triggers
      WHERE event_object_schema = 'public'
      ORDER BY
        event_object_table,
        trigger_name
    `);

  const rowCounts = [];

  for (
    const table
    of tablesResult.rows
  ) {
    const tableName =
      table.table_name;

    /*
     * O nome vem do catálogo do PostgreSQL,
     * mas ainda aplicamos escape de aspas.
     */
    const escapedTableName =
    tableName.replaceAll(
        "\*",
        "\"\""
      );

    try {
      const countResult =
       await db.query(
          `SELECT COUNT(*)::bigint
             AS total
           FROM "${escapedTableName}"`
        );

      rowCounts.push({
        table_name:
         tableName,

        total:
         countResult.rows[0].total,
     });
    } catch (error) {
     rowCounts.push({
        table_name:
          tableName,

        total: null,

        error:
         error.message,
      });
    }
 }

  const structure = {
    genereted_at:
      new Date().toISOString(),

    database:
      new URL(process.env.DATABASE_URL).pathname.replace("/^*//",""),

    tables:
      tablesResult.rows,

    columns:
      columnsResult.rows,

   primary_keys:
      primaryKeysResult.rows,

    foreign_keys:
     foreignKeysResult.rows,

    indexes:
      indexesResult.rows,

   policies:
      policiesResult.rows,

    triggers:
      triggersResult.rows,

    row_counts:
      rowCounts,
  };

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      structure,
      null,
     2
    ),
    "utf8"
  );

  console.log(
    `Inventário salvo em: ${outputPath}`
  );

  console.log(
    `Tabelas encontradas: ${tablesResult.rows.length}`
  );
} catch (error) {
  console.error(
    "Falha ao gerar inventário:",
    error
  );

  process.exitCode =  1;
} finally {
  await db.end();
}