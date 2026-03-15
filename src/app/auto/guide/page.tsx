'use client';

import { useState } from 'react';

// --- Table of Contents ---

const tocItems = [
  { id: 'overview', label: '1. 개요' },
  { id: 'pipeline', label: '2. 에이전트 파이프라인' },
  { id: 'cycle-flow', label: '3. 사이클 실행 흐름' },
  { id: 'planning-meeting', label: '4. 기획 회의 (병렬 기획)' },
  { id: 'planning-dev-review', label: '5. 기획-개발 리뷰' },
  { id: 'code-review-loop', label: '6. 코드 리뷰 루프' },
  { id: 'ceo-escalation', label: '7. CEO 에스컬레이션' },
  { id: 'self-evolution', label: '8. 프롬프트 자동 진화' },
  { id: 'scoring', label: '9. 평가 시스템 (Cycle Scoring)' },
  { id: 'settings-guide', label: '10. 설정 가이드' },
  { id: 'report-usage', label: '11. 보고서 활용' },
  { id: 'faq', label: '12. FAQ' },
];

// --- FAQ data ---

const faqItems = [
  {
    q: '비용이 너무 많이 나가면?',
    a: '예산(budget_usd)을 설정하면 한도 초과 시 자동 정지됩니다. 설정 페이지에서 USD 단위로 예산을 지정하세요. 0은 무제한입니다.',
  },
  {
    q: '잘못된 코드를 커밋하면?',
    a: '각 사이클 전에 git checkpoint를 생성합니다. 빌드 실패, 테스트 실패, 리뷰어 거부 등 문제가 발생하면 자동으로 롤백됩니다. 수동 롤백도 가능합니다.',
  },
  {
    q: '특정 에이전트를 끄고 싶으면?',
    a: 'Agents 페이지에서 개별 에이전트를 활성화/비활성화할 수 있습니다. 비활성화된 에이전트는 파이프라인에서 건너뜁니다.',
  },
  {
    q: '기존 단일 디자이너 방식으로 돌아가려면?',
    a: 'Product Designer를 활성화하고, 3명의 기획자(UX/기술/비즈) + 모더레이터를 비활성화하세요. 파이프라인이 자동으로 Product Designer 기반으로 전환됩니다.',
  },
  {
    q: '프로젝트가 Node.js가 아니면?',
    a: '설정에서 빌드/테스트/린트 명령어를 프로젝트에 맞게 변경하세요. 예: ./gradlew build, flutter test, cargo test, python -m pytest 등.',
  },
];

// --- Settings data ---

const settingsData = [
  { name: '대상 프로젝트', key: 'target_project', desc: '자율 모드가 작업할 프로젝트의 절대 경로', default: '(없음 - 필수)' },
  { name: '테스트 명령어', key: 'test_command', desc: '테스트 실행 명령어', default: 'npm test' },
  { name: '빌드 명령어', key: 'build_command', desc: '빌드 확인 명령어 (비워두면 건너뜀)', default: '(없음)' },
  { name: '린트 명령어', key: 'lint_command', desc: '린트 확인 명령어 (비워두면 건너뜀)', default: '(없음)' },
  { name: '최대 사이클', key: 'max_cycles', desc: '0 = 무제한, N = 최대 N사이클 실행 후 자동 정지', default: '0' },
  { name: '예산', key: 'budget_usd', desc: 'USD 기준 비용 한도, 0 = 무제한', default: '0' },
  { name: '자동 커밋', key: 'auto_commit', desc: '사이클 성공 시 자동으로 git commit', default: 'true' },
  { name: '브랜치', key: 'branch_name', desc: '작업 브랜치 이름', default: 'auto/improvements' },
  { name: '최대 재시도', key: 'max_retries', desc: 'finding당 최대 재시도 횟수', default: '3' },
  { name: '연속 실패 한도', key: 'max_consecutive_failures', desc: 'N회 연속 실패 시 자동 정지', default: '5' },
  { name: '리뷰 반복', key: 'review_max_iterations', desc: 'Reviewer - Developer 최대 반복 횟수', default: '2' },
  { name: '기획자 반복', key: 'max_designer_iterations', desc: 'Moderator - Developer 최대 반복 횟수', default: '2' },
  { name: '프롬프트 진화', key: 'evolution_enabled', desc: '자동 프롬프트 개선 활성화 여부', default: 'false' },
  { name: '진화 주기', key: 'evolution_interval', desc: '매 N사이클마다 진화 체크', default: '10' },
  { name: '평가 윈도우', key: 'evolution_window', desc: '최근 N사이클 성과로 평가', default: '5' },
];

// --- FAQ Accordion Item ---

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-zinc-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left text-zinc-100 hover:bg-zinc-800 transition-colors"
      >
        <span className="font-medium">Q: {question}</span>
        <svg
          className={`h-5 w-5 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="px-5 py-4 bg-zinc-800/50 border-t border-zinc-700">
          <p className="text-zinc-300 leading-relaxed">A: {answer}</p>
        </div>
      )}
    </div>
  );
}

// --- Section Heading ---

function SectionHeading({ id, number, title }: { id: string; number: number; title: string }) {
  return (
    <div id={id} className="scroll-mt-8">
      <h2 className="text-xl font-bold text-zinc-100 mb-1">
        {number}. {title}
      </h2>
      <div className="h-px bg-zinc-700 mb-4" />
    </div>
  );
}

// --- Info Box ---

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg px-5 py-4 text-blue-200 text-sm leading-relaxed">
      {children}
    </div>
  );
}

// --- Page Component ---

export default function AutoGuidePage() {
  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-zinc-900 text-zinc-300">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Title */}
        <h1 className="text-3xl font-bold text-zinc-100 mb-2">자율 모드 가이드</h1>
        <div className="h-1 w-24 bg-blue-500 mb-8" />

        {/* Table of Contents */}
        <div className="bg-zinc-800 rounded-lg p-6 mb-10 border border-zinc-700">
          <h2 className="text-lg font-semibold text-zinc-100 mb-4">목차</h2>
          <nav className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {tocItems.map((item) => (
              <button
                key={item.id}
                onClick={() => scrollTo(item.id)}
                className="text-left text-sm text-blue-400 hover:text-blue-300 hover:underline transition-colors px-2 py-1 rounded hover:bg-zinc-700/50"
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Sections */}
        <div className="space-y-12">
          {/* 1. 개요 */}
          <section>
            <SectionHeading id="overview" number={1} title="개요" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                mclaude 자율 모드는 <strong className="text-zinc-100">AI 에이전트 팀</strong>이 자동으로 프로젝트를 분석하고 개선하는 시스템입니다.
                여러 전문가 에이전트가 각자의 관점에서 코드베이스를 분석하고, 회의를 통해 합의를 도출하고, 개발하고, 리뷰하고, 테스트합니다.
              </p>
              <p>
                사람(CEO)은 보고서를 확인하고, 필요할 때 지시를 내리는 역할입니다.
                에이전트가 직접 해결하기 어려운 문제가 생기면 CEO에게 에스컬레이션 요청을 보냅니다.
              </p>
              <InfoBox>
                자율 모드는 <strong>완전 자동화</strong>가 목표입니다. 시작 버튼을 누르면 에이전트 팀이 스스로 작업을 찾고,
                기획하고, 구현하고, 테스트합니다. CEO는 결과를 확인하고 방향을 조정하는 것만으로 프로젝트를 운영할 수 있습니다.
              </InfoBox>
            </div>
          </section>

          {/* 2. 에이전트 파이프라인 */}
          <section>
            <SectionHeading id="pipeline" number={2} title="에이전트 파이프라인" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                자율 모드의 핵심은 <strong className="text-zinc-100">에이전트 파이프라인</strong>입니다.
                각 사이클마다 여러 에이전트가 순차적 또는 병렬로 실행되어 하나의 작업을 완수합니다.
              </p>

              {/* Pipeline diagram */}
              <div className="bg-zinc-950 rounded-lg p-5 border border-zinc-700 font-mono text-xs overflow-x-auto">
                <pre className="text-zinc-300">{`┌─────────────┐
│  UX 기획자   │─┐
└─────────────┘  │
┌─────────────┐  │                 ┌──────────────┐    ┌───────────┐    ┌──────────┐    ┌────────────┐
│ 기술 기획자  │─┼─ 병렬 실행 ──→ │ 기획 모더레이터 │──→│ Developer │──→│ Reviewer │──→│ QA Engineer│
└─────────────┘  │                 └──────────────┘    └───────────┘    └──────────┘    └────────────┘
┌─────────────┐  │
│ 비즈 기획자  │─┘
└─────────────┘`}</pre>
              </div>

              {/* Agent descriptions */}
              <div className="grid gap-3">
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-1">UX 기획자</h3>
                  <p className="text-zinc-400">사용자 경험, 화면 흐름, 접근성 분석. 사용자 관점에서 앱의 문제점과 개선점을 발견합니다.</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-1">기술 기획자</h3>
                  <p className="text-zinc-400">아키텍처, 성능, 보안, 기술 부채 분석. 코드 품질과 기술적 리스크를 평가합니다.</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-1">비즈 기획자</h3>
                  <p className="text-zinc-400">비즈니스 임팩트, 사용자 가치, 우선순위 분석. ROI와 전략적 가치를 기준으로 판단합니다.</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-1">기획 모더레이터</h3>
                  <p className="text-zinc-400">3명의 기획자 의견을 종합하고, 충돌을 해결하고, 최종 기획서를 작성합니다.</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-1">Developer</h3>
                  <p className="text-zinc-400">확정된 기획서를 기반으로 코드를 구현합니다. 기술적 블로커 발견 시 기획 모더레이터에게 피드백합니다.</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-1">Reviewer</h3>
                  <p className="text-zinc-400">코드 품질, 버그, 보안, 설계 일관성을 리뷰합니다. 승인 또는 수정 요청을 내립니다.</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-1">QA Engineer</h3>
                  <p className="text-zinc-400">E2E 테스트를 실행하고 기능이 정상적으로 동작하는지 검증합니다.</p>
                </div>
              </div>
            </div>
          </section>

          {/* 3. 사이클 실행 흐름 */}
          <section>
            <SectionHeading id="cycle-flow" number={3} title="사이클 실행 흐름" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                하나의 <strong className="text-zinc-100">&quot;사이클&quot;</strong>은 에이전트 파이프라인의 1회 완전 실행입니다.
                사이클마다 하나의 finding(발견 항목)을 처리합니다.
              </p>
              <div className="bg-zinc-800 rounded-lg p-5 border border-zinc-700">
                <ol className="space-y-3 text-zinc-300">
                  <li className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white">1</span>
                    <span><strong className="text-zinc-100">Git Checkpoint 생성</strong> - 현재 상태를 기록하여 롤백 가능하게 합니다</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white">2</span>
                    <span><strong className="text-zinc-100">기획자 병렬 분석</strong> - UX/기술/비즈 기획자가 동시에 코드를 분석합니다</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white">3</span>
                    <span><strong className="text-zinc-100">기획 모더레이터 종합</strong> - 분석 결과를 종합하여 최종 기획서를 작성합니다</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white">4</span>
                    <span><strong className="text-zinc-100">Developer 구현</strong> - 기획서에 따라 코드를 작성합니다</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white">5</span>
                    <span><strong className="text-zinc-100">Reviewer 리뷰</strong> - 코드를 검토하고 승인/거부합니다</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white">6</span>
                    <span><strong className="text-zinc-100">QA 테스트</strong> - E2E 테스트로 기능을 검증합니다</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 bg-green-600 rounded-full flex items-center justify-center text-xs font-bold text-white">7</span>
                    <span><strong className="text-zinc-100">성공 시 자동 커밋</strong> / 실패 시 롤백 후 재시도 (최대 N회)</span>
                  </li>
                </ol>
              </div>
              <InfoBox>
                <strong>안전장치:</strong> 최대 사이클 수, 예산 한도, 연속 실패 한도를 설정하여 무한 실행을 방지합니다.
                어떤 한도에 도달하면 자동으로 정지되고 보고서에 사유가 기록됩니다.
              </InfoBox>
            </div>
          </section>

          {/* 4. 기획 회의 (병렬 기획) */}
          <section>
            <SectionHeading id="planning-meeting" number={4} title="기획 회의 (병렬 기획)" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                자율 모드의 독특한 점은 <strong className="text-zinc-100">3명의 전문 기획자</strong>가 동시에 프로젝트를 분석하는 것입니다.
                각자 다른 렌즈로 같은 코드를 보기 때문에, 단일 분석으로는 놓칠 수 있는 문제를 발견할 수 있습니다.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700 text-center">
                  <div className="text-2xl mb-2">&#x1F3A8;</div>
                  <h3 className="font-semibold text-zinc-100 mb-1">UX 관점</h3>
                  <p className="text-xs text-zinc-400">화면 흐름, 인터랙션, 접근성, 빈 상태 처리, 에러 표시</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700 text-center">
                  <div className="text-2xl mb-2">&#x2699;</div>
                  <h3 className="font-semibold text-zinc-100 mb-1">기술 관점</h3>
                  <p className="text-xs text-zinc-400">아키텍처, 성능 병목, 보안 취약점, 에러 핸들링, 기술 부채</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700 text-center">
                  <div className="text-2xl mb-2">&#x1F4C8;</div>
                  <h3 className="font-semibold text-zinc-100 mb-1">비즈니스 관점</h3>
                  <p className="text-xs text-zinc-400">사용자 가치, 비즈니스 임팩트, 경쟁력, 이탈 방지, 성장 기여</p>
                </div>
              </div>

              <p>
                기획 모더레이터가 3명의 결과를 종합할 때 다음 원칙을 따릅니다:
              </p>
              <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                <h3 className="font-semibold text-zinc-100 mb-2">충돌 해결 우선순위</h3>
                <ol className="list-decimal list-inside space-y-1 text-zinc-300">
                  <li><strong className="text-red-400">보안/버그 (P0)</strong> - 가장 높은 우선순위</li>
                  <li><strong className="text-yellow-400">사용자 가치</strong> - 사용자에게 직접적인 영향을 주는 개선</li>
                  <li><strong className="text-blue-400">기술 부채</strong> - 장기적 유지보수성 향상</li>
                </ol>
                <p className="mt-3 text-zinc-400">
                  추가 원칙: <strong className="text-zinc-200">Quick win</strong> (작은 노력 + 큰 임팩트)을 우선합니다.
                  구현 난이도가 높으면 우선순위를 한 단계 낮춥니다.
                </p>
              </div>
            </div>
          </section>

          {/* 5. 기획-개발 리뷰 */}
          <section>
            <SectionHeading id="planning-dev-review" number={5} title="기획-개발 리뷰" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                Developer가 구현 중 기획서의 기술적 문제를 발견할 수 있습니다.
                이때 <strong className="text-zinc-100">&quot;BLOCKER&quot;</strong> 신호를 보내 기획 모더레이터에게 피드백합니다.
              </p>

              <div className="bg-zinc-950 rounded-lg p-5 border border-zinc-700 font-mono text-xs">
                <pre className="text-zinc-300">{`Developer: "이 기능은 현재 DB 스키마로는 구현 불가"
    │
    ▼  BLOCKER 발생
기획 모더레이터: 기획서 수정 (대안 제시)
    │
    ▼  수정된 기획서 전달
Developer: 수정된 기획서로 재시도
    │
    ▼  (최대 N회 반복)
성공 → Reviewer로 진행`}</pre>
              </div>

              <InfoBox>
                <strong>기획자 반복 횟수(max_designer_iterations)</strong> 설정으로 최대 반복 횟수를 제한할 수 있습니다.
                기본값은 2회입니다. BLOCKER가 반복 한도를 초과하면 해당 finding은 &quot;포기(wont_fix)&quot; 처리됩니다.
              </InfoBox>
            </div>
          </section>

          {/* 6. 코드 리뷰 루프 */}
          <section>
            <SectionHeading id="code-review-loop" number={6} title="코드 리뷰 루프" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                Reviewer는 Developer의 코드를 검토하고 <strong className="text-zinc-100">승인(approved)</strong> 또는
                <strong className="text-zinc-100"> 거부(rejected)</strong>합니다.
              </p>

              <div className="bg-zinc-950 rounded-lg p-5 border border-zinc-700 font-mono text-xs">
                <pre className="text-zinc-300">{`Developer: 코드 구현 완료
    │
    ▼
Reviewer: 코드 리뷰
    │
    ├─ 승인 (approved: true) → QA 테스트로 진행
    │
    └─ 거부 (approved: false)
         │
         ▼  피드백 전달
    Developer: 피드백 반영하여 수정
         │
         ▼  (최대 N회 반복)
    Reviewer: 재검토`}</pre>
              </div>

              <p>리뷰어가 검토하는 항목:</p>
              <ul className="list-disc list-inside space-y-1 text-zinc-300 ml-2">
                <li>코드 품질과 일관성</li>
                <li>잠재적 버그와 엣지 케이스</li>
                <li>에러 핸들링 적절성</li>
                <li>기획서 요구사항 충족 여부</li>
                <li>보안 취약점</li>
              </ul>

              <InfoBox>
                <strong>리뷰 반복 횟수(review_max_iterations)</strong> 설정으로 최대 반복 횟수를 제한합니다.
                기본값은 2회입니다. 한도를 초과해도 승인되지 않으면 현재 상태로 QA 단계로 넘어갑니다.
              </InfoBox>
            </div>
          </section>

          {/* 7. CEO 에스컬레이션 */}
          <section>
            <SectionHeading id="ceo-escalation" number={7} title="CEO 에스컬레이션" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                에이전트가 직접 해결할 수 없는 문제가 있을 때 <strong className="text-zinc-100">CEO에게 에스컬레이션 요청</strong>을 보냅니다.
                보고서 페이지에서 요청을 확인하고 응답할 수 있습니다.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-2">요청 유형</h3>
                  <ul className="space-y-2 text-zinc-300">
                    <li><span className="inline-block bg-red-900/50 text-red-300 text-xs px-2 py-0.5 rounded mr-2">권한</span>외부 서비스 접근, API 키 등</li>
                    <li><span className="inline-block bg-yellow-900/50 text-yellow-300 text-xs px-2 py-0.5 rounded mr-2">리소스</span>추가 라이브러리, 도구 등</li>
                    <li><span className="inline-block bg-blue-900/50 text-blue-300 text-xs px-2 py-0.5 rounded mr-2">의사결정</span>설계 방향, 기능 범위 등</li>
                    <li><span className="inline-block bg-green-900/50 text-green-300 text-xs px-2 py-0.5 rounded mr-2">정보</span>비즈니스 요구사항, 기존 결정 등</li>
                  </ul>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-2">차단/비차단</h3>
                  <div className="space-y-3">
                    <div>
                      <p className="text-zinc-100 font-medium text-xs mb-1">차단(blocking) 요청</p>
                      <p className="text-zinc-400 text-xs">CEO 응답 전까지 관련 작업이 보류됩니다. 반드시 응답이 필요한 중요한 문제입니다.</p>
                    </div>
                    <div>
                      <p className="text-zinc-100 font-medium text-xs mb-1">비차단(non-blocking) 요청</p>
                      <p className="text-zinc-400 text-xs">작업은 계속 진행됩니다. CEO 응답은 다음 사이클에 반영됩니다.</p>
                    </div>
                  </div>
                </div>
              </div>

              <InfoBox>
                보고서 페이지(<code className="bg-zinc-800 px-1.5 py-0.5 rounded text-blue-300 text-xs">/auto/report</code>)에서
                대기중인 요청을 확인하고 응답할 수 있습니다. 차단 요청은 빠르게 응답하는 것이 좋습니다.
              </InfoBox>
            </div>
          </section>

          {/* 8. 프롬프트 자동 진화 */}
          <section>
            <SectionHeading id="self-evolution" number={8} title="프롬프트 자동 진화 (Self-Evolution)" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                에이전트의 시스템 프롬프트를 <strong className="text-zinc-100">AI가 자동으로 개선</strong>하는 기능입니다.
                매 N사이클마다 에이전트 성과를 평가하고, 성적이 나쁜 에이전트의 프롬프트를 변형(mutation)합니다.
              </p>

              <div className="bg-zinc-950 rounded-lg p-5 border border-zinc-700 font-mono text-xs">
                <pre className="text-zinc-300">{`매 N사이클마다:
    │
    ▼
에이전트별 최근 성과 평가 (평가 윈도우)
    │
    ├─ 성적 양호 → 현재 프롬프트 유지
    │
    └─ 성적 부진
         │
         ▼
    AI가 프롬프트 변형(mutation) 생성
         │
         ▼
    변형 프롬프트로 N사이클 실행
         │
         ├─ 성과 개선 → 변형 프롬프트 채택
         │
         └─ 성과 악화 → 이전 프롬프트로 롤백`}</pre>
              </div>

              <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                <h3 className="font-semibold text-zinc-100 mb-2">관련 설정</h3>
                <ul className="space-y-1 text-zinc-300">
                  <li><code className="bg-zinc-900 px-1.5 py-0.5 rounded text-zinc-200 text-xs">evolution_enabled</code> - 활성화 여부 (기본: 비활성화)</li>
                  <li><code className="bg-zinc-900 px-1.5 py-0.5 rounded text-zinc-200 text-xs">evolution_interval</code> - 진화 체크 주기 (기본: 10사이클)</li>
                  <li><code className="bg-zinc-900 px-1.5 py-0.5 rounded text-zinc-200 text-xs">evolution_window</code> - 평가할 최근 사이클 수 (기본: 5)</li>
                </ul>
              </div>

              <InfoBox>
                프롬프트 진화는 실험적 기능입니다. 충분히 안정적인 상태에서 활성화하는 것을 권장합니다.
                진화 결과는 Agents 페이지에서 프롬프트 변형 이력으로 확인할 수 있습니다.
              </InfoBox>
            </div>
          </section>

          {/* 9. 평가 시스템 */}
          <section>
            <SectionHeading id="scoring" number={9} title="평가 시스템 (Cycle Scoring)" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                각 사이클에 <strong className="text-zinc-100">0~100점의 복합 점수</strong>가 부여됩니다.
                이 점수는 프롬프트 진화, 성과 추적, 품질 모니터링에 사용됩니다.
              </p>

              <div className="bg-zinc-800 rounded-lg border border-zinc-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-700 bg-zinc-800">
                      <th className="text-left px-4 py-3 text-zinc-300 font-semibold">평가 항목</th>
                      <th className="text-center px-4 py-3 text-zinc-300 font-semibold">배점</th>
                      <th className="text-left px-4 py-3 text-zinc-300 font-semibold">설명</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-300">
                    <tr className="border-b border-zinc-700/50 bg-zinc-800/50">
                      <td className="px-4 py-3 font-medium text-zinc-100">L0 Gate</td>
                      <td className="px-4 py-3 text-center">25점</td>
                      <td className="px-4 py-3">빌드/린트 통과 여부. 실패 시 총점 최대 25점으로 제한</td>
                    </tr>
                    <tr className="border-b border-zinc-700/50">
                      <td className="px-4 py-3 font-medium text-zinc-100">L1 Test</td>
                      <td className="px-4 py-3 text-center">30점</td>
                      <td className="px-4 py-3">테스트 통과율에 비례. 전체 통과 시 만점</td>
                    </tr>
                    <tr className="border-b border-zinc-700/50 bg-zinc-800/50">
                      <td className="px-4 py-3 font-medium text-zinc-100">L2 Process</td>
                      <td className="px-4 py-3 text-center">20점</td>
                      <td className="px-4 py-3">리뷰어 승인 여부, 리뷰 반복 횟수 (적을수록 높은 점수)</td>
                    </tr>
                    <tr className="border-b border-zinc-700/50">
                      <td className="px-4 py-3 font-medium text-zinc-100">Value</td>
                      <td className="px-4 py-3 text-center">15점</td>
                      <td className="px-4 py-3">Finding 해결 여부, 새로운 발견 기여도</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-medium text-zinc-100">Efficiency</td>
                      <td className="px-4 py-3 text-center">10점</td>
                      <td className="px-4 py-3">비용 효율성 (같은 결과를 더 적은 비용으로)</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <InfoBox>
                빌드/린트 명령어는 프로젝트에 맞게 설정하세요. Node.js 프로젝트는 <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-blue-300 text-xs">npm run build</code>,
                Gradle 프로젝트는 <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-blue-300 text-xs">./gradlew build</code>,
                Flutter 프로젝트는 <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-blue-300 text-xs">flutter analyze</code> 등을 설정합니다.
                설정하지 않으면 해당 검사를 건너뜁니다.
              </InfoBox>
            </div>
          </section>

          {/* 10. 설정 가이드 */}
          <section>
            <SectionHeading id="settings-guide" number={10} title="설정 가이드" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                Settings 페이지(<code className="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-200 text-xs">/auto/settings</code>)에서
                자율 모드의 동작을 세밀하게 조정할 수 있습니다.
              </p>

              <div className="bg-zinc-800 rounded-lg border border-zinc-700 overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-700 bg-zinc-800">
                      <th className="text-left px-4 py-3 text-zinc-300 font-semibold whitespace-nowrap">설정</th>
                      <th className="text-left px-4 py-3 text-zinc-300 font-semibold">설명</th>
                      <th className="text-left px-4 py-3 text-zinc-300 font-semibold whitespace-nowrap">기본값</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-300">
                    {settingsData.map((s, i) => (
                      <tr
                        key={s.key}
                        className={`border-b border-zinc-700/50 ${i % 2 === 0 ? 'bg-zinc-800/50' : ''}`}
                      >
                        <td className="px-4 py-3 font-medium text-zinc-100 whitespace-nowrap">{s.name}</td>
                        <td className="px-4 py-3">{s.desc}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <code className="bg-zinc-900 px-1.5 py-0.5 rounded text-zinc-200 text-xs">{s.default}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* 11. 보고서 활용 */}
          <section>
            <SectionHeading id="report-usage" number={11} title="보고서 활용" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                보고서 페이지(<code className="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-200 text-xs">/auto/report</code>)는
                CEO가 자율 모드의 전체 현황을 파악하고 지시를 내리는 <strong className="text-zinc-100">중앙 관제 화면</strong>입니다.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-2">발견 항목 현황</h3>
                  <p className="text-zinc-400 text-xs">해결됨, 진행중, 미해결, 포기 상태별 finding 통계. 카테고리와 우선순위별 분포를 한눈에 확인합니다.</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-2">최근 사이클</h3>
                  <p className="text-zinc-400 text-xs">각 사이클의 점수, 비용, 소요시간, 성공/실패 여부를 표로 확인합니다.</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-2">CEO 요청</h3>
                  <p className="text-zinc-400 text-xs">에이전트가 보낸 에스컬레이션 요청을 확인하고 응답합니다. 차단 요청은 빠르게 처리하세요.</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-2">지시사항</h3>
                  <p className="text-zinc-400 text-xs">새로운 방향을 지시할 수 있습니다. 영구 지시 또는 N사이클 한정 지시를 선택할 수 있습니다.</p>
                </div>
              </div>

              <InfoBox>
                세션이 실행 중일 때 보고서 페이지는 <strong>30초마다 자동 새로고침</strong>됩니다.
                수동으로 새로고침할 필요 없이 최신 상태를 실시간으로 확인할 수 있습니다.
              </InfoBox>
            </div>
          </section>

          {/* 12. FAQ */}
          <section>
            <SectionHeading id="faq" number={12} title="FAQ" />
            <div className="space-y-3">
              {faqItems.map((item, i) => (
                <FAQItem key={i} question={item.q} answer={item.a} />
              ))}
            </div>
          </section>
        </div>

        {/* Back to top */}
        <div className="mt-12 pt-6 border-t border-zinc-700 text-center">
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            맨 위로 돌아가기
          </button>
        </div>
      </div>
    </div>
  );
}
