import { defineCommand } from "citty";
import { basename } from "node:path";
import { consola } from "consola";
import { readFile, writeFile, fileExists, globFiles } from "../utils/fs.ts";

export default defineCommand({
  meta: {
    name: "normalize",
    description: "Sort env file keys alphabetically",
  },
  args: {
    path: {
      type: "positional",
      description: "Path to .env file (default: finds all .env* files)",
      required: false,
    },
    "dry-run": {
      type: "boolean",
      description: "Show changes without writing",
      default: false,
    },
  },
  async run({ args }) {
    let files: string[];

    if (args.path) {
      if (!fileExists(args.path as string)) {
        consola.error(`File not found: ${args.path}`);
        process.exit(1);
      }
      files = [args.path as string];
    } else {
      // Find all .env* files recursively (monorepo support)
      files = await globFiles(process.cwd(), (f) => {
        const name = basename(f);
        return (
          name.startsWith(".env") &&
          !name.endsWith(".keys") &&
          !f.includes("node_modules") &&
          !f.includes(".dev.vars")
        );
      });
    }

    if (files.length === 0) {
      consola.warn("No .env files found.");
      return;
    }

    for (const file of files.sort()) {
      consola.start(`Normalizing ${file}...`);

      const content = await readFile(file);
      const lines = content.split("\n");

      // Separate comments/blank lines at top from key=value lines
      const headerLines: string[] = [];
      const kvLines: string[] = [];
      let inHeader = true;

      for (const line of lines) {
        const trimmed = line.trim();
        if (inHeader && (trimmed.startsWith("#") || trimmed === "")) {
          headerLines.push(line);
        } else {
          inHeader = false;
          if (trimmed !== "") {
            kvLines.push(line);
          }
        }
      }

      const sorted = kvLines.sort((a, b) => {
        const keyA = a.split("=")[0]?.trim() ?? "";
        const keyB = b.split("=")[0]?.trim() ?? "";
        return keyA.localeCompare(keyB);
      });

      const result =
        [...headerLines, ...sorted].join("\n").replace(/\n{3,}/g, "\n\n") +
        "\n";

      if (args["dry-run"]) {
        consola.info(`  Would normalize ${kvLines.length} keys in ${file}`);
      } else {
        await writeFile(file, result);
        consola.success(`  Normalized ${kvLines.length} keys in ${file}`);
      }
    }
  },
});
