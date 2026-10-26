import fs from "fs";
import path from "path";

const ROUTES_DIR = "./src/routes";

const ASYNC_ROUTE = `
const asyncRoute = (handler) =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next))
      .catch(next);

`;

function walk(dir) {
  for (const file of fs.readdirSync(dir)) {

    const full = path.join(dir, file);

    if (fs.statSync(full).isDirectory()) {
      walk(full);
      continue;
    }

    if (!full.endsWith(".js")) {
      continue;
    }

    let content = fs.readFileSync(full, "utf8");

    const usesAsyncRoute =
      content.includes("asyncRoute(");

    const hasDefinition =
      content.includes(
        "const asyncRoute ="
      );

    if (usesAsyncRoute && !hasDefinition) {

      const pos = content.lastIndexOf("import ");

      if (pos >= 0) {

        const lines = content.split("\n");

        let insertPos = 0;

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith("import ")) {
            insertPos = i + 1;
          }
        }

        lines.splice(insertPos, 0, ASYNC_ROUTE);

        fs.writeFileSync(
          full,
          lines.join("\n")
        );

        console.log(
          `✓ asyncRoute adicionado: ${full}`
        );
      }
    }
  }
}

walk(ROUTES_DIR);

console.log("Correção concluída.");