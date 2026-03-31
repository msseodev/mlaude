# Autonomous Mode v2 — PRD

## 1. 개요

### 1.1 배경

현재 자율 모드(v1)는 단일 에이전트가 discovery → fix → test → improve → review 사이클을 반복하는 구조다.
이 방식은 기존 프로젝트의 버그 수정이나 개선에는 적합하지만, 다음과 같은 한계가 있다:

1. **프로젝트 생성 불가** — 빈 디렉토리에서 시작할 때 "무엇을 만들지" 알 수 없음
2. **사용자 방향 제시 불가** — 실행 중 사용자가 방향을 수정하거나 새로운 지시를 내릴 수 없음
3. **단일 역할의 한계** — 하나의 프롬프트가 기획/개발/리뷰/QA를 모두 담당하면 각 역할의 깊이가 얕아짐

### 1.2 목표

- **User Prompt 시스템**: 사용자가 초기 의도를 전달하고, 실행 중에도 방향을 조정할 수 있게 한다
- **Agent Pipeline**: 역할별 전문 에이전트가 순차적으로 협업하는 파이프라인을 구성한다
- **Agent 정의 시스템**: 마크다운 형식으로 에이전트를 정의하고 커스터마이징할 수 있게 한다

### 1.3 핵심 변경 요약

| 항목 | v1 (현재) | v2 (목표) |
|------|-----------|-----------|
| 사이클 구조 | Phase 기반 (discovery/fix/test/...) | Agent Pipeline (Designer → Developer → Reviewer → QA) |
| 사용자 입력 | 없음 (자동 판단) | 초기 prompt + 중간 prompt 주입 |
| 에이전트 수 | 1 (단일) | 4 (파이프라인, 커스터마이징 가능) |
| 프로젝트 생성 | 불가 | 가능 (초기 prompt 기반) |

---

## 2. User Prompt 시스템

### 2.1 개념

```
┌──────────────────────────────────────────────────┐
│                  User Prompt                      │
│                                                   │
│  = Initial Prompt + Mid-Session Prompts (누적)    │
│                                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │ Initial Prompt                               │ │
│  │ "React + TypeScript로 할일 관리 앱을 만들어줘. │ │
│  │  Tailwind CSS 사용, 모바일 우선 반응형 UI,    │ │
│  │  로컬 스토리지로 데이터 영속화"               │ │
│  └─────────────────────────────────────────────┘ │
│                     +                             │
│  ┌─────────────────────────────────────────────┐ │
│  │ Mid-Session Prompt #1 (Cycle 5에서 추가)     │ │
│  │ "다크모드 지원을 추가해줘"                    │ │
│  └─────────────────────────────────────────────┘ │
│                     +                             │
│  ┌─────────────────────────────────────────────┐ │
│  │ Mid-Session Prompt #2 (Cycle 12에서 추가)    │ │
│  │ "드래그앤드롭으로 할일 순서 변경 가능하게"    │ │
│  └─────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### 2.2 Initial Prompt (초기 프롬프트)

**자율 모드 시작 시 사용자가 입력하는 프로젝트 의도.**

- 자율 모드 시작 버튼 클릭 시 모달/입력 영역이 표시됨
- 빈 디렉토리 → **필수** (무엇을 만들지 모르면 시작 불가)
- 기존 프로젝트 → **선택** (없으면 v1처럼 자동 분석부터 시작)
- DB에 `auto_sessions.initial_prompt` 컬럼으로 저장
- 모든 에이전트의 프롬프트에 컨텍스트로 주입됨

**입력 예시:**

```
React와 Next.js로 개인 블로그 플랫폼을 만들어줘.
- 마크다운으로 글 작성
- 태그 기반 분류
- 다크/라이트 테마
- SEO 최적화
- 반응형 모바일 지원
```

### 2.3 Mid-Session Prompt (중간 프롬프트)

**세션 실행 중(또는 일시정지 후 재개 시) 사용자가 추가하는 지시.**

- 일시정지(Pause) 상태에서 재개(Resume) 시 프롬프트 입력 가능
- 실행 중에도 "Add Prompt" 버튼으로 즉시 추가 가능 (다음 사이클부터 반영)
- `auto_user_prompts` 테이블에 누적 저장
- User Prompt = Initial Prompt + 모든 Mid-Session Prompts (시간순 합산)
- 각 에이전트는 매 사이클 시작 시 최신 User Prompt를 받음

### 2.4 User Prompt 구성 규칙

```typescript
function buildUserPrompt(session: AutoSession, prompts: AutoUserPrompt[]): string {
  const parts: string[] = [];

  // 1. Initial Prompt (항상 최상단)
  if (session.initial_prompt) {
    parts.push(`## 프로젝트 목표\n${session.initial_prompt}`);
  }

  // 2. Mid-Session Prompts (시간순)
  if (prompts.length > 0) {
    parts.push(`## 추가 지시사항`);
    for (const p of prompts) {
      parts.push(`- [Cycle ${p.added_at_cycle}] ${p.content}`);
    }
  }

  return parts.join('\n\n');
}
```

---

## 3. Agent Pipeline

### 3.1 구조

하나의 사이클에서 에이전트가 **순차적 파이프라인**으로 실행된다.
각 에이전트의 출력이 다음 에이전트의 입력(컨텍스트)이 된다.

```
┌─────────────────────────────────────────────────────────────┐
│                      Cycle #N                                │
│                                                              │
│  ┌─────────────┐   ┌───────────┐   ┌──────────┐   ┌──────┐ │
│  │   Product    │──▶│ Developer │──▶│ Reviewer │──▶│  QA  │ │
│  │  Designer    │   │           │   │          │   │      │ │
│  └─────────────┘   └───────────┘   └──────────┘   └──────┘ │
│        │                 │               │             │     │
│        ▼                 ▼               ▼             ▼     │
│  ┌───────────┐   ┌───────────┐   ┌───────────┐ ┌─────────┐ │
│  │  Feature   │   │   Code    │   │  Review   │ │  Test   │ │
│  │   Spec     │   │  Changes  │   │ Feedback  │ │ Results │ │
│  └───────────┘   └───────────┘   └───────────┘ └─────────┘ │
│                                        │                     │
│                                        ▼                     │
│                                  ┌───────────┐              │
│                                  │ Developer  │ (피드백 반영) │
│                                  │  (2nd run) │              │
│                                  └───────────┘              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 파이프라인 실행 흐름

```
1. [Product Designer] User Prompt + SESSION-STATE.md를 분석
   → 이번 사이클에서 작업할 기능/태스크 스펙 출력
   → output: Feature Spec (JSON)

2. [Developer] Feature Spec + User Prompt + SESSION-STATE.md를 받아
   → 코드 구현
   → output: 코드 변경사항

3. [Reviewer] Developer의 코드 변경사항을 리뷰
   → 코드 품질, 버그 가능성, 설계 피드백
   → output: Review Feedback (JSON)
   → 이슈 발견 시 → Developer 재실행 (최대 N회)

4. [QA Engineer] 테스트 실행 + 결과 분석
   → 테스트 통과 여부, 새로운 버그 발견
   → output: Test Report
   → 테스트 실패 시 → Developer 재실행 또는 rollback
```

### 3.3 Reviewer ↔ Developer 반복 루프

Reviewer가 이슈를 발견하면 Developer에게 피드백을 전달하고 재실행한다.
무한 루프 방지를 위해 **최대 반복 횟수(review_max_iterations)** 설정이 있다.

```
Developer → Reviewer → [이슈 있음?]
                           │
                  YES ──── │ ──── NO
                  │                │
                  ▼                ▼
            Developer         QA Engineer
           (피드백 반영)      (테스트 실행)
                  │
                  ▼
              Reviewer
            (재리뷰, 최대 N회)
```

기본값: `review_max_iterations = 2` (Developer 최대 2회 추가 수정)

### 3.4 QA 실패 시 처리

```
QA Engineer → [테스트 통과?]
                   │
          YES ──── │ ──── NO
          │                │
          ▼                ▼
     사이클 완료      [rollback 설정?]
     (다음 사이클)          │
                    YES ── │ ── NO
                    │            │
                    ▼            ▼
              Git Rollback   Finding 생성
              + Finding 생성  (다음 사이클에서 fix)
```

---

## 4. Agent 정의 시스템

### 4.1 개념

에이전트는 `.md` 파일 형식으로 정의된다. Claude Code의 `.claude/agents/*.md`와 동일한 개념이다.
mlaude는 이 정의를 DB에 저장하고, UI에서 편집할 수 있게 한다.

### 4.2 Agent 정의 형식

각 에이전트는 다음 구조의 마크다운 문서로 정의된다:

```markdown
# Product Designer

## Role
서비스의 기능 스펙과 UX를 설계하는 프로덕트 디자이너입니다.
엔지니어가 아닌 기획자의 관점에서, 사용자 경험을 중심으로 기능을 정의합니다.

## System Prompt
당신은 프로덕트 디자이너입니다.

사용자의 요구사항(User Prompt)과 현재 프로젝트 상태(Session State)를 분석하여,
이번 사이클에서 개발해야 할 기능의 스펙을 작성하세요.

### 역할
- 사용자의 의도를 구체적인 기능 요구사항으로 변환
- UI/UX 흐름 설계
- 우선순위 결정 (어떤 기능을 먼저 만들지)
- 수용 기준(Acceptance Criteria) 정의

### 제약
- 기술적 구현 방법을 지시하지 마세요 (Developer의 영역)
- 이미 구현된 기능은 다시 정의하지 마세요
- 한 사이클에 너무 많은 기능을 넣지 마세요 (1~3개가 적당)

### 출력 형식
반드시 아래 JSON 형식으로 출력하세요:
{
  "features": [
    {
      "title": "기능 제목",
      "description": "상세 설명",
      "acceptance_criteria": ["기준1", "기준2"],
      "priority": "P0|P1|P2",
      "ui_flow": "사용자 흐름 설명 (optional)"
    }
  ],
  "notes": "Developer에게 전달할 추가 참고사항"
}

## Pipeline Order
1

## Enabled
true
```

### 4.3 기본 에이전트 정의

#### 4.3.1 Product Designer (파이프라인 순서: 1)

| 항목 | 값 |
|------|-----|
| **역할** | 서비스 스펙/기능/UX 정의 |
| **입력** | User Prompt + SESSION-STATE.md |
| **출력** | Feature Spec (JSON) |
| **관점** | 사용자 경험 중심, 비즈니스 요구사항 |

- 빈 프로젝트: 초기 아키텍처와 핵심 기능 정의
- 기존 프로젝트: 다음 구현할 기능 또는 개선점 도출
- 사용자의 추가 지시(Mid-Session Prompt)를 우선 반영

#### 4.3.2 Developer (파이프라인 순서: 2)

| 항목 | 값 |
|------|-----|
| **역할** | 코드 구현 |
| **입력** | Feature Spec (Designer 출력) + User Prompt + SESSION-STATE.md |
| **출력** | 코드 변경사항 |
| **관점** | 기술적 구현, 코드 품질 |

- Feature Spec의 요구사항을 코드로 구현
- 필요한 경우 테스트 코드도 작성
- Reviewer 피드백 수신 시: 피드백 내용을 반영하여 코드 수정
- 최소한의 변경 원칙 (불필요한 리팩토링 금지)

#### 4.3.3 Reviewer (파이프라인 순서: 3)

| 항목 | 값 |
|------|-----|
| **역할** | 코드 리뷰 |
| **입력** | Developer의 코드 변경사항 (git diff) + Feature Spec |
| **출력** | Review Feedback (JSON) |
| **관점** | 코드 품질, 버그 가능성, 설계 일관성 |

- Developer가 작성한 코드의 품질 검증
- 버그 가능성, 엣지 케이스, 에러 핸들링 점검
- Feature Spec 대비 누락된 요구사항 확인
- 이슈 발견 시 Developer에게 구체적 피드백 전달

**출력 형식:**
```json
{
  "approved": false,
  "issues": [
    {
      "severity": "critical|major|minor",
      "file": "src/path/to/file.ts",
      "description": "이슈 설명",
      "suggestion": "수정 제안"
    }
  ],
  "summary": "전체 리뷰 요약"
}
```

- `approved: true` → QA 단계로 진행
- `approved: false` + critical/major 이슈 → Developer 재실행

#### 4.3.4 QA Engineer (파이프라인 순서: 4)

| 항목 | 값 |
|------|-----|
| **역할** | 테스트 실행 및 품질 검증 |
| **입력** | 코드 변경사항 + Feature Spec + test_command |
| **출력** | Test Report (JSON) |
| **관점** | 기능 동작 검증, 회귀 방지 |

- 설정된 테스트 명령어 실행
- Feature Spec의 Acceptance Criteria 기반 검증
- 테스트 결과 분석 및 구조화된 리포트 생성
- 실패 시 Finding 생성 (다음 사이클에서 수정)

### 4.4 커스텀 에이전트

사용자는 기본 4개 에이전트 외에 추가 에이전트를 정의할 수 있다.

**예시: Security Auditor (보안 감사자)**

```markdown
# Security Auditor

## Role
코드의 보안 취약점을 분석하는 보안 전문가입니다.

## System Prompt
당신은 보안 전문가입니다. 코드에서 다음을 점검하세요:
- XSS, SQL Injection, CSRF 등 OWASP Top 10
- 인증/인가 로직
- 민감 데이터 노출
- 의존성 취약점

## Pipeline Order
3.5

## Enabled
true
```

`Pipeline Order`가 3.5이면 Reviewer(3)와 QA(4) 사이에 실행된다.
소수점 순서로 기존 파이프라인 사이에 에이전트를 삽입할 수 있다.

### 4.5 에이전트 비활성화

`Enabled: false`로 설정하면 파이프라인에서 제외된다.
예: Reviewer를 비활성화하면 Developer → QA로 직행.

---

## 5. 데이터 모델

### 5.1 변경 사항

#### 기존 테이블 수정

```sql
-- auto_sessions: 초기 프롬프트 추가
ALTER TABLE auto_sessions ADD COLUMN initial_prompt TEXT;
```

#### 신규 테이블

```sql
-- 사용자 프롬프트 누적 (Mid-Session Prompts)
CREATE TABLE auto_user_prompts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES auto_sessions(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  added_at_cycle INTEGER NOT NULL DEFAULT 0,  -- 어떤 사이클에서 추가되었는지
  created_at TEXT NOT NULL
);

-- 에이전트 정의
CREATE TABLE auto_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,          -- 'product_designer', 'developer', 'reviewer', 'qa_engineer'
  display_name TEXT NOT NULL,          -- 'Product Designer'
  role_description TEXT NOT NULL,      -- 역할 한줄 설명
  system_prompt TEXT NOT NULL,         -- 전체 시스템 프롬프트 (마크다운)
  pipeline_order REAL NOT NULL,        -- 실행 순서 (소수점 가능: 1, 2, 3, 3.5, 4)
  enabled INTEGER NOT NULL DEFAULT 1,  -- 1=활성, 0=비활성
  is_builtin INTEGER NOT NULL DEFAULT 0, -- 1=기본 에이전트 (삭제 불가)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 에이전트 실행 기록 (사이클 내 각 에이전트의 실행 기록)
CREATE TABLE auto_agent_runs (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL REFERENCES auto_cycles(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES auto_agents(id),
  agent_name TEXT NOT NULL,            -- 조회 편의용 (비정규화)
  iteration INTEGER NOT NULL DEFAULT 1, -- Reviewer ↔ Developer 반복 시 회차
  status TEXT NOT NULL DEFAULT 'running',
    -- 'running' | 'completed' | 'failed' | 'skipped'
  prompt TEXT NOT NULL,                -- 실제 실행된 프롬프트
  output TEXT NOT NULL DEFAULT '',     -- 에이전트 출력
  cost_usd REAL,
  duration_ms INTEGER,
  started_at TEXT NOT NULL,
  completed_at TEXT
);
```

### 5.2 신규 설정 키 (auto_settings)

| key | default | 설명 |
|-----|---------|------|
| `review_max_iterations` | `2` | Reviewer ↔ Developer 최대 반복 횟수 |
| `skip_designer_for_fixes` | `true` | finding 수정 시 Product Designer 건너뛰기 |
| `require_initial_prompt` | `false` | 초기 프롬프트 필수 여부 |

---

## 6. 사이클 흐름 (v2)

### 6.1 전체 흐름

```
┌──────────────────────────────────────────────────────────────────┐
│                     Cycle #N                                      │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 1. 준비                                                      │ │
│  │    - Safety 체크 (max_cycles, budget, consecutive_failures)  │ │
│  │    - User Prompt 빌드 (initial + mid-session prompts)       │ │
│  │    - SESSION-STATE.md 로드                                  │ │
│  │    - Git Checkpoint                                         │ │
│  └──────────────────────────┬──────────────────────────────────┘ │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 2. Agent Pipeline 실행                                       │ │
│  │                                                              │ │
│  │    활성화된 에이전트를 pipeline_order 순으로 실행:             │ │
│  │                                                              │ │
│  │    for (const agent of enabledAgents) {                     │ │
│  │      context = buildAgentContext(agent, previousOutputs)    │ │
│  │      result = await executeAgent(agent, context)            │ │
│  │      previousOutputs.push(result)                           │ │
│  │                                                              │ │
│  │      // Reviewer → Developer 루프                            │ │
│  │      if (agent.name === 'reviewer' && !result.approved) {   │ │
│  │        loop Developer → Reviewer (최대 N회)                  │ │
│  │      }                                                      │ │
│  │    }                                                        │ │
│  └──────────────────────────┬──────────────────────────────────┘ │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 3. 결과 처리                                                  │ │
│  │    - QA 실패 시: rollback + finding 생성                     │ │
│  │    - 성공 시: finding resolved + git commit                  │ │
│  │    - SESSION-STATE.md 업데이트                               │ │
│  │    - DB 기록 (auto_cycles, auto_agent_runs)                 │ │
│  └──────────────────────────┬──────────────────────────────────┘ │
│                              ▼                                    │
│                        다음 사이클로                               │
└──────────────────────────────────────────────────────────────────┘
```

### 6.2 Finding 수정 사이클

기존 Finding을 수정하는 사이클에서는 파이프라인이 약간 달라진다:

- `skip_designer_for_fixes = true` (기본값): Designer를 건너뛰고 Developer부터 시작
- Developer에게 Finding 정보가 Feature Spec 대신 전달됨
- 나머지 흐름은 동일 (Reviewer → QA)

```
[Finding 수정 사이클]
Developer (finding 기반) → Reviewer → QA
```

### 6.3 Phase 대체

v1의 Phase 시스템(discovery/fix/test/improve/review)은 v2에서 Agent Pipeline으로 대체된다.

| v1 Phase | v2 대응 |
|----------|---------|
| `discovery` | Product Designer가 담당 (기능 발견/정의) |
| `fix` | Developer가 Finding 기반으로 수정 |
| `test` | QA Engineer가 담당 |
| `improve` | Product Designer가 개선점 도출 → Developer 구현 |
| `review` | Reviewer가 매 사이클 담당 |

v1의 `phase` 컬럼은 유지하되, v2에서는 `'pipeline'`으로 통일.
세부 진행 상태는 `auto_agent_runs` 테이블로 추적.

---

## 7. Agent Context 빌드

각 에이전트는 실행 시 다음 컨텍스트를 받는다:

### 7.1 공통 컨텍스트 (모든 에이전트)

```
[User Prompt]
{buildUserPrompt() 결과}

[Session State]
{SESSION-STATE.md 내용}
```

### 7.2 에이전트별 추가 컨텍스트

| Agent | 추가 컨텍스트 |
|-------|--------------|
| Product Designer | 현재 open findings 목록, 최근 QA 결과 |
| Developer | 이전 에이전트(Designer)의 출력 (Feature Spec), Reviewer 피드백 (반복 시) |
| Reviewer | Developer의 코드 변경사항 (git diff), Feature Spec |
| QA Engineer | Feature Spec, test_command, 코드 변경사항 요약 |

### 7.3 컨텍스트 빌드 함수

```typescript
function buildAgentContext(
  agent: AutoAgent,
  session: AutoSession,
  userPrompt: string,
  stateContext: string,
  previousOutputs: Map<string, string>,
  finding?: AutoFinding | null
): string {
  const parts: string[] = [];

  // 1. 에이전트 시스템 프롬프트
  parts.push(agent.system_prompt);

  // 2. User Prompt
  parts.push(`\n[User Prompt]\n${userPrompt}`);

  // 3. Session State
  parts.push(`\n[Session State]\n${stateContext}`);

  // 4. Finding 정보 (fix 사이클)
  if (finding) {
    parts.push(`\n[수정할 문제]\n- 제목: ${finding.title}\n- 설명: ${finding.description}\n- 파일: ${finding.file_path ?? 'N/A'}`);
  }

  // 5. 이전 에이전트 출력
  for (const [agentName, output] of previousOutputs) {
    parts.push(`\n[${agentName} 출력]\n${output}`);
  }

  return parts.join('\n\n');
}
```

---

## 8. API 변경

### 8.1 기존 API 수정

```
POST /api/auto               # Body에 initialPrompt 추가
PATCH /api/auto               # resume 시 Body에 midSessionPrompt 추가
```

### 8.2 신규 API

```
# User Prompts
GET    /api/auto/prompts                세션의 user prompt 목록
POST   /api/auto/prompts                mid-session prompt 추가
DELETE /api/auto/prompts/:id            prompt 삭제

# Agent 정의
GET    /api/auto/agents                 에이전트 목록
GET    /api/auto/agents/:id             에이전트 상세
POST   /api/auto/agents                 커스텀 에이전트 생성
PUT    /api/auto/agents/:id             에이전트 수정
DELETE /api/auto/agents/:id             커스텀 에이전트 삭제 (builtin은 불가)
PATCH  /api/auto/agents/:id/toggle      에이전트 활성/비활성 토글
PUT    /api/auto/agents/reorder         파이프라인 순서 변경

# Agent 실행 기록
GET    /api/auto/agent-runs?cycleId=... 사이클 내 에이전트 실행 기록
GET    /api/auto/agent-runs/:id         실행 기록 상세 (출력 포함)
```

---

## 9. UI 변경

### 9.1 시작 모달 (Initial Prompt)

```
┌──────────────────────────────────────────────┐
│  Start Autonomous Mode                        │
│ ──────────────────────────────────────────── │
│                                               │
│  Target Project                               │
│  ┌──────────────────────────────────────────┐│
│  │ /Users/user/source/my-app                ││
│  └──────────────────────────────────────────┘│
│                                               │
│  What do you want to build? (Optional)        │
│  ┌──────────────────────────────────────────┐│
│  │ React로 할일 관리 앱을 만들어줘.          ││
│  │ - Tailwind CSS 사용                      ││
│  │ - 로컬 스토리지로 데이터 영속화           ││
│  │ - 다크모드 지원                           ││
│  │                                          ││
│  └──────────────────────────────────────────┘│
│                                               │
│              [Cancel]  [Start]                │
└──────────────────────────────────────────────┘
```

### 9.2 Resume 모달 (Mid-Session Prompt)

```
┌──────────────────────────────────────────────┐
│  Resume Autonomous Mode                       │
│ ──────────────────────────────────────────── │
│                                               │
│  Add instructions (Optional)                  │
│  ┌──────────────────────────────────────────┐│
│  │ 다크모드 지원을 추가해줘                   ││
│  │                                          ││
│  └──────────────────────────────────────────┘│
│                                               │
│  Previous prompts:                            │
│  • [Initial] React로 할일 관리 앱을 만들어줘  │
│  • [Cycle 3] 모바일 반응형으로 만들어줘       │
│                                               │
│            [Cancel]  [Resume]                 │
└──────────────────────────────────────────────┘
```

### 9.3 Agent Pipeline 실시간 뷰어

대시보드의 현재 사이클 패널이 에이전트별 탭으로 확장된다:

```
┌──────────────────────────────────────────────────────┐
│  Cycle #5 — Pipeline                                  │
│                                                       │
│  [Designer ✅] [Developer ⏳] [Reviewer ⬜] [QA ⬜]  │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Developer (running)                              │ │
│  │                                                   │ │
│  │ > Reading src/components/TodoList.tsx...          │ │
│  │ > Implementing drag and drop...                  │ │
│  │ > Writing test file...                           │ │
│  │ > █                                              │ │
│  │                                                   │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  Cost so far: $0.08 | Duration: 32s                  │
└──────────────────────────────────────────────────────┘
```

### 9.4 Agent 관리 페이지 (`/auto/agents`)

```
┌──────────────────────────────────────────────────────┐
│  Agent Pipeline                         [+ New Agent] │
│ ─────────────────────────────────────────────────────│
│                                                       │
│  Pipeline Order:                                      │
│                                                       │
│  1. ● Product Designer              [Edit] [Toggle]  │
│     서비스 스펙/기능/UX 정의                           │
│                                                       │
│  2. ● Developer                     [Edit] [Toggle]  │
│     코드 구현                                         │
│                                                       │
│  3. ● Reviewer                      [Edit] [Toggle]  │
│     코드 리뷰 및 피드백                               │
│                                                       │
│  3.5 ○ Security Auditor       [Edit] [Toggle] [Del]  │
│     보안 취약점 분석 (비활성)                          │
│                                                       │
│  4. ● QA Engineer                   [Edit] [Toggle]  │
│     테스트 실행 및 품질 검증                           │
│                                                       │
│  ● = 활성  ○ = 비활성                                 │
└──────────────────────────────────────────────────────┘
```

### 9.5 Agent 편집 모달

```
┌──────────────────────────────────────────────┐
│  Edit Agent: Developer                        │
│ ──────────────────────────────────────────── │
│                                               │
│  Display Name                                 │
│  ┌──────────────────────────────────────────┐│
│  │ Developer                                ││
│  └──────────────────────────────────────────┘│
│                                               │
│  Role Description                             │
│  ┌──────────────────────────────────────────┐│
│  │ 코드 구현                                ││
│  └──────────────────────────────────────────┘│
│                                               │
│  System Prompt (Markdown)                     │
│  ┌──────────────────────────────────────────┐│
│  │ 당신은 시니어 개발자입니다.               ││
│  │                                          ││
│  │ Feature Spec을 받아 코드를 구현하세요.    ││
│  │ ...                                      ││
│  └──────────────────────────────────────────┘│
│                                               │
│  Pipeline Order: [2   ]                       │
│                                               │
│              [Cancel]  [Save]                 │
└──────────────────────────────────────────────┘
```

### 9.6 사이드바 메뉴 변경

Auto 모드 사이드바에 "Agents" 메뉴 항목 추가:

```
Auto Mode:
  📊 Dashboard     (/auto)
  🔍 Findings      (/auto/findings)
  🤖 Agents        (/auto/agents)     ← 신규
  🔄 Cycles        (/auto/cycles)
  📜 History        (/auto/history)
  ⚙️ Settings       (/auto/settings)
```

---

## 10. SSE 이벤트 추가

```typescript
// 기존 이벤트에 추가
type AutoSSEEventType =
  | ... // 기존 이벤트 유지
  | 'agent_start'          // 에이전트 실행 시작
  | 'agent_complete'       // 에이전트 실행 완료
  | 'agent_failed'         // 에이전트 실행 실패
  | 'review_iteration'     // Reviewer → Developer 반복 시작
  | 'user_prompt_added';   // 사용자 프롬프트 추가됨
```

---

## 11. 구현 순서

### Phase 1: 데이터 기반
1. DB 마이그레이션 (auto_sessions 수정, 신규 테이블 3개)
2. `auto_user_prompts` CRUD
3. `auto_agents` CRUD + 기본 4개 에이전트 seed
4. `auto_agent_runs` CRUD
5. User Prompt 빌더 함수

### Phase 2: Agent Pipeline 엔진
6. Agent Context 빌더
7. Agent Executor (단일 에이전트 실행)
8. Pipeline Executor (순차 파이프라인 실행)
9. Reviewer ↔ Developer 루프 로직
10. CycleEngine v2 (기존 Phase 기반 → Pipeline 기반으로 교체)

### Phase 3: API
11. `/api/auto/prompts` 엔드포인트
12. `/api/auto/agents` 엔드포인트
13. `/api/auto/agent-runs` 엔드포인트
14. 기존 `/api/auto` start/resume에 prompt 파라미터 추가

### Phase 4: Frontend
15. 시작 모달 (Initial Prompt 입력)
16. Resume 모달 (Mid-Session Prompt)
17. Agent Pipeline 실시간 뷰어
18. Agent 관리 페이지 (`/auto/agents`)
19. Cycle 상세에 Agent Run 표시
20. 사이드바에 Agents 메뉴 추가

### Phase 5: 테스트 + 안전장치
21. Review ↔ Developer 루프 무한 반복 방지
22. 기존 v1 테스트 호환성 확인
23. E2E 테스트

---

## 12. 설정 기본값 (v2 추가분)

```
review_max_iterations    : 2
skip_designer_for_fixes  : true
require_initial_prompt   : false
```

---

## 13. 마이그레이션 전략

v1에서 v2로의 전환은 **하위 호환**을 유지한다:

- v1의 Phase 기반 사이클은 그대로 DB에 남음
- v2 사이클은 `phase = 'pipeline'`으로 구분
- 기존 settings, findings, sessions 테이블은 수정 최소화
- Agent Pipeline이 비활성화되면 v1 방식으로 fallback 가능 (설정으로 토글)

---

## 14. v2 이후 추가 기능 (구현 완료)

PRD 작성 이후 추가로 구현된 기능들.

### 14.1 Planning Pipeline (Parallel Agent Groups)

기존 Product Designer 단일 에이전트를 **3인 기획 위원회 + 모더레이터** 구조로 교체:

```
[UX Planner] ──┐
[Tech Planner] ─┼── (parallel) ──► [Planning Moderator] ──► Developer ──► Reviewer ──► QA
[Biz Planner] ──┘
```

- `parallel_group` 컬럼으로 병렬 실행 그룹 정의
- 모더레이터가 3개 관점의 분석을 종합하여 최종 기획서 작성
- Finding 수정 시 `skip_designer_for_fixes` 설정에 따라 기획 단계 생략 가능

### 14.2 CEO 에스컬레이션

에이전트가 스스로 해결할 수 없는 문제를 CEO(사용자)에게 요청하는 시스템.

- 에이전트 출력에 `ceo_requests` JSON을 포함하면 자동 파싱하여 DB에 저장
- `blocking: true`인 요청은 CEO 응답 전까지 관련 작업 보류
- CEO 응답은 다음 사이클 에이전트 컨텍스트에 주입됨
- 요청 유형: `permission`, `resource`, `decision`, `information`

### 14.3 Watchdog (Stuck Cycle Detection)

1시간 간격으로 별도의 Opus 세션을 띄워 현재 cycle의 건강 상태를 점검.

- **진단 항목**: 실행 시간, 출력 증가량, 비용, 현재 에이전트
- **판단 기준**: 출력 미증가 + 1시간 이상 → stuck / 3시간 초과 → kill 고려 / 비용 $20 초과 → kill 고려
- Kill 판단 시 pipeline abort → 다음 cycle로 진행
- 평가 실패 시 보수적으로 CONTINUE (잘못 죽이지 않음)

### 14.4 Prompt Evolution

자동으로 에이전트 프롬프트를 변이(mutate)하고 성능을 평가하여 최적의 프롬프트를 찾는 시스템.

- `evolution_enabled`, `evolution_interval`, `evolution_window` 설정
- 매 N사이클마다 Claude가 현재 프롬프트를 분석하고 개선 버전을 생성
- 평가 기간 동안 cycle score를 수집하여 기존 vs 변이 프롬프트 비교
- 성능 하락 시 자동 롤백

### 14.5 Sub-agent 가이드라인

`claude-executor.ts`의 `append-system-prompt`에 sub-agent 관련 가이드 추가:

- 외부 파일 다운로드는 sub-agent 대신 직접 `WebFetch`/`curl` 사용
- 다운로드 2회 실패 시 스킵
- sub-agent 5분 이상 대기 금지
- 병렬 sub-agent 중 일부만 완료되면 결과로 진행

### 14.6 Screen Capture

모바일 앱 테스트 시 `mobile-mcp`를 활용하여 앱 화면을 캡처하고, UX Planner와 Product Designer에게 시각적 컨텍스트를 제공.
