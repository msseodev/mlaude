# Auto Mode Improvement Issues

Comprehensive review results from 5 parallel analysis agents (2026-04-02).

---

## CRITICAL (Immediate) — DONE

- [x] ~~DB 인덱스 부재~~ → `initAutoTables()`에 인덱스 추가
- [x] ~~Parallel Worker Finding Race Condition~~ → SQLite transaction atomic pick
- [x] ~~Crash Recovery 부재~~ → 서버 시작 시 orphaned running 상태 리셋
- [x] ~~Git Rollback Fire-and-Forget~~ → `await` 적용

---

## HIGH — 1~2주 내 수정 권장

### H-1. `getStatus()` N+1 쿼리 패턴
- **위치**: `cycle-engine.ts:346-348`
- **문제**: 모든 findings를 로드한 뒤 메모리에서 필터링. 2초마다 호출됨.
- **수정**: `SELECT status, COUNT(*) FROM auto_findings WHERE session_id = ? GROUP BY status`

### H-2. SQLite `busy_timeout` 미설정
- **위치**: `db.ts`
- **문제**: write 경합 시 즉시 실패 (retry 없음)
- **수정**: `db.pragma('busy_timeout = 5000')`

### H-3. JSON 추출 regex greedy 패턴
- **위치**: `finding-extractor.ts:67-70`
- **문제**: `/\{[\s\S]*${key}[\s\S]*\}/` — 첫 `{`부터 마지막 `}`까지 매칭
- **수정**: bounded extraction (100KB 제한) + non-greedy 패턴

### H-4. Git merge conflict 해결 시 `spawnSync` 블로킹
- **위치**: `parallel-coordinator.ts:314`
- **문제**: merge lock 내에서 동기 Claude CLI 호출 → 전체 worker pool 블로킹
- **수정**: async + 30초 timeout

### H-5. Silent catch로 에러 삼킴 (6개소)
- `parallel-coordinator.ts:208` — worktree 삭제 실패
- `git-manager.ts:142, 157` — merge abort 실패
- `cycle-engine.ts:380` — DB 쿼리 실패
- `cycle-engine.ts:1305` — knowledge context 빌드 실패
- **수정**: `console.warn()` 또는 이벤트 emit

### H-6. 대형 output DB TEXT 컬럼 무제한 저장
- **위치**: `auto_cycles.output`, `auto_agent_runs.output`
- **문제**: 50 cycles × 5 agents × 100KB = 25MB+ 메모리 소비
- **수정**: 50KB 초과 시 파일시스템 이관, DB에는 경로만 저장

### H-7. `PLANNER_AGENT_NAMES`와 `isPlannerAgent()` 불일치
- **위치**: `pipeline-executor.ts:70 vs 73-75`
- **문제**: Planning Moderator가 screen frames를 못 받음
- **수정**: 두 목록 통일

### H-8. State file write non-atomic
- **위치**: `state-manager.ts:23-32`
- **문제**: `fs.writeFile` 중 크래시 시 SESSION-STATE.md 손상
- **수정**: temp file → rename 패턴

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
