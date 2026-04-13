import { defineCommand } from "citty";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { consola } from "consola";
import { fileExists, writeFile } from "../utils/fs.ts";

const SKILL_CONTENT = `# envsync — 환경 변수 관리

이 프로젝트는 \`cf-envsync\`로 환경 변수를 관리합니다.

## 환경 이름과 파일 매핑
- \`local\` → \`.env\`
- \`staging\` → \`.env.staging\`
- \`production\` → \`.env.production\`
- \`.env.local\`은 per-developer 오버라이드용 (gitignored)으로 별개

## 환경 변수 추가/변경
\`pnpm envsync set <환경> <KEY> <VALUE>\`
- 기본은 자동 encrypt 진행
- \`--raw\` 플래그 추가시 그대로 저장

## 환경 변수 삭제
\`pnpm envsync unset <환경> <KEY>\`

## 기타 명령어
- \`pnpm envsync dev\` — 로컬 개발용 .dev.vars 또는 .env 생성
- \`pnpm envsync validate\` — .env.example 기준으로 누락 키 검증
- \`pnpm envsync diff <환경>\` — 로컬 vs 원격 비교
- \`pnpm envsync encrypt <환경>\` — 평문 값 암호화
- \`pnpm envsync list\` — 앱별 환경 변수 키 목록

## 규칙
- 환경 변수를 추가/변경/삭제할 때는 반드시 위 커맨드를 사용할 것
- 직접 .env 파일을 수동 편집하지 말 것
`;

export default defineCommand({
  meta: {
    name: "claude-setup",
    description: "Set up Claude Code custom slash command in the current project",
  },
  args: {},
  async run() {
    const cwd = process.cwd();
    const commandsDir = join(cwd, ".claude", "commands");
    const skillPath = join(commandsDir, "envsync.md");

    if (fileExists(skillPath)) {
      const overwrite = await consola.prompt(
        ".claude/commands/envsync.md already exists. Overwrite?",
        { type: "confirm" },
      );
      if (!overwrite) {
        consola.info("Aborted.");
        return;
      }
    }

    mkdirSync(commandsDir, { recursive: true });
    await writeFile(skillPath, SKILL_CONTENT);
    consola.success("Created .claude/commands/envsync.md");
    consola.info("Use /project:envsync in Claude Code to invoke.");
  },
});
