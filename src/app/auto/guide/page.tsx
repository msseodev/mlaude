'use client';

import { useState } from 'react';

// --- Table of Contents ---

const tocItems = [
  { id: 'overview', label: '1. Overview' },
  { id: 'pipeline', label: '2. Agent Pipeline' },
  { id: 'cycle-flow', label: '3. Cycle Execution Flow' },
  { id: 'planning-meeting', label: '4. Planning Meeting (Parallel Planning)' },
  { id: 'planning-dev-review', label: '5. Planning-Development Review' },
  { id: 'code-review-loop', label: '6. Code Review Loop' },
  { id: 'ceo-escalation', label: '7. CEO Escalation' },
  { id: 'self-evolution', label: '8. Prompt Self-Evolution' },
  { id: 'scoring', label: '9. Scoring System (Cycle Scoring)' },
  { id: 'settings-guide', label: '10. Settings Guide' },
  { id: 'report-usage', label: '11. Using Reports' },
  { id: 'faq', label: '12. FAQ' },
];

// --- FAQ data ---

const faqItems = [
  {
    q: 'What if costs get too high?',
    a: 'Set a budget (budget_usd) and the system will auto-stop when the limit is exceeded. Specify the budget in USD on the Settings page. 0 means unlimited.',
  },
  {
    q: 'What if incorrect code gets committed?',
    a: 'A git checkpoint is created before each cycle. If a build failure, test failure, or reviewer rejection occurs, it automatically rolls back. Manual rollback is also available.',
  },
  {
    q: 'How do I disable a specific agent?',
    a: 'You can enable/disable individual agents on the Agents page. Disabled agents are skipped in the pipeline.',
  },
  {
    q: 'How do I switch back to the single designer mode?',
    a: 'Enable Product Designer and disable the 3 planners (UX/Tech/Biz) + Moderator. The pipeline will automatically switch to a Product Designer-based flow.',
  },
  {
    q: 'What if my project is not Node.js?',
    a: 'Change the build/test/lint commands in Settings to match your project. Examples: ./gradlew build, flutter test, cargo test, python -m pytest, etc.',
  },
];

// --- Settings data ---

const settingsData = [
  { name: 'Target Project', key: 'target_project', desc: 'Absolute path of the project for autonomous mode to work on', default: '(none - required)' },
  { name: 'Test Command', key: 'test_command', desc: 'Command to run tests', default: 'npm test' },
  { name: 'Build Command', key: 'build_command', desc: 'Command to verify build (leave empty to skip)', default: '(none)' },
  { name: 'Lint Command', key: 'lint_command', desc: 'Command to verify lint (leave empty to skip)', default: '(none)' },
  { name: 'Max Cycles', key: 'max_cycles', desc: '0 = unlimited, N = auto-stop after N cycles', default: '0' },
  { name: 'Budget', key: 'budget_usd', desc: 'Cost limit in USD, 0 = unlimited', default: '0' },
  { name: 'Auto Commit', key: 'auto_commit', desc: 'Automatically git commit on successful cycle', default: 'true' },
  { name: 'Branch', key: 'branch_name', desc: 'Working branch name', default: 'auto/improvements' },
  { name: 'Max Retries', key: 'max_retries', desc: 'Maximum retry attempts per finding', default: '3' },
  { name: 'Consecutive Failure Limit', key: 'max_consecutive_failures', desc: 'Auto-stop after N consecutive failures', default: '5' },
  { name: 'Review Iterations', key: 'review_max_iterations', desc: 'Max Reviewer - Developer feedback iterations', default: '2' },
  { name: 'Planner Iterations', key: 'max_designer_iterations', desc: 'Max Moderator - Developer feedback iterations', default: '2' },
  { name: 'Prompt Evolution', key: 'evolution_enabled', desc: 'Enable automatic prompt improvement', default: 'false' },
  { name: 'Evolution Interval', key: 'evolution_interval', desc: 'Check for evolution every N cycles', default: '10' },
  { name: 'Evaluation Window', key: 'evolution_window', desc: 'Evaluate performance over last N cycles', default: '5' },
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
        <h1 className="text-3xl font-bold text-zinc-100 mb-2">Autonomous Mode Guide</h1>
        <div className="h-1 w-24 bg-blue-500 mb-8" />

        {/* Table of Contents */}
        <div className="bg-zinc-800 rounded-lg p-6 mb-10 border border-zinc-700">
          <h2 className="text-lg font-semibold text-zinc-100 mb-4">Table of Contents</h2>
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
          {/* 1. Overview */}
          <section>
            <SectionHeading id="overview" number={1} title="Overview" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                mlaude autonomous mode is a system where an <strong className="text-zinc-100">AI agent team</strong> automatically analyzes and improves your project.
                Multiple specialist agents analyze the codebase from their own perspectives, reach consensus through meetings, develop, review, and test.
              </p>
              <p>
                The human (CEO) reviews reports and gives directions when needed.
                When agents encounter problems they cannot resolve on their own, they send escalation requests to the CEO.
              </p>
              <InfoBox>
                Autonomous mode aims for <strong>full automation</strong>. Press the start button and the agent team will find work,
                plan, implement, and test on its own. The CEO can operate the project simply by reviewing results and adjusting direction.
              </InfoBox>
            </div>
          </section>

          {/* 2. Agent Pipeline */}
          <section>
            <SectionHeading id="pipeline" number={2} title="Agent Pipeline" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                The core of autonomous mode is the <strong className="text-zinc-100">agent pipeline</strong>.
                Each cycle runs multiple agents sequentially or in parallel to complete a single task.
              </p>

              {/* Pipeline diagram */}
              <div className="bg-zinc-950 rounded-lg p-5 border border-zinc-700 font-mono text-xs overflow-x-auto">
                <pre className="text-zinc-300">{`┌──────────────┐
│  UX Planner  │─┐
└──────────────┘  │
┌──────────────┐  │                  ┌────────────────────┐    ┌───────────┐    ┌──────────┐    ┌────────────┐
│ Tech Planner │─┼─ Parallel ───→  │ Planning Moderator │──→│ Developer │──→│ Reviewer │──→│ QA Engineer│
└──────────────┘  │                  └────────────────────┘    └───────────┘    └──────────┘    └────────────┘
┌──────────────┐  │
│ Biz Planner  │─┘
└──────────────┘`}</pre>
              </div>

              {/* Agent descriptions */}
              <div className="grid gap-3">
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-1">UX Planner</h3>
                  <p className="text-zinc-400">Analyzes user experience, screen flows, and accessibility. Identifies problems and improvements from the user&apos;s perspective.</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-1">Tech Planner</h3>
                  <p className="text-zinc-400">Analyzes architecture, performance, security, and technical debt. Evaluates code quality and technical risk.</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-1">Biz Planner</h3>
                  <p className="text-zinc-400">Analyzes business impact, user value, and priorities. Makes decisions based on ROI and strategic value.</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-1">Planning Moderator</h3>
                  <p className="text-zinc-400">Synthesizes opinions from the 3 planners, resolves conflicts, and produces the final specification.</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-1">Developer</h3>
                  <p className="text-zinc-400">Implements code based on the finalized spec. Sends feedback to the Planning Moderator if technical blockers are found.</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-1">Reviewer</h3>
                  <p className="text-zinc-400">Reviews code quality, bugs, security, and design consistency. Issues approval or requests changes.</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-1">QA Engineer</h3>
                  <p className="text-zinc-400">Runs E2E tests to verify that features work correctly.</p>
                </div>
              </div>
            </div>
          </section>

          {/* 3. Cycle Execution Flow */}
          <section>
            <SectionHeading id="cycle-flow" number={3} title="Cycle Execution Flow" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                A single <strong className="text-zinc-100">&quot;cycle&quot;</strong> is one complete execution of the agent pipeline.
                Each cycle processes one finding.
              </p>
              <div className="bg-zinc-800 rounded-lg p-5 border border-zinc-700">
                <ol className="space-y-3 text-zinc-300">
                  <li className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white">1</span>
                    <span><strong className="text-zinc-100">Git Checkpoint</strong> - Records current state so rollback is possible</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white">2</span>
                    <span><strong className="text-zinc-100">Parallel Planner Analysis</strong> - UX/Tech/Biz planners analyze the code simultaneously</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white">3</span>
                    <span><strong className="text-zinc-100">Planning Moderator Synthesis</strong> - Synthesizes analysis results into a final specification</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white">4</span>
                    <span><strong className="text-zinc-100">Developer Implementation</strong> - Writes code according to the specification</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white">5</span>
                    <span><strong className="text-zinc-100">Reviewer Review</strong> - Reviews and approves/rejects the code</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white">6</span>
                    <span><strong className="text-zinc-100">QA Test</strong> - Verifies functionality with E2E tests</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 bg-green-600 rounded-full flex items-center justify-center text-xs font-bold text-white">7</span>
                    <span><strong className="text-zinc-100">Auto commit on success</strong> / rollback and retry on failure (up to N times)</span>
                  </li>
                </ol>
              </div>
              <InfoBox>
                <strong>Safety measures:</strong> Configure max cycles, budget limits, and consecutive failure limits to prevent infinite execution.
                When any limit is reached, the system auto-stops and the reason is recorded in the report.
              </InfoBox>
            </div>
          </section>

          {/* 4. Planning Meeting (Parallel Planning) */}
          <section>
            <SectionHeading id="planning-meeting" number={4} title="Planning Meeting (Parallel Planning)" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                A unique aspect of autonomous mode is that <strong className="text-zinc-100">3 specialist planners</strong> analyze the project simultaneously.
                Because each looks through a different lens at the same code, they can find issues that a single analysis might miss.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700 text-center">
                  <div className="text-2xl mb-2">&#x1F3A8;</div>
                  <h3 className="font-semibold text-zinc-100 mb-1">UX Perspective</h3>
                  <p className="text-xs text-zinc-400">Screen flows, interactions, accessibility, empty states, error display</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700 text-center">
                  <div className="text-2xl mb-2">&#x2699;</div>
                  <h3 className="font-semibold text-zinc-100 mb-1">Technical Perspective</h3>
                  <p className="text-xs text-zinc-400">Architecture, performance bottlenecks, security vulnerabilities, error handling, tech debt</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700 text-center">
                  <div className="text-2xl mb-2">&#x1F4C8;</div>
                  <h3 className="font-semibold text-zinc-100 mb-1">Business Perspective</h3>
                  <p className="text-xs text-zinc-400">User value, business impact, competitiveness, churn prevention, growth contribution</p>
                </div>
              </div>

              <p>
                The Planning Moderator follows these principles when synthesizing the results from all 3 planners:
              </p>
              <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                <h3 className="font-semibold text-zinc-100 mb-2">Conflict Resolution Priority</h3>
                <ol className="list-decimal list-inside space-y-1 text-zinc-300">
                  <li><strong className="text-red-400">Security/Bugs (P0)</strong> - Highest priority</li>
                  <li><strong className="text-yellow-400">User Value</strong> - Improvements with direct user impact</li>
                  <li><strong className="text-blue-400">Tech Debt</strong> - Long-term maintainability improvements</li>
                </ol>
                <p className="mt-3 text-zinc-400">
                  Additional principle: <strong className="text-zinc-200">Quick wins</strong> (low effort + high impact) are prioritized.
                  Items with high implementation difficulty are lowered by one priority level.
                </p>
              </div>
            </div>
          </section>

          {/* 5. Planning-Development Review */}
          <section>
            <SectionHeading id="planning-dev-review" number={5} title="Planning-Development Review" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                The Developer may discover technical issues with the specification during implementation.
                In that case, a <strong className="text-zinc-100">&quot;BLOCKER&quot;</strong> signal is sent to provide feedback to the Planning Moderator.
              </p>

              <div className="bg-zinc-950 rounded-lg p-5 border border-zinc-700 font-mono text-xs">
                <pre className="text-zinc-300">{`Developer: "This feature cannot be implemented with the current DB schema"
    |
    v  BLOCKER raised
Planning Moderator: Revises spec (proposes alternative)
    |
    v  Revised spec delivered
Developer: Retries with revised spec
    |
    v  (up to N iterations)
Success -> Proceed to Reviewer`}</pre>
              </div>

              <InfoBox>
                The <strong>max_designer_iterations</strong> setting limits the maximum number of iterations.
                Default is 2. If the BLOCKER exceeds the iteration limit, the finding is marked as &quot;Won&apos;t Fix (wont_fix)&quot;.
              </InfoBox>
            </div>
          </section>

          {/* 6. Code Review Loop */}
          <section>
            <SectionHeading id="code-review-loop" number={6} title="Code Review Loop" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                The Reviewer inspects the Developer&apos;s code and either <strong className="text-zinc-100">approves</strong> or
                <strong className="text-zinc-100"> rejects</strong> it.
              </p>

              <div className="bg-zinc-950 rounded-lg p-5 border border-zinc-700 font-mono text-xs">
                <pre className="text-zinc-300">{`Developer: Code implementation complete
    |
    v
Reviewer: Code review
    |
    +-- Approved (approved: true) -> Proceed to QA test
    |
    +-- Rejected (approved: false)
         |
         v  Feedback delivered
    Developer: Applies feedback and revises
         |
         v  (up to N iterations)
    Reviewer: Re-review`}</pre>
              </div>

              <p>Items the Reviewer checks:</p>
              <ul className="list-disc list-inside space-y-1 text-zinc-300 ml-2">
                <li>Code quality and consistency</li>
                <li>Potential bugs and edge cases</li>
                <li>Error handling adequacy</li>
                <li>Spec requirements fulfillment</li>
                <li>Security vulnerabilities</li>
              </ul>

              <InfoBox>
                The <strong>review_max_iterations</strong> setting limits the maximum number of iterations.
                Default is 2. If the limit is exceeded without approval, the current state proceeds to the QA stage.
              </InfoBox>
            </div>
          </section>

          {/* 7. CEO Escalation */}
          <section>
            <SectionHeading id="ceo-escalation" number={7} title="CEO Escalation" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                When agents encounter problems they cannot resolve on their own, they send an <strong className="text-zinc-100">escalation request to the CEO</strong>.
                You can view and respond to requests on the Report page.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-2">Request Types</h3>
                  <ul className="space-y-2 text-zinc-300">
                    <li><span className="inline-block bg-red-900/50 text-red-300 text-xs px-2 py-0.5 rounded mr-2">Permission</span>External service access, API keys, etc.</li>
                    <li><span className="inline-block bg-yellow-900/50 text-yellow-300 text-xs px-2 py-0.5 rounded mr-2">Resource</span>Additional libraries, tools, etc.</li>
                    <li><span className="inline-block bg-blue-900/50 text-blue-300 text-xs px-2 py-0.5 rounded mr-2">Decision</span>Design direction, feature scope, etc.</li>
                    <li><span className="inline-block bg-green-900/50 text-green-300 text-xs px-2 py-0.5 rounded mr-2">Information</span>Business requirements, prior decisions, etc.</li>
                  </ul>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-2">Blocking / Non-blocking</h3>
                  <div className="space-y-3">
                    <div>
                      <p className="text-zinc-100 font-medium text-xs mb-1">Blocking request</p>
                      <p className="text-zinc-400 text-xs">Related work is on hold until CEO responds. These are critical issues that require a response.</p>
                    </div>
                    <div>
                      <p className="text-zinc-100 font-medium text-xs mb-1">Non-blocking request</p>
                      <p className="text-zinc-400 text-xs">Work continues. CEO response is applied in the next cycle.</p>
                    </div>
                  </div>
                </div>
              </div>

              <InfoBox>
                On the Report page (<code className="bg-zinc-800 px-1.5 py-0.5 rounded text-blue-300 text-xs">/auto/report</code>),
                you can view pending requests and respond. It is recommended to respond to blocking requests promptly.
              </InfoBox>
            </div>
          </section>

          {/* 8. Prompt Self-Evolution */}
          <section>
            <SectionHeading id="self-evolution" number={8} title="Prompt Self-Evolution" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                This feature <strong className="text-zinc-100">automatically improves agent system prompts using AI</strong>.
                Every N cycles, agent performance is evaluated, and underperforming agents have their prompts mutated.
              </p>

              <div className="bg-zinc-950 rounded-lg p-5 border border-zinc-700 font-mono text-xs">
                <pre className="text-zinc-300">{`Every N cycles:
    |
    v
Evaluate each agent's recent performance (evaluation window)
    |
    +-- Performance OK -> Keep current prompt
    |
    +-- Underperforming
         |
         v
    AI generates prompt mutation
         |
         v
    Run N cycles with mutated prompt
         |
         +-- Performance improved -> Adopt mutated prompt
         |
         +-- Performance worsened -> Roll back to previous prompt`}</pre>
              </div>

              <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                <h3 className="font-semibold text-zinc-100 mb-2">Related Settings</h3>
                <ul className="space-y-1 text-zinc-300">
                  <li><code className="bg-zinc-900 px-1.5 py-0.5 rounded text-zinc-200 text-xs">evolution_enabled</code> - Enable/disable (default: disabled)</li>
                  <li><code className="bg-zinc-900 px-1.5 py-0.5 rounded text-zinc-200 text-xs">evolution_interval</code> - Evolution check interval (default: 10 cycles)</li>
                  <li><code className="bg-zinc-900 px-1.5 py-0.5 rounded text-zinc-200 text-xs">evolution_window</code> - Number of recent cycles to evaluate (default: 5)</li>
                </ul>
              </div>

              <InfoBox>
                Prompt evolution is an experimental feature. It is recommended to enable it only when the system is sufficiently stable.
                Evolution results can be viewed as prompt mutation history on the Agents page.
              </InfoBox>
            </div>
          </section>

          {/* 9. Scoring System */}
          <section>
            <SectionHeading id="scoring" number={9} title="Scoring System (Cycle Scoring)" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                Each cycle is assigned a <strong className="text-zinc-100">composite score of 0-100</strong>.
                This score is used for prompt evolution, performance tracking, and quality monitoring.
              </p>

              <div className="bg-zinc-800 rounded-lg border border-zinc-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-700 bg-zinc-800">
                      <th className="text-left px-4 py-3 text-zinc-300 font-semibold">Criterion</th>
                      <th className="text-center px-4 py-3 text-zinc-300 font-semibold">Points</th>
                      <th className="text-left px-4 py-3 text-zinc-300 font-semibold">Description</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-300">
                    <tr className="border-b border-zinc-700/50 bg-zinc-800/50">
                      <td className="px-4 py-3 font-medium text-zinc-100">L0 Gate</td>
                      <td className="px-4 py-3 text-center">25</td>
                      <td className="px-4 py-3">Build/lint pass. Total score capped at 25 on failure</td>
                    </tr>
                    <tr className="border-b border-zinc-700/50">
                      <td className="px-4 py-3 font-medium text-zinc-100">L1 Test</td>
                      <td className="px-4 py-3 text-center">30</td>
                      <td className="px-4 py-3">Proportional to test pass rate. Full marks when all pass</td>
                    </tr>
                    <tr className="border-b border-zinc-700/50 bg-zinc-800/50">
                      <td className="px-4 py-3 font-medium text-zinc-100">L2 Process</td>
                      <td className="px-4 py-3 text-center">20</td>
                      <td className="px-4 py-3">Reviewer approval, review iteration count (fewer = higher score)</td>
                    </tr>
                    <tr className="border-b border-zinc-700/50">
                      <td className="px-4 py-3 font-medium text-zinc-100">Value</td>
                      <td className="px-4 py-3 text-center">15</td>
                      <td className="px-4 py-3">Finding resolution, new discovery contribution</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-medium text-zinc-100">Efficiency</td>
                      <td className="px-4 py-3 text-center">10</td>
                      <td className="px-4 py-3">Cost efficiency (same results at lower cost)</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <InfoBox>
                Configure build/lint commands to match your project. For Node.js: <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-blue-300 text-xs">npm run build</code>,
                Gradle: <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-blue-300 text-xs">./gradlew build</code>,
                Flutter: <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-blue-300 text-xs">flutter analyze</code>, etc.
                If not configured, the corresponding check is skipped.
              </InfoBox>
            </div>
          </section>

          {/* 10. Settings Guide */}
          <section>
            <SectionHeading id="settings-guide" number={10} title="Settings Guide" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                On the Settings page (<code className="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-200 text-xs">/auto/settings</code>),
                you can fine-tune the behavior of autonomous mode.
              </p>

              <div className="bg-zinc-800 rounded-lg border border-zinc-700 overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-700 bg-zinc-800">
                      <th className="text-left px-4 py-3 text-zinc-300 font-semibold whitespace-nowrap">Setting</th>
                      <th className="text-left px-4 py-3 text-zinc-300 font-semibold">Description</th>
                      <th className="text-left px-4 py-3 text-zinc-300 font-semibold whitespace-nowrap">Default</th>
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

          {/* 11. Using Reports */}
          <section>
            <SectionHeading id="report-usage" number={11} title="Using Reports" />
            <div className="space-y-4 text-sm leading-relaxed">
              <p>
                The Report page (<code className="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-200 text-xs">/auto/report</code>) is
                the <strong className="text-zinc-100">central control panel</strong> where the CEO monitors the overall status of autonomous mode and issues instructions.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-2">Findings Overview</h3>
                  <p className="text-zinc-400 text-xs">Finding statistics by status: resolved, in progress, open, won&apos;t fix. View distribution by category and priority at a glance.</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-2">Recent Cycles</h3>
                  <p className="text-zinc-400 text-xs">View each cycle&apos;s score, cost, duration, and success/failure status in a table.</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-2">CEO Requests</h3>
                  <p className="text-zinc-400 text-xs">View and respond to escalation requests from agents. Handle blocking requests promptly.</p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-4 border border-zinc-700">
                  <h3 className="font-semibold text-zinc-100 mb-2">Instructions</h3>
                  <p className="text-zinc-400 text-xs">Issue new directions. Choose between permanent instructions or instructions limited to N cycles.</p>
                </div>
              </div>

              <InfoBox>
                While a session is running, the Report page <strong>auto-refreshes every 30 seconds</strong>.
                You can view the latest status in real-time without manually refreshing.
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
            Back to top
          </button>
        </div>
      </div>
    </div>
  );
}
