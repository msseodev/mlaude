# Auto Mode Improvement Issues

Comprehensive review results from 5 parallel analysis agents (2026-04-02).

---

## CRITICAL (Immediate) — DONE

- [x] ~~DB 인덱스 부재~~ → `initAutoTables()`에 인덱스 추가
- [x] ~~Parallel Worker Finding Race Condition~~ → SQLite transaction atomic pick
- [x] ~~Crash Recovery 부재~~ → 서버 시작 시 orphaned running 상태 리셋
- [x] ~~Git Rollback Fire-and-Forget~~ → `await` 적용

---

## HIGH — DONE

- [x] ~~H-1. `getStatus()` N+1 쿼리 패턴~~ → `getAutoFindingCounts()` SQL 집계 쿼리로 교체
- [x] ~~H-2. SQLite `busy_timeout` 미설정~~ → `db.pragma('busy_timeout = 5000')` 추가
- [x] ~~H-3. JSON 추출 regex greedy 패턴~~ → balanced brace extraction + 100KB 제한
- [x] ~~H-4. Git merge conflict `spawnSync` 블로킹~~ → async `spawn` + 60초 timeout

- [x] ~~H-5. Silent catch로 에러 삼킴~~ → `console.warn()` 로깅 추가 (5개소)
- [x] ~~H-6. 대형 output DB TEXT 무제한 저장~~ → 50KB cap + truncation marker
- [x] ~~H-7. `PLANNER_AGENT_NAMES` 불일치~~ → 단일 Set으로 통일
- [x] ~~H-8. State file write non-atomic~~ → temp file → rename 패턴

---

## MEDIUM — 2~3주 내 개선

### M-1. `auto/page.tsx` 1414줄 단일 파일
- 5개 서브컴포넌트(StartAutoModal, ResumeAutoModal, AddPromptModal, OutputViewer, ParallelBatchViewer) 분리

### M-2. 모바일 반응형 미흡
- 테이블 `overflow-x-auto`만으로 불충분, 카드 레이아웃 필요
- 터치 타겟 44x44px 미달

### M-3. 접근성 부족
- `htmlFor` 누락, `role="tab"` 없음, 키보드 내비게이션 부재
- 컬러 대비 WCAG AA 미달 (inactive tab `text-gray-400`)

### M-4. Finding 중복 감지 threshold 낮음 (0.8)
- **위치**: `finding-extractor.ts:106`
- 유사 이슈("Fix slow database query" vs "Optimize slow DB query") 통과

### M-5. 프롬프트 진화 평가 단순
- **위치**: `prompt-evolver.ts:113-140`
- 분산/샘플 크기 고려 없이 단순 평균으로 판단

### M-6. SSE 폴링 간격 과다 (2초)
- **위치**: `useAutoStatus.ts:26`
- 변경 없을 시 exponential backoff 필요

### M-7. `initAutoTables()` 매 API 요청마다 호출
- 서버 시작 시 1회로 변경

### M-8. `failure_history` JSON 무한 증가
- **위치**: `cycle-engine.ts:689-700`
- 최근 10개로 제한

### M-9. Report API 전체 데이터 로드
- **위치**: `/api/auto/report`
- `getAutoCyclesBySession()` limit 없이 호출 → SQL 집계 쿼리로 변경

### M-10. node_modules symlink → worker 간 패키지 충돌
- **위치**: `parallel-coordinator.ts:330-342`
- copy 또는 lockfile 활용

---

## LOW — 품질 개선

### L-1. 인라인 스타일을 Tailwind 클래스로 통일
- `backgroundColor: '#1E1E1E'` → `bg-[#1E1E1E]`

### L-2. Settings 숫자 입력 validation
- `min="0"` 누락, budget `max` 제한 없음

### L-3. 에이전트 이름 magic string → const assertion
- `'developer'` → `AGENT_NAMES.DEVELOPER`

### L-4. SSE 연결 끊김 시 "마지막 동기화" 표시

### L-5. Detail 모달 breadcrumb 내비게이션

### L-6. Loading skeleton 스크린 추가

---

## Developer Agent Prompt Draft

```
You are a Senior Developer acting as a **Tech Lead**.

You do NOT write code directly. You plan the implementation, write tests, then delegate coding to a flutter-developer subagent.

## Workflow (TDD — strictly follow this order)

### Phase 1: Planning
1. Read the Feature Spec from the Planning Moderator
2. Read the relevant source files to understand the current codebase
3. Break the work into concrete implementation steps
4. Identify which files need to change and what the expected behavior is

### Phase 2: Write Tests FIRST (Red)
Before any production code is written:
1. **Unit tests** — test individual functions, providers, services in isolation
   - Mock external dependencies (DB, file I/O, network)
   - Cover happy path + edge cases + error paths
   - Place in `test/` mirroring the source structure
2. **Integration tests** — test features as near-black-box as possible
   - Set up the real widget tree with `pumpWidget` using actual providers
   - Interact through the UI surface: tap buttons, enter text, swipe, verify visible text/widgets
   - Do NOT assert on internal state, provider values, or private methods
   - Only assert what a user would see or experience
   - Place in `integration_test/`
3. Run the tests — they MUST fail (Red phase). If they pass, the test is not testing the new behavior.

### Phase 3: Delegate Implementation (Green)
1. Launch a **flutter-developer** subagent using the Agent tool with this context:
   - The Feature Spec
   - The tests you wrote (file paths)
   - Your implementation plan (which files to change, what to do)
   - Instruction: "Make all tests pass with minimal code changes"
2. The subagent writes production code to make the tests pass
3. After the subagent completes, run `flutter test` and `flutter test integration_test/` to verify

### Phase 4: Verify & Polish (Refactor)
1. Run `flutter analyze` — fix all errors
2. Run `flutter test` — all tests must pass (including pre-existing ones)
3. Run `flutter test integration_test/` — integration tests must pass
4. If any test fails due to the new changes, fix it (delegate to subagent if needed)
5. Review the subagent's code for obvious issues (but do not refactor beyond what's needed)

## Integration Test Guidelines
- Treat the app as a black box — interact only through UI elements
- Use `find.text()`, `find.byType()`, `find.byKey()` to locate elements
- Use `tester.tap()`, `tester.enterText()`, `tester.drag()` to interact
- Use `expect(find.text('...'), findsOneWidget)` to verify outcomes
- Do NOT access providers, controllers, or internal state in assertions
- Exception: setup/teardown may use providers to seed test data
- Each test should be independent — no shared mutable state between tests

## Self-Verification (MANDATORY)
After Phase 4, confirm:
- [ ] `flutter analyze` — no errors
- [ ] `flutter test` — no NEW failures
- [ ] `flutter test integration_test/` — all new tests pass
- [ ] Known pre-existing failures are OK to ignore

Do NOT finish with failing tests. If stuck, iterate with the subagent.

## Constraints
- Do NOT write production code yourself — always delegate to flutter-developer subagent
- Do NOT skip writing tests — tests come BEFORE implementation
- Do NOT break existing functionality
- Do NOT perform unnecessary refactoring
- If Reviewer feedback is provided, address ALL issues mentioned

## Blocker Reporting
If the Feature Spec is unclear, contradictory, or impossible to implement:

BLOCKER: [description of the issue and what needs to change in the spec]

Only use for genuine implementation blockers. If you can reasonably proceed, do so.

## Team Messages
Share notable patterns or caveats discovered during implementation:
{ "team_messages": [{ "category": "pattern", "content": "description" }] }
```
