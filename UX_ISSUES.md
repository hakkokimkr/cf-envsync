# cf-envsync UX 개선점 분석

코드베이스 전체를 분석하여 실제 사용 시 예상되는 불편 사항을 정리했습니다.

---

## 심각도: 높음

### 1. `diff` 명령어의 모호한 인자 해석

```bash
envsync diff staging production   # env vs env 비교
envsync diff staging api          # local vs remote 비교
```

두 번째 인자가 환경 이름인지 앱 이름인지를 내부적으로 자동 판단하는데, **앱 이름이 환경 이름과 같을 경우** (예: `staging`이라는 앱이 있다면) 어떤 모드로 동작하는지 예측이 불가능합니다. 사용자에게 어떤 모드가 선택됐는지 알려주지도 않습니다.

**개선안**: `--remote` 플래그로 모드를 명시적으로 분리하거나, 모호한 경우 사용자에게 확인 프롬프트를 표시

### 2. `validate` 명령어의 인자 우선순위 혼동

```bash
envsync validate              # 전체 검증
envsync validate api          # 앱 이름? 환경 이름?
envsync validate staging      # 환경 이름? 앱 이름?
envsync validate staging api  # env + app
```

첫 번째 인자가 환경 이름이 아니면 앱 이름으로 처리되는데, 이 규칙을 문서를 읽지 않고는 알 수 없습니다.

**개선안**: `--app`, `--env` 플래그로 명시적으로 구분

### 3. `push` 시 잘못된 환경에 비밀 전송 위험

- `--force`를 쓰면 확인 프롬프트 없이 즉시 실행
- 존재하지 않는 앱 이름은 경고만 출력하고 **exit code는 0** (성공)
- 일부 앱만 push된 상황을 CI에서 감지 불가

```bash
envsync push production --force app1 app2 typo-app
# typo-app은 경고로 스킵되지만 exit 0 → 스크립트는 성공으로 판단
```

**개선안**: 알 수 없는 앱 이름이 있으면 exit code 1 반환, `--force` 사용 시에도 환경 이름 확인 프롬프트 추가

### 4. 알 수 없는 앱 이름의 무시(Silent Skip)

`push`, `validate`, `diff` 등 여러 명령어에서 존재하지 않는 앱 이름을 인자로 넘기면 경고만 출력하고 넘어갑니다. exit code가 바뀌지 않아서 자동화 스크립트에서 오류를 감지할 수 없습니다.

**개선안**: `--strict` 모드 또는 기본적으로 존재하지 않는 앱 이름을 에러 처리

---

## 심각도: 중간

### 5. `--shared` 플래그의 불명확한 동작

```bash
envsync push staging --shared
```

`config.shared`에 정의된 키만 push하고 `app.secrets`를 무시합니다. shared 키가 없는 앱은 아무 메시지 없이 건너뛰는데, 사용자는 "모든 앱에 공통 키를 push한다"고 오해할 수 있습니다.

**개선안**: 건너뛴 앱 목록을 명시적으로 출력, `--shared` 사용 시 영향받는 앱/키 요약 표시

### 6. 장시간 작업에 대한 진행 표시 부재

- `push`로 여러 앱에 다수의 secret을 전송할 때 wrangler 명령이 하나씩 실행됨
- `validate`로 여러 환경 × 여러 앱을 검증할 때
- 현재는 스피너나 진행률 표시 없음 → 명령이 멈춘 건지 동작 중인지 알 수 없음

**개선안**: `consola.start()`/spinner 활용, 앱별 진행 표시

### 7. `dev` 명령어가 non-local 환경에서 per-dev override 무시

```bash
envsync dev staging  # per-dev override 경고 없이 무시
envsync dev          # per-dev override 체크 + 경고
```

`dev` 명령에 non-local 환경을 지정하면 `.env.local`의 per-dev override 검증을 건너뛰는데, 왜 건너뛰는지 설명이 없습니다.

**개선안**: non-local 환경일 때 "per-dev overrides are only checked for 'local' environment" 메시지 표시

### 8. `init --monorepo` 기존 설정 덮어쓰기 시 미리보기 부재

기존 `envsync.config.ts`가 있을 때 덮어쓸지 확인하지만, **변경 사항의 diff를 보여주지 않습니다**. monorepo 스캔이 wrangler 설정을 못 찾으면 수동 입력 모드로 전환되는데 왜 전환됐는지 알려주지 않습니다.

**개선안**: 기존 설정과 새 설정의 diff 표시, 스캔 실패 시 이유 명시

### 9. 암호화 방식 불일치 감지 부재

config에 `encryption: "dotenvx"`이지만 파일이 `envsync:v1:` (password 방식)으로 암호화된 경우, 또는 그 반대의 경우를 감지하지 않습니다. 복호화 실패 시 에러 메시지가 원인(방식 불일치)을 알려주지 않습니다.

**개선안**: 파일의 암호화 포맷과 config 설정 비교 후 불일치 시 명확한 에러

### 10. `.env` 파일이 없을 때의 무음 동작

환경을 config에 추가했지만 `.env.staging` 파일을 만들지 않은 경우:
- `dev staging` → 빈 `{}` 반환 → 빈 `.dev.vars` 생성
- 에러나 경고 없이 성공으로 처리

**개선안**: 환경 파일이 없을 때 경고 메시지 출력

---

## 심각도: 낮음

### 11. `--verbose`/`--debug` 모드 부재

어떤 파일이 어떤 순서로 로드되는지, wrangler에 어떤 명령이 전달되는지 확인할 방법이 없습니다. 설정/해결 과정에서 문제가 생겼을 때 디버깅이 어렵습니다.

### 12. `list --keys` 출력이 대규모 프로젝트에서 넘침

100개 이상의 키가 있는 앱에서 페이지네이션이나 필터링 없이 전부 출력됩니다. `| less`로 파이핑하는 것은 사용자 책임입니다.

### 13. 에러 메시지에서 파일 경로 모호

`.env.staging`이 root에도 있고 각 앱 디렉토리에도 있을 때, 에러 메시지가 상대 경로만 표시하여 어떤 파일에서 문제가 생겼는지 알기 어렵습니다.

### 14. `normalize` 명령어의 멀티라인 값 처리 불명확

`\n`이 포함된 값이 있을 때 정렬 동작이 정의되지 않았습니다. 데이터 손실 가능성이 있습니다.

### 15. `merge` 명령어의 exit code 문서화 부재

Git merge driver로 사용될 때 exit 0 = 성공, exit 1 = 충돌인데, 재암호화 실패 시에도 exit 0을 반환하여 부분 실패를 놓칠 수 있습니다.

### 16. 삭제된 앱의 `.dev.vars` 잔존

config에서 앱을 제거해도 기존에 생성된 `.dev.vars` 파일은 삭제되지 않습니다. 오래된 secret이 남아 있을 수 있습니다.

### 17. 비밀번호 암호화의 평문 노출

`.env.password` 파일이 평문으로 존재합니다. gitignore되어 있지만 추가적인 비밀 관리 부담이 생기며, 이 파일의 보안에 대한 가이드가 없습니다.

### 18. `.env.local` 키 이름 오타 감지 불가

```
# .env.example: API_KEY=
# .env.local:   API_KEYS=xxx  (오타)
```

`dev` 명령은 두 키를 모두 포함한 `.dev.vars`를 생성하고, `validate`는 `API_KEY` 누락을 보고하지만 `API_KEYS`가 오타라는 힌트를 주지 않습니다.

**개선안**: Levenshtein distance 등으로 유사한 키 이름 감지 후 "Did you mean...?" 제안

---

## 요약

| 심각도 | 개수 | 핵심 주제 |
|--------|------|-----------|
| 높음   | 4    | 인자 모호성, silent failure, 파괴적 동작 |
| 중간   | 6    | 불명확한 플래그, 진행 표시 부재, 무음 동작 |
| 낮음   | 8    | 디버깅 어려움, 출력 문제, 엣지 케이스 |
