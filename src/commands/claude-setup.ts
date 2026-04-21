import { defineCommand } from "citty";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { consola } from "consola";
import { loadConfig, resolveConfig, validateConfig } from "../core/config.ts";
import { fileExists, writeFile } from "../utils/fs.ts";
import type { ResolvedConfig, ResolvedAppConfig } from "../types/config.ts";

type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

const DEFAULT_OUTPUT = ".claude/commands/envsync.md";

export default defineCommand({
  meta: {
    name: "claude-setup",
    description: "Generate a Claude Code slash command that documents envsync usage for this project",
  },
  args: {
    force: {
      type: "boolean",
      description: "Overwrite an existing command file without prompting",
      default: false,
    },
    "dry-run": {
      type: "boolean",
      description: "Print the generated content instead of writing it",
      default: false,
    },
    path: {
      type: "string",
      description: `Output path (default: ${DEFAULT_OUTPUT})`,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const outputPath = join(cwd, (args.path as string | undefined) ?? DEFAULT_OUTPUT);
    const dryRun = args["dry-run"] as boolean;
    const force = args.force as boolean;

    const config = await tryLoadConfig();
    const pm = detectPackageManager(cwd);
    const content = renderCommandDoc({ config, pm });

    if (dryRun) {
      consola.info(`[dry-run] would write to ${relative(cwd, outputPath)}`);
      consola.log(`\n${content}`);
      return;
    }

    if (fileExists(outputPath) && !force) {
      const overwrite = await consola.prompt(
        `${relative(cwd, outputPath)} already exists. Overwrite?`,
        { type: "confirm", initial: false },
      );
      if (!overwrite) {
        consola.info("Aborted.");
        return;
      }
    }

    mkdirSync(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content);

    consola.success(`Wrote ${relative(cwd, outputPath)}`);
    const commandName = outputPath.match(/([^/]+)\.md$/)?.[1] ?? "envsync";
    consola.info(`Invoke in Claude Code with /${commandName}`);
  },
});

async function tryLoadConfig(): Promise<ResolvedConfig | undefined> {
  try {
    const raw = await loadConfig();
    const errors = validateConfig(raw);
    if (errors.length > 0) {
      consola.warn("envsync config has errors; generating a generic command doc.");
      for (const err of errors) consola.warn(`  ${err}`);
      return undefined;
    }
    return resolveConfig(raw);
  } catch {
    consola.warn("No envsync config found; generating a generic command doc.");
    return undefined;
  }
}

function detectPackageManager(cwd: string): PackageManager {
  const pkgPath = join(cwd, "package.json");
  if (fileExists(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { packageManager?: string };
      const declared = pkg.packageManager?.split("@")[0];
      if (declared === "pnpm" || declared === "npm" || declared === "yarn" || declared === "bun") {
        return declared;
      }
    } catch {
      // fall through to lockfile detection
    }
  }
  if (fileExists(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (fileExists(join(cwd, "yarn.lock"))) return "yarn";
  if (fileExists(join(cwd, "bun.lock")) || fileExists(join(cwd, "bun.lockb"))) return "bun";
  return "npm";
}

function runPrefix(pm: PackageManager): string {
  switch (pm) {
    case "pnpm": return "pnpm envsync";
    case "yarn": return "yarn envsync";
    case "bun": return "bunx envsync";
    case "npm": return "npx envsync";
  }
}

interface RenderContext {
  config: ResolvedConfig | undefined;
  pm: PackageManager;
}

function renderCommandDoc({ config, pm }: RenderContext): string {
  const cmd = runPrefix(pm);
  const sections: string[] = [];

  sections.push(frontmatter());
  sections.push("# envsync — 환경 변수 관리\n");
  sections.push(
    "이 프로젝트는 [cf-envsync](https://www.npmjs.com/package/cf-envsync)로 `.env` 파일과 Cloudflare Workers 환경 변수를 관리합니다. 사용자가 환경 변수를 추가/변경/삭제하려 하면 이 문서의 규칙을 따라 아래 명령어를 사용하세요.\n",
  );

  sections.push(environmentsSection(config));
  sections.push(filesSection(config));
  sections.push(commandsSection(cmd));
  sections.push(addKeyFlowSection(cmd, config));
  if (config) sections.push(appsSection(config));
  sections.push(rulesSection(config));
  sections.push(examplesSection(cmd, config));

  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function frontmatter(): string {
  return [
    "---",
    "description: envsync로 환경 변수를 조회·설정·삭제·검증",
    "---",
    "",
  ].join("\n");
}

function environmentsSection(config: ResolvedConfig | undefined): string {
  const lines: string[] = ["## 환경", ""];
  if (!config) {
    lines.push("- 환경 목록은 `envsync.config.ts`의 `environments`를 참고하세요.");
    return lines.join("\n") + "\n";
  }

  const pattern = config.raw.envFiles.pattern;
  const encryption = config.raw.encryption;
  for (const env of config.environments) {
    const file = env === "local" ? ".env" : pattern.replace("{env}", env);
    const encLabel =
      env === "local" || encryption === "none"
        ? ""
        : encryption === "password"
        ? " · 암호화(password)"
        : " · 암호화(dotenvx)";
    lines.push(`- \`${env}\` → \`${file}\`${encLabel}`);
  }

  if (encryption === "password") {
    lines.push("");
    lines.push(
      "복호화 비밀번호: `.env.password` 또는 `ENVSYNC_PASSWORD` / `ENVSYNC_PASSWORD_<ENV>` 환경 변수.",
    );
  } else if (encryption === "dotenvx") {
    lines.push("");
    lines.push(
      "복호화 키: `.env.keys` 또는 `DOTENV_PRIVATE_KEY` / `DOTENV_PRIVATE_KEY_<ENV>` 환경 변수.",
    );
  }
  return lines.join("\n") + "\n";
}

function filesSection(config: ResolvedConfig | undefined): string {
  const pattern = config?.raw.envFiles.pattern ?? ".env.{env}";
  const localFile = config?.raw.envFiles.local ?? ".env.local";
  const encryption = config?.raw.encryption ?? "none";
  const encLabel =
    encryption === "password" ? "O (password)" : encryption === "dotenvx" ? "O (dotenvx)" : "X";

  const lines = [
    "## 파일 구조",
    "",
    "| 파일 | 역할 | 직접 편집 |",
    "|---|---|---|",
    "| `envsync.config.ts` / `envsync.json` | 앱과 키 정의 | 예 |",
    "| `.env` | 로컬 개발 값 (local 환경) | 예 |",
    `| \`${localFile}\` | 개인 오버라이드 (gitignored) | 예 |`,
    `| \`${pattern.replace("{env}", "<env>")}\` | 원격 환경 값 (암호화: ${encLabel}) | 아니오 — \`set\`/\`unset\`으로만 |`,
    "| `.env.example` | 유효성 검사 기준 키 목록 | 예 |",
    "| 앱의 `.dev.vars` 등 | `envsync dev`가 생성 | 아니오 |",
  ];
  return lines.join("\n") + "\n";
}

function commandsSection(cmd: string): string {
  return [
    "## 핵심 명령어",
    "",
    "```bash",
    `${cmd} get <env> <KEY>          # 값 조회 (암호화되어 있으면 자동 복호화)`,
    `${cmd} set <env> <KEY> <VALUE>  # 추가/변경 (encryption=password면 자동 암호화)`,
    `${cmd} unset <env> <KEY>        # 삭제`,
    `${cmd} list                     # 앱별 키 목록`,
    `${cmd} validate [env]           # .env.example 기준 누락 키 확인`,
    `${cmd} diff <env>               # 로컬 vs 원격 비교`,
    `${cmd} dev                      # 각 앱의 .dev.vars 재생성 (로컬 개발)`,
    "```",
  ].join("\n") + "\n";
}

function addKeyFlowSection(cmd: string, config: ResolvedConfig | undefined): string {
  const remoteEnvs = config?.environments.filter((e) => e !== "local") ?? ["staging", "production"];
  const setLines = remoteEnvs.map((env) => `${cmd} set ${env} MY_KEY "<value>"`);

  return [
    "## 새 환경 변수 추가 순서",
    "",
    "1. `envsync.config.ts`의 해당 앱 `secrets` 또는 `vars` 배열에 키 이름 추가",
    "2. 각 원격 환경에 값 설정:",
    "   ```bash",
    ...setLines.map((l) => `   ${l}`),
    "   ```",
    "3. 루트 `.env`에 로컬 개발용 값을 직접 기입",
    `4. \`${cmd} dev\` 로 앱별 \`.dev.vars\` 재생성`,
  ].join("\n") + "\n";
}

function appsSection(config: ResolvedConfig): string {
  const apps = Object.values(config.apps);
  if (apps.length === 0) return "";
  const lines: string[] = ["## 앱", ""];
  for (const app of apps.slice(0, 5)) {
    lines.push(`- **${app.name}** (\`${app.path}\`) — ${describeApp(app)}`);
  }
  if (apps.length > 5) {
    lines.push(`- …외 ${apps.length - 5}개 (\`${runPrefix("npm").split(" ")[0]} envsync list\`로 전체 확인)`);
  }
  return lines.join("\n") + "\n";
}

function describeApp(app: ResolvedAppConfig): string {
  const parts: string[] = [];
  if (app.secrets?.length) parts.push(`secrets ${app.secrets.length}개`);
  if (app.vars?.length) parts.push(`vars ${app.vars.length}개`);
  if (!parts.length) parts.push("키 없음");
  return parts.join(", ");
}

function rulesSection(config: ResolvedConfig | undefined): string {
  const encryption = config?.raw.encryption ?? "password";
  const lines = [
    "## 규칙",
    "",
    "- 원격 환경 값은 `set`/`unset`으로만 변경 — 파일을 직접 편집하지 않는다.",
    "- 루트 `.env`와 `.env.local`은 사람이 직접 편집해도 된다 (로컬 전용).",
    "- 앱 디렉터리의 `.dev.vars` 같은 생성물은 절대 직접 수정하지 않는다 (`envsync dev`로 재생성).",
    "- `secrets` 배열의 키는 Cloudflare Workers **secret**으로, `vars` 배열의 키는 `wrangler.jsonc`의 **vars**로 push된다.",
  ];
  if (encryption === "password") {
    lines.push(
      "- `set` 명령은 기본으로 암호화한다. 평문으로 저장하려면 `--raw`를 명시한다.",
    );
  }
  lines.push(
    "- `envsync push`는 원격 Cloudflare에 쓰는 명령이다. 일반적으로 CI/CD에서만 실행하고, 로컬에서는 불가피한 경우에만 사용한다.",
  );
  return lines.join("\n") + "\n";
}

function examplesSection(cmd: string, config: ResolvedConfig | undefined): string {
  const sampleEnv = config?.environments.find((e) => e !== "local") ?? "staging";
  return [
    "## 예시",
    "",
    "사용자가 \"staging의 API_KEY를 보여줘\"라고 하면:",
    "",
    "```bash",
    `${cmd} get ${sampleEnv} API_KEY`,
    "```",
    "",
    "\"production의 DB_URL을 바꿔줘\"라고 하면:",
    "",
    "```bash",
    `${cmd} set production DB_URL "postgres://..."`,
    "```",
    "",
    "\"환경 변수 검증\"이라고 하면:",
    "",
    "```bash",
    `${cmd} validate`,
    "```",
  ].join("\n") + "\n";
}
