# Autonomous Mode - 설계 문서 (v1)

> **Note**: 이 문서는 v1 설계 문서입니다. 현재 시스템은 v2 Agent Pipeline 기반으로 동작합니다.
> v2 PRD는 [AUTONOMOUS-MODE-V2-PRD.md](./AUTONOMOUS-MODE-V2-PRD.md)를 참조하세요.
> v1의 Phase 기반 사이클은 하위 호환으로 유지되며, Agent Pipeline 비활성화 시 fallback으로 사용됩니다.

## 1. 개요

### 1.1 목적

mlaude에 **자율 실행 모드(Autonomous Mode)**를 추가한다.
기존의 수동 모드(Manual Mode)는 사람이 프롬프트를 작성하고 Plan을 구성해서 실행하는 방식이다.
자율 모드는 Claude가 스스로 대상 프로젝트를 분석하고, 테스트하고, 문제를 발견하고, 수정하는 사이클을 **usage limit이 허락하는 한 무한 반복**한다.

### 1.2 핵심 원칙

- **기존 수동 모드와 완전히 분리**: DB 테이블, API 엔드포인트, UI 메뉴, 히스토리 모두 별도
- **동일한 웹 진입점**: 같은 앱 내에서 모드 토글로 전환
- **크로스-세션 메모리**: 세션 간 발견 사항, 아이디어, 진행 상태가 파일 + DB로 영속
- **안전장치 우선**: 자동 git checkpoint, 테스트 실패 시 rollback, 무한 루프 방지

---

## 2. 아키텍처

### 2.1 모드 분리 구조

```
┌─────────────────────────────────────────────────────┐
│                    mlaude Web App                   │
│                                                      │
│  ┌─────────────┐    [Toggle]    ┌─────────────────┐  │
│  │ Manual Mode  │ ◄──────────► │ Autonomous Mode  │  │
│  │             │               │                  │  │
│  │ /prompts    │               │ /auto            │  │
│  │ /plans      │               │ /auto/cycles     │  │
│  │ /run        │               │ /auto/findings   │  │
│  │ /history    │               │ /auto/history    │  │
│  │ /settings   │               │ /auto/settings   │  │
│  └─────────────┘               └─────────────────┘  │
│         │                              │             │
│         ▼                              ▼             │
│  ┌─────────────┐               ┌─────────────────┐  │
│  │ run-manager  │               │ cycle-engine    │  │
│  │ (기존)       │               │ (신규)          │  │
│  └──────┬──────┘               └────────┬────────┘  │
│         │                              │             │
│         ▼                              ▼             │
│  ┌──────────────────────────────────────────────┐   │
│  │           claude-executor (공유)               │   │
│  └──────────────────────────────────────────────┘   │
│         │                              │             │
│         ▼                              ▼             │
│  ┌─────────────┐               ┌─────────────────┐  │
│  │ Manual DB    │               │ Autonomous DB   │  │
│  │ Tables       │               │ Tables          │  │
│  └─────────────┘               └─────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 2.2 자율 모드 사이클 흐름

```
┌──────────────────────────────────────────────────────┐
│                   Autonomous Cycle                    │
│                                                       │
│  ┌─────────┐                                         │
│  │  START   │                                         │
│  └────┬────┘                                         │
│       ▼                                               │
│  ┌─────────────┐    최초 실행 시                      │
│  │ ① Load      │───────────────► Discovery Phase     │
│  │   State     │    state 존재 시                     │
│  └─────┬───────┘───────────────► Normal Cycle        │
│        ▼                                              │
│  ┌─────────────┐                                     │
│  │ ② Select    │  Backlog에서 우선순위 최상위 항목     │
│  │   Task      │  선택 (또는 Discovery 페이즈 결정)    │
│  └─────┬───────┘                                     │
│        ▼                                              │
│  ┌─────────────┐                                     │
│  │ ③ Git       │  git stash or checkpoint commit     │
│  │   Checkpoint│                                     │
│  └─────┬───────┘                                     │
│        ▼                                              │
│  ┌─────────────┐                                     │
│  │ ④ Execute   │  Claude CLI로 프롬프트 실행          │
│  │   Prompt    │  (claude-executor 재사용)            │
│  └─────┬───────┘                                     │
│        ▼                                              │
│  ┌─────────────┐         ┌──────────┐                │
│  │ ⑤ Run       │────────►│ 실패 시   │                │
│  │   Tests     │         │ Rollback │                │
│  └─────┬───────┘         └──────────┘                │
│        ▼ (성공)                                       │
│  ┌─────────────┐                                     │
│  │ ⑥ Analyze   │  테스트 결과 분석, 새 발견사항 추출   │
│  │   & Report  │  finding 생성/업데이트               │
│  └─────┬───────┘                                     │
│        ▼                                              │
│  ┌─────────────┐                                     │
│  │ ⑦ Update    │  DB + SESSION-STATE.md 갱신         │
│  │   State     │                                     │
│  └─────┬───────┘                                     │
│        ▼                                              │
│  ┌─────────────┐  YES                                │
│  │ Rate limit? │──────► Wait & Retry (기존 로직)     │
│  └─────┬───────┘                                     │
│        │ NO                                           │
│        ▼                                              │
│  ┌─────────────┐  YES                                │
│  │ Should Stop?│──────► END (수동 중지 or 예산 초과)  │
│  └─────┬───────┘                                     │
│        │ NO                                           │
│        └──────────────► ② 로 복귀                     │
└──────────────────────────────────────────────────────┘
```

### 2.3 페이즈 (Phase) 정의

사이클 내에서 실행할 작업의 종류. CycleEngine이 상태에 따라 자동 결정한다.

| Phase | 설명 | 언제 실행 |
|-------|------|----------|
| `discovery` | 코드베이스 전체 분석. 버그, 개선점, 아이디어를 찾아 finding으로 등록 | 최초 실행, 또는 backlog가 비었을 때 |
| `fix` | backlog에서 가장 우선순위 높은 finding을 수정 | backlog에 P0/P1 항목이 있을 때 |
| `test` | E2E + unit 테스트 실행 및 결과 분석 | fix 후, 또는 주기적(매 N사이클) |
| `improve` | 리팩토링, 성능 개선, UX 개선 등 | P0/P1 없고 P2 항목이 있을 때 |
| `review` | 이전 사이클에서 변경한 코드 전체 리뷰 | 매 5사이클 또는 큰 변경 후 |

---

## 3. 데이터 모델

### 3.1 신규 DB 테이블

기존 테이블은 수동 모드 전용. 자율 모드는 아래 별도 테이블 사용.

```sql
-- 자율 모드 세션 (한 번의 "자율 모드 켜기~끄기"가 하나의 auto_session)
CREATE TABLE auto_sessions (
  id TEXT PRIMARY KEY,
  target_project TEXT NOT NULL,        -- 대상 프로젝트 경로
  status TEXT NOT NULL DEFAULT 'running',
    -- 'running' | 'paused' | 'waiting_for_limit' | 'completed' | 'stopped'
  total_cycles INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0,
  config TEXT,                          -- JSON: 자율 모드 설정
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 사이클 기록 (하나의 사이클 = 하나의 Claude CLI 실행)
CREATE TABLE auto_cycles (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES auto_sessions(id) ON DELETE CASCADE,
  cycle_number INTEGER NOT NULL,
  phase TEXT NOT NULL,                  -- 'discovery' | 'fix' | 'test' | 'improve' | 'review'
  status TEXT NOT NULL DEFAULT 'running',
    -- 'running' | 'completed' | 'failed' | 'rate_limited' | 'rolled_back'
  finding_id TEXT REFERENCES auto_findings(id),  -- 어떤 finding을 처리했는지 (fix/improve 시)
  prompt_used TEXT,                     -- 실제 실행된 프롬프트
  output TEXT,                          -- Claude 출력
  cost_usd REAL,
  duration_ms INTEGER,
  git_checkpoint TEXT,                  -- checkpoint commit hash
  test_pass_count INTEGER,
  test_fail_count INTEGER,
  test_total_count INTEGER,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

-- 발견 사항 (세션 간 영속 — 가장 중요한 테이블)
CREATE TABLE auto_findings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES auto_sessions(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
    -- 'bug' | 'improvement' | 'idea' | 'test_failure' | 'performance' | 'accessibility' | 'security'
  priority TEXT NOT NULL DEFAULT 'P2',
    -- 'P0' (critical) | 'P1' (important) | 'P2' (nice-to-have) | 'P3' (backlog)
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  file_path TEXT,                       -- 관련 파일 경로
  status TEXT NOT NULL DEFAULT 'open',
    -- 'open' | 'in_progress' | 'resolved' | 'wont_fix' | 'duplicate'
  retry_count INTEGER DEFAULT 0,        -- 수정 시도 횟수 (무한 루프 방지)
  max_retries INTEGER DEFAULT 3,        -- 최대 재시도 횟수
  resolved_by_cycle_id TEXT REFERENCES auto_cycles(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 자율 모드 전용 설정
CREATE TABLE auto_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- 초기 설정 키:
--   'target_project'     : 대상 프로젝트 경로
--   'test_command'       : 테스트 실행 명령어 (예: 'npm run test:e2e')
--   'max_cycles'         : 최대 사이클 수 (0=무제한)
--   'budget_usd'         : 일일 예산 (0=무제한)
--   'discovery_interval' : 매 N사이클마다 discovery 실행
--   'review_interval'    : 매 N사이클마다 review 실행
--   'auto_commit'        : 성공 시 자동 커밋 여부 ('true'/'false')
--   'branch_name'        : 작업 브랜치 이름 (기본: 'auto/improvements')
```

### 3.2 SESSION-STATE.md

DB와 별개로, Claude가 직접 읽고 쓸 수 있는 마크다운 파일.
대상 프로젝트 루트에 `.mlaude/SESSION-STATE.md`로 생성된다.

```markdown
# Autonomous Session State
> Auto-generated by mlaude autonomous mode. Do not edit manually.
> Last updated: 2026-02-23T14:30:00Z | Cycle: 12 | Session: abc-123

## Project Context
- **Path**: /Users/user/source/my-app
- **Stack**: Next.js 16, React 19, Tailwind CSS 4
- **Test Command**: npm run test:e2e

## Current Status
- Active Findings: 8 (P0: 1, P1: 3, P2: 4)
- Resolved This Session: 5
- Test Pass Rate: 85% (17/20)

## Backlog (Priority Order)
### P0 - Critical
- [F-007] Settings API returns 500 on empty working_directory
  - File: src/app/api/settings/route.ts
  - Attempts: 0/3

### P1 - Important
- [F-003] Modal lacks focus trapping — accessibility violation
  - File: src/components/ui/Modal.tsx
  - Attempts: 1/3
- [F-005] History page breaks on large datasets
  - File: src/app/history/page.tsx
  - Attempts: 0/3

### P2 - Nice to Have
- [F-001] Add loading skeleton to dashboard
- [F-009] Improve error messages on form validation

## Recently Resolved
- [F-002] ✅ Dark mode CSS conflicts (Cycle 8)
- [F-004] ✅ Missing aria-labels on icon buttons (Cycle 10)

## Session Log (Last 5 Cycles)
| Cycle | Phase    | Finding | Result              | Cost  |
|-------|----------|---------|---------------------|-------|
| 12    | fix      | F-007   | ✅ resolved         | $0.12 |
| 11    | test     | —       | 17/20 pass          | $0.08 |
| 10    | fix      | F-004   | ✅ resolved         | $0.15 |
| 9     | fix      | F-003   | ❌ failed (1/3)     | $0.11 |
| 8     | fix      | F-002   | ✅ resolved         | $0.09 |
```

이 파일은 각 사이클의 프롬프트에 포함되어 Claude에게 컨텍스트를 제공한다.

---

## 4. 백엔드 구현

### 4.1 신규 파일 구조

```
src/lib/autonomous/
├── cycle-engine.ts         # 사이클 오케스트레이터 (핵심)
├── phase-selector.ts       # 다음 페이즈 결정 로직
├── prompt-builder.ts       # 페이즈별 메타 프롬프트 생성
├── state-manager.ts        # SESSION-STATE.md 읽기/쓰기
├── test-runner.ts          # 테스트 실행 및 결과 파싱
├── git-manager.ts          # checkpoint, rollback, branch 관리
└── types.ts                # 자율 모드 전용 타입 정의
```

### 4.2 CycleEngine (핵심 클래스)

```typescript
// src/lib/autonomous/cycle-engine.ts

class CycleEngine {
  // --- 상태 ---
  private sessionId: string | null;
  private cycleNumber: number;
  private executor: ClaudeExecutor | null;  // 기존 executor 재사용
  private retryTimer: NodeJS.Timeout | null;
  private listeners: Set<(event: AutoSSEEvent) => void>;
  private eventBuffer: AutoSSEEvent[];

  // --- 라이프사이클 ---
  async start(config: AutoConfig): Promise<void>;
    // 1. auto_sessions 레코드 생성
    // 2. git branch 생성 (auto/improvements)
    // 3. SESSION-STATE.md 로드 (없으면 discovery부터)
    // 4. runCycle() 호출

  async stop(): Promise<void>;
    // 1. executor kill
    // 2. 현재 사이클 상태 저장
    // 3. session 'stopped'으로 마킹

  async pause(): Promise<void>;
  async resume(): Promise<void>;

  // --- 사이클 루프 ---
  private async runCycle(): Promise<void>;
    // 1. 정지 조건 체크 (shouldStop)
    // 2. phaseSelector로 다음 페이즈 결정
    // 3. gitManager.checkpoint()
    // 4. promptBuilder로 프롬프트 생성
    // 5. DB에 auto_cycles 레코드 생성
    // 6. executor.execute() 실행
    // 7. 결과 처리 (handleCycleComplete)
    // 8. 다음 사이클 예약

  private async handleCycleComplete(result: CycleResult): Promise<void>;
    // 1. 비용/시간 기록
    // 2. phase가 'test'면 테스트 결과 파싱
    // 3. phase가 'fix'/'improve'면 테스트 재실행
    //    - 실패 시: gitManager.rollback(), finding.retry_count++
    //    - 성공 시: finding.status = 'resolved'
    // 4. phase가 'discovery'/'review'면 출력에서 finding 추출
    // 5. stateManager.update()
    // 6. runCycle() 재호출 (루프)

  private shouldStop(): boolean;
    // - 수동 중지 요청
    // - max_cycles 도달
    // - budget_usd 초과
    // - backlog 비어있고 discovery도 새 항목 없음

  // --- SSE ---
  addListener(cb): () => void;
  private emit(event: AutoSSEEvent): void;
  getStatus(): AutoRunStatus;
}
```

### 4.3 PhaseSelector

```typescript
// src/lib/autonomous/phase-selector.ts

function selectNextPhase(state: SessionState, config: AutoConfig): Phase {
  // 1. 최초 실행 (findings 없음) → 'discovery'
  // 2. P0 finding 존재 (retry_count < max_retries) → 'fix'
  // 3. 매 review_interval 사이클마다 → 'review'
  // 4. fix 직후 또는 매 discovery_interval 사이클마다 → 'test'
  // 5. P1 finding 존재 → 'fix'
  // 6. P2 finding 존재 → 'improve'
  // 7. backlog 비어있음 → 'discovery'
  // 8. discovery도 결과 없음 → 세션 완료
}
```

### 4.4 PromptBuilder

페이즈별로 Claude에게 보낼 프롬프트를 생성한다. 각 프롬프트에는 SESSION-STATE.md의 내용이 컨텍스트로 포함된다.

```typescript
// src/lib/autonomous/prompt-builder.ts

function buildPrompt(phase: Phase, state: SessionState, finding?: Finding): string;
```

#### Discovery 프롬프트

```
당신은 이 프로젝트의 코드 품질 분석가입니다.

[프로젝트 컨텍스트]
{SESSION-STATE.md 내용}

[작업]
코드베이스를 분석하여 아래 카테고리의 문제점/개선점을 찾으세요:
1. 버그 (에러 핸들링 누락, 엣지 케이스 등)
2. 테스트 커버리지 부족
3. 접근성(a11y) 문제
4. 성능 개선 가능 사항
5. 보안 취약점
6. UX 개선 아이디어

[출력 형식]
반드시 아래 JSON 형식으로만 출력하세요:
{
  "findings": [
    {
      "category": "bug|improvement|idea|performance|accessibility|security",
      "priority": "P0|P1|P2|P3",
      "title": "간결한 제목",
      "description": "상세 설명 (재현 방법 또는 개선 방안 포함)",
      "file_path": "관련 파일 경로 (optional)"
    }
  ]
}

이미 발견된 항목 (중복 방지):
{기존 findings 목록}
```

#### Fix 프롬프트

```
당신은 이 프로젝트의 시니어 개발자입니다.

[프로젝트 컨텍스트]
{SESSION-STATE.md 내용}

[수정할 문제]
- ID: {finding.id}
- 카테고리: {finding.category}
- 우선순위: {finding.priority}
- 제목: {finding.title}
- 설명: {finding.description}
- 관련 파일: {finding.file_path}
- 이전 시도: {finding.retry_count}회 (최대 {finding.max_retries}회)

[작업]
1. 위 문제를 수정하세요.
2. 관련 테스트가 있다면 테스트도 수정하세요.
3. 새로운 테스트가 필요하면 추가하세요.
4. 변경 사항을 최소화하세요 — 문제와 직접 관련된 코드만 수정합니다.

[제약]
- 기존 기능을 깨뜨리지 마세요.
- 불필요한 리팩토링을 하지 마세요.
- 파일 삭제는 하지 마세요.
```

#### Test 프롬프트

```
[작업]
다음 명령어로 테스트를 실행하고 결과를 분석하세요:

{test_command}

[출력 형식]
반드시 아래 JSON 형식으로만 출력하세요:
{
  "summary": {
    "total": 숫자,
    "passed": 숫자,
    "failed": 숫자,
    "skipped": 숫자
  },
  "failures": [
    {
      "test_name": "테스트 이름",
      "file_path": "테스트 파일 경로",
      "error_message": "에러 메시지",
      "category": "bug|regression|flaky",
      "priority": "P0|P1|P2",
      "suggested_fix": "수정 방향 제안"
    }
  ],
  "new_findings": [
    ... (테스트 결과에서 발견된 새로운 이슈)
  ]
}
```

#### Improve 프롬프트

```
Fix 프롬프트와 유사하나, 톤이 다름:
- "수정"이 아닌 "개선"
- 테스트 추가를 더 강조
- 변경 범위를 더 제한적으로
```

#### Review 프롬프트

```
[작업]
최근 {N}개 사이클에서 변경된 코드를 리뷰하세요.

git diff {base_checkpoint}..HEAD

[관점]
1. 코드 품질 — 가독성, 일관성, 중복 제거
2. 버그 가능성 — 엣지 케이스, 에러 핸들링
3. 성능 — 불필요한 연산, 메모리 누수 가능성
4. 보안 — 입력 검증, XSS, 인젝션

[출력 형식]
findings JSON (discovery와 동일)
```

### 4.5 GitManager

```typescript
// src/lib/autonomous/git-manager.ts

class GitManager {
  constructor(private projectPath: string);

  async ensureBranch(branchName: string): Promise<void>;
    // 브랜치가 없으면 생성, 있으면 checkout

  async checkpoint(message: string): Promise<string>;
    // git add -A && git commit -m "..."
    // 반환: commit hash

  async rollback(commitHash: string): Promise<void>;
    // git reset --hard {commitHash}

  async getDiff(fromHash: string): Promise<string>;
    // git diff {fromHash}..HEAD

  async getStatus(): Promise<GitStatus>;
    // git status --porcelain
}
```

### 4.6 TestRunner

```typescript
// src/lib/autonomous/test-runner.ts

class TestRunner {
  constructor(private projectPath: string, private testCommand: string);

  async run(): Promise<TestResult>;
    // child_process.exec(testCommand)
    // stdout/stderr 파싱하여 구조화된 결과 반환

  parseResult(stdout: string, stderr: string): TestResult;
    // Playwright, Vitest 등 주요 프레임워크 출력 패턴 파싱
}
```

### 4.7 Finding 추출 로직

Claude 출력에서 finding을 추출하는 방법:

1. **구조화된 출력 파싱**: 프롬프트에서 JSON 출력을 요구하므로, Claude 출력에서 JSON 블록을 추출
2. **중복 검사**: 기존 findings와 title/file_path 유사도 비교하여 중복 방지
3. **자동 우선순위 검증**: Claude가 부여한 우선순위를 그대로 사용하되, test_failure는 항상 P0

```typescript
// finding 추출 흐름
function extractFindings(claudeOutput: string, existingFindings: Finding[]): Finding[] {
  const jsonBlock = extractJsonFromOutput(claudeOutput);
  const rawFindings = JSON.parse(jsonBlock).findings;
  return rawFindings
    .filter(f => !isDuplicate(f, existingFindings))
    .map(f => ({ ...f, id: generateId(), status: 'open' }));
}
```

---

## 5. API 설계

모든 자율 모드 API는 `/api/auto/` 접두사를 사용한다.

### 5.1 엔드포인트 목록

```
# 세션 제어
POST   /api/auto/start              자율 모드 시작
DELETE /api/auto/stop               자율 모드 중지
PATCH  /api/auto/pause              일시정지
PATCH  /api/auto/resume             재개

# 상태 조회
GET    /api/auto/status             현재 상태 (폴링용)
GET    /api/auto/stream             SSE 스트림 (실시간)

# 세션 히스토리
GET    /api/auto/sessions           세션 목록
GET    /api/auto/sessions/:id       세션 상세

# 사이클 히스토리
GET    /api/auto/cycles             사이클 목록 (필터: session_id, phase, status)
GET    /api/auto/cycles/:id         사이클 상세 (출력 포함)

# Findings (세션 간 영속)
GET    /api/auto/findings           finding 목록 (필터: status, priority, category)
PUT    /api/auto/findings/:id       finding 수동 편집 (우선순위 변경, wont_fix 등)
DELETE /api/auto/findings/:id       finding 삭제

# 자율 모드 설정
GET    /api/auto/settings           설정 조회
PUT    /api/auto/settings           설정 변경
```

### 5.2 주요 요청/응답 형식

#### POST /api/auto/start

```json
// Request
{
  "target_project": "/Users/user/source/my-app",
  "test_command": "npm run test:e2e",
  "branch_name": "auto/improvements",    // optional
  "max_cycles": 0,                       // 0=무제한
  "budget_usd": 10.0                     // 0=무제한
}

// Response 201
{
  "session_id": "uuid",
  "status": "running",
  "message": "Autonomous mode started"
}
```

#### GET /api/auto/status

```json
// Response
{
  "session_id": "uuid",
  "status": "running",
  "current_cycle": 12,
  "current_phase": "fix",
  "current_finding": {
    "id": "F-007",
    "title": "Settings API returns 500 on empty path"
  },
  "stats": {
    "total_cycles": 12,
    "total_cost_usd": 1.45,
    "findings_total": 13,
    "findings_resolved": 5,
    "findings_open": 8,
    "test_pass_rate": 0.85
  },
  "waiting_until": null,
  "retry_count": 0
}
```

### 5.3 SSE 이벤트 타입

기존 수동 모드의 SSE와 별도 스트림. `/api/auto/stream` 전용.

```typescript
type AutoSSEEventType =
  | 'cycle_start'        // 새 사이클 시작
  | 'cycle_complete'     // 사이클 완료
  | 'cycle_failed'       // 사이클 실패
  | 'phase_change'       // 페이즈 변경
  | 'finding_created'    // 새 finding 발견
  | 'finding_resolved'   // finding 해결
  | 'finding_failed'     // finding 수정 실패
  | 'test_result'        // 테스트 결과
  | 'git_checkpoint'     // git checkpoint 생성
  | 'git_rollback'       // git rollback 실행
  | 'text_delta'         // Claude 실시간 출력 (기존과 동일)
  | 'tool_start'         // 도구 사용 시작
  | 'tool_end'           // 도구 사용 종료
  | 'rate_limit'         // rate limit 감지
  | 'session_status'     // 세션 상태 변경
  | 'error';             // 에러 발생
```

---

## 6. 프론트엔드 구현

### 6.1 라우트 구조

```
src/app/
├── page.tsx                    # 대시보드 (모드 토글 포함)
├── auto/
│   ├── page.tsx                # 자율 모드 메인 (대시보드 + 실시간 뷰어)
│   ├── cycles/
│   │   └── page.tsx            # 사이클 히스토리
│   ├── findings/
│   │   └── page.tsx            # Findings 관리
│   ├── history/
│   │   └── page.tsx            # 세션 히스토리
│   └── settings/
│       └── page.tsx            # 자율 모드 설정
```

### 6.2 모드 토글

앱 상단 바 또는 사이드바에 토글 스위치를 배치한다.
토글 상태는 `localStorage`에 저장되어 새로고침 시에도 유지.

```
┌──────────────────────────────────────┐
│  mlaude      [Manual] ◉ Autonomous │
│  ─────────────────────────────────── │
│  📋 Dashboard                        │
│  🔄 Live View     ← 자율 모드 시     │
│  📊 Cycles           사이드바 메뉴가  │
│  🔍 Findings         자동으로 변경됨  │
│  📜 History                          │
│  ⚙️ Settings                         │
└──────────────────────────────────────┘
```

### 6.3 자율 모드 대시보드 (`/auto`)

```
┌──────────────────────────────────────────────────────┐
│  Autonomous Mode                    [Start] [Stop]   │
│ ─────────────────────────────────────────────────────│
│                                                       │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────────┐  │
│  │ Cycles  │ │ Open    │ │Resolved │ │ Test Rate │  │
│  │   12    │ │   8     │ │    5    │ │   85%     │  │
│  └─────────┘ └─────────┘ └─────────┘ └───────────┘  │
│                                                       │
│  Current: Cycle #13 — Phase: fix                     │
│  Finding: [P0] Settings API returns 500...           │
│  ┌─────────────────────────────────────────────┐     │
│  │ > Reading src/app/api/settings/route.ts...  │     │
│  │ > Adding validation for working_directory   │     │
│  │ > Writing file...                           │     │
│  │ > █                                         │     │
│  └─────────────────────────────────────────────┘     │
│                                                       │
│  Recent Cycles                                       │
│  ┌──────┬──────────┬─────────┬──────────┬──────┐    │
│  │ #12  │ fix      │ F-007   │ ✅ done  │$0.12 │    │
│  │ #11  │ test     │ —       │ 17/20    │$0.08 │    │
│  │ #10  │ fix      │ F-004   │ ✅ done  │$0.15 │    │
│  └──────┴──────────┴─────────┴──────────┴──────┘    │
│                                                       │
│  Total Cost: $1.45                                   │
└──────────────────────────────────────────────────────┘
```

### 6.4 Findings 페이지 (`/auto/findings`)

```
┌──────────────────────────────────────────────────────┐
│  Findings                                            │
│  Filter: [All ▾] [Open ▾] [P0-P3 ▾] [Category ▾]   │
│ ─────────────────────────────────────────────────────│
│                                                       │
│  ● P0  Settings API returns 500 on empty path  [bug] │
│    src/app/api/settings/route.ts                     │
│    Status: in_progress (attempt 1/3)                 │
│                                                       │
│  ● P1  Modal lacks focus trapping         [a11y]     │
│    src/components/ui/Modal.tsx                        │
│    Status: open                                      │
│                                                       │
│  ✅ P1  Dark mode CSS conflicts            [bug]     │
│    src/app/globals.css                               │
│    Resolved in Cycle #8                              │
│                                                       │
│  ...                                                 │
└──────────────────────────────────────────────────────┘
```

### 6.5 사이클 상세 페이지 (`/auto/cycles`)

```
┌──────────────────────────────────────────────────────┐
│  Cycles                                              │
│ ─────────────────────────────────────────────────────│
│                                                       │
│  ┌────┬──────────┬─────────┬──────────┬──────┬─────┐ │
│  │ #  │ Phase    │ Finding │ Status   │ Cost │Time │ │
│  ├────┼──────────┼─────────┼──────────┼──────┼─────┤ │
│  │ 13 │ fix      │ F-007   │ running  │ —    │ —   │ │
│  │ 12 │ fix      │ F-007   │ done     │$0.12 │ 45s │ │
│  │ 11 │ test     │ —       │ done     │$0.08 │ 30s │ │
│  │ 10 │ fix      │ F-004   │ done     │$0.15 │ 52s │ │
│  │  9 │ fix      │ F-003   │ rollback │$0.11 │ 38s │ │
│  │  8 │ discovery│ —       │ done     │$0.20 │ 90s │ │
│  └────┴──────────┴─────────┴──────────┴──────┴─────┘ │
│                                                       │
│  [Click row for detail with full output]             │
└──────────────────────────────────────────────────────┘
```

---

## 7. 안전장치

### 7.1 Git 기반 보호

| 상황 | 대응 |
|------|------|
| 사이클 시작 전 | `git checkpoint` — 자동 커밋으로 현재 상태 저장 |
| 테스트 실패 (fix/improve 후) | `git rollback` — checkpoint로 되돌림 |
| 자율 모드 전체 | 전용 브랜치에서 작업 (`auto/improvements`) |

### 7.2 무한 루프 방지

| 보호 장치 | 설명 |
|-----------|------|
| `retry_count` / `max_retries` | finding별 최대 수정 시도 횟수. 초과 시 `wont_fix`로 자동 마킹 |
| `max_cycles` | 세션 최대 사이클 수. 도달 시 자동 종료 |
| `budget_usd` | 비용 한도. 초과 시 자동 종료 |
| 연속 실패 감지 | 최근 5사이클 모두 실패/rollback 시 자동 일시정지 |
| Discovery 빈 결과 | 새 finding이 없으면 세션 완료 처리 |

### 7.3 충돌 방지

수동 모드와 자율 모드는 동시에 실행될 수 없다.
한쪽이 실행 중이면 다른 쪽은 시작할 수 없도록 차단.

```typescript
// POST /api/auto/start
if (runManager.getStatus().status !== 'idle') {
  return Response.json({ error: 'Manual mode is running' }, { status: 409 });
}

// POST /api/run (기존)
if (cycleEngine.getStatus().status !== 'idle') {
  return Response.json({ error: 'Autonomous mode is running' }, { status: 409 });
}
```

---

## 8. 구현 순서

### Phase 1: 기반 (Backend Core)

1. DB 마이그레이션 — 자율 모드 테이블 4개 추가
2. `src/lib/autonomous/types.ts` — 타입 정의
3. `src/lib/autonomous/git-manager.ts` — git 조작
4. `src/lib/autonomous/test-runner.ts` — 테스트 실행/파싱
5. `src/lib/autonomous/state-manager.ts` — SESSION-STATE.md 관리
6. `src/lib/autonomous/prompt-builder.ts` — 메타 프롬프트 생성
7. `src/lib/autonomous/phase-selector.ts` — 페이즈 결정 로직
8. `src/lib/autonomous/cycle-engine.ts` — 사이클 엔진

### Phase 2: API

9. `src/app/api/auto/start/route.ts`
10. `src/app/api/auto/stop/route.ts` + pause + resume
11. `src/app/api/auto/status/route.ts`
12. `src/app/api/auto/stream/route.ts` (SSE)
13. `src/app/api/auto/sessions/route.ts`
14. `src/app/api/auto/cycles/route.ts`
15. `src/app/api/auto/findings/route.ts`
16. `src/app/api/auto/settings/route.ts`

### Phase 3: Frontend

17. 모드 토글 — AppLayout/Sidebar 수정
18. `/auto/page.tsx` — 자율 모드 대시보드
19. `/auto/findings/page.tsx` — Findings 관리
20. `/auto/cycles/page.tsx` — 사이클 히스토리
21. `/auto/history/page.tsx` — 세션 히스토리
22. `/auto/settings/page.tsx` — 자율 모드 설정
23. 자율 모드 전용 SSE 훅 (`useAutoSSE.ts`)

### Phase 4: 안전장치 & 통합 테스트

24. 충돌 방지 로직 (수동/자율 동시 실행 차단)
25. 무한 루프 방지 로직
26. E2E 테스트 (자율 모드 UI)
27. 통합 테스트 (사이클 엔진 + git + test runner)

---

## 9. 설정 기본값

```
target_project      : (필수 — 시작 시 입력)
test_command        : "npm test"
max_cycles          : 0 (무제한)
budget_usd          : 0 (무제한)
discovery_interval  : 10 (매 10사이클마다 discovery)
review_interval     : 5 (매 5사이클마다 review)
auto_commit         : true
branch_name         : "auto/improvements"
max_retries         : 3 (finding별)
```

---

## 10. 크로스-세션 동작

```
[세션 A] 시작
  → auto_sessions 생성
  → discovery 실행 → findings 10개 생성
  → fix 3개 → test → fix 2개
  → rate limit → 대기 → 재시도
  → 사용자가 수동 중지 (또는 usage limit 도달)
  → SESSION-STATE.md 저장
  → auto_sessions.status = 'stopped'

[세션 B] 시작 (다음 날 또는 몇 시간 후)
  → auto_sessions 신규 생성
  → SESSION-STATE.md 읽기 → 이전 세션의 findings 로드
  → 아직 open인 findings 7개 → backlog
  → fix 재개 → test → discovery (새로운 이슈 탐색)
  → ...반복
```

핵심: `auto_findings` 테이블과 `SESSION-STATE.md`가 세션 간 브릿지.
새 세션 시작 시 이전 세션의 open findings를 자동으로 가져온다.
