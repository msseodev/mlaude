# Comprehensive Project Review

You are conducting a comprehensive project review. Launch exactly 8 analysis subagents in PARALLEL using the Agent tool — all 8 in a single response. After all agents complete, synthesize their results into a final report.

$ARGUMENTS

If the user provided arguments above, focus the review on those specific areas or files. If no arguments were provided, review the entire project.

---

## Subagent Instructions

Launch all 8 of the following agents simultaneously. Each agent must:
- Read relevant source files and configuration
- Identify 3-5 key findings, each with a severity level (critical / high / medium / low)
- Provide specific file paths and line references for each finding
- Give actionable recommendations for each finding
- Structure output with clear headers

---

### Agent 1: Code Quality

Analyze the codebase for code quality issues.

Focus areas:
- **Code duplication**: Find repeated logic that should be extracted into shared utilities or functions. Look for copy-pasted blocks across files.
- **Complexity**: Identify functions or modules with excessive cyclomatic complexity (deeply nested conditionals, long functions over 100 lines).
- **Naming consistency**: Check that naming conventions (camelCase, PascalCase, snake_case) are applied consistently across the codebase.
- **Dead code**: Find unused exports, unreachable branches, commented-out code blocks, and unused variables/imports.
- **Circular dependencies**: Trace import chains to detect circular dependency risks.

Output format:
```
## Code Quality Analysis
### Findings
1. [severity] Finding title — Description with file:line references
   Recommendation: ...
2. ...
### Summary
Brief overall assessment of code quality.
```

---

### Agent 2: Architecture

Analyze the project's architectural design and structure.

Focus areas:
- **Module separation**: Evaluate whether modules have clear, single responsibilities. Identify god-modules that do too much.
- **Layer boundaries**: Check if presentation, business logic, and data access layers are properly separated. Flag layer violations (e.g., UI components directly accessing the database).
- **Dependency direction**: Verify dependencies flow in one direction (e.g., UI -> service -> data). Flag reverse or circular dependency flows.
- **Extensibility**: Assess how easy it is to add new features without modifying existing code. Look for hardcoded values that should be configurable.
- **Pattern consistency**: Check if architectural patterns (e.g., repository pattern, service layer, API route conventions) are applied consistently throughout.

Output format:
```
## Architecture Analysis
### Findings
1. [severity] Finding title — Description with file:line references
   Recommendation: ...
2. ...
### Summary
Brief overall assessment of architecture.
```

---

### Agent 3: UX/Usability

Analyze the user-facing experience and interface quality.

Focus areas:
- **UI flows**: Trace critical user journeys. Identify dead ends, confusing navigation, or missing feedback (loading states, success/error messages).
- **Error handling UX**: Check how errors are presented to users. Look for raw error messages, missing error boundaries, or silent failures.
- **Accessibility (a11y)**: Check for missing ARIA labels, keyboard navigation support, color contrast issues, and screen reader compatibility.
- **Responsiveness**: Evaluate layout behavior across viewport sizes. Find hardcoded widths, overflow issues, or missing media queries.
- **UX consistency**: Check for inconsistent button styles, spacing, typography, or interaction patterns across pages.

Output format:
```
## UX/Usability Analysis
### Findings
1. [severity] Finding title — Description with file:line references
   Recommendation: ...
2. ...
### Summary
Brief overall assessment of UX/usability.
```

---

### Agent 4: Performance

Analyze performance characteristics and potential bottlenecks.

Focus areas:
- **Bundle size**: Check for large dependencies, missing tree-shaking opportunities, or unnecessary imports that bloat the client bundle.
- **Rendering bottlenecks**: Identify unnecessary re-renders, missing memoization (React.memo, useMemo, useCallback), or expensive computations in render paths.
- **DB query efficiency**: Look for N+1 queries, missing indexes, unbounded queries (no LIMIT), or queries inside loops.
- **Memory leak potential**: Find event listeners not cleaned up, intervals not cleared, growing data structures, or missing AbortController usage.
- **Caching**: Identify opportunities for caching (API responses, computed values, static assets) and check for missing cache invalidation.

Output format:
```
## Performance Analysis
### Findings
1. [severity] Finding title — Description with file:line references
   Recommendation: ...
2. ...
### Summary
Brief overall assessment of performance.
```

---

### Agent 5: Security

Analyze security posture and vulnerability surface.

Focus areas:
- **OWASP Top 10**: Check for SQL injection, XSS, CSRF, broken access control, security misconfiguration, and other OWASP Top 10 vulnerabilities.
- **Auth/AuthZ**: Evaluate authentication and authorization mechanisms. Look for missing auth checks on API routes or privilege escalation paths.
- **Input validation**: Check that all user inputs (query params, request bodies, file uploads) are validated and sanitized before use.
- **Dependency vulnerabilities**: Note if there are known vulnerable dependencies or outdated packages with security advisories.
- **Secret exposure**: Look for hardcoded secrets, API keys, tokens, or credentials in source code, config files, or environment variable mishandling.

Output format:
```
## Security Analysis
### Findings
1. [severity] Finding title — Description with file:line references
   Recommendation: ...
2. ...
### Summary
Brief overall assessment of security.
```

---

### Agent 6: Testing

Analyze test coverage and test quality.

Focus areas:
- **Test coverage gaps**: Identify critical modules, functions, or code paths that lack test coverage. Focus on business logic and edge cases.
- **Test quality**: Evaluate whether tests actually assert meaningful behavior or are shallow smoke tests. Look for tests that can never fail.
- **Edge case coverage**: Check if tests cover boundary conditions, error paths, empty inputs, null values, and concurrent operations.
- **Test structure**: Evaluate test organization, naming conventions, setup/teardown patterns, and use of test utilities or fixtures.

Output format:
```
## Testing Analysis
### Findings
1. [severity] Finding title — Description with file:line references
   Recommendation: ...
2. ...
### Summary
Brief overall assessment of testing.
```

---

### Agent 7: DX (Developer Experience)

Analyze the developer experience for contributors.

Focus areas:
- **Build time**: Assess build and dev server startup performance. Identify slow compilation steps or missing incremental build support.
- **Documentation**: Check for missing or outdated README, API docs, inline code comments, and architecture decision records.
- **Config complexity**: Evaluate the complexity of configuration files (tsconfig, eslint, webpack, etc.). Identify redundant or confusing config options.
- **Onboarding difficulty**: Assess how easy it is for a new developer to clone, install, and start working. Look for undocumented setup steps or missing environment variable templates.
- **Debugging ease**: Check for proper error messages, logging, source maps, and dev tools integration. Identify areas where debugging is unnecessarily difficult.

Output format:
```
## DX (Developer Experience) Analysis
### Findings
1. [severity] Finding title — Description with file:line references
   Recommendation: ...
2. ...
### Summary
Brief overall assessment of DX.
```

---

### Agent 8: Maintainability

Analyze long-term maintainability and sustainability.

Focus areas:
- **Tech debt**: Identify accumulated technical debt — workarounds, TODOs, deprecated API usage, and shortcuts that will cost more to fix later.
- **Versioning**: Check if the project follows semantic versioning, has a changelog, and manages breaking changes properly.
- **Dependency freshness**: Assess how up-to-date dependencies are. Identify stale or unmaintained dependencies that may need replacement.
- **Migration ease**: Evaluate how difficult it would be to upgrade major dependencies (React, Next.js, TypeScript, etc.) or migrate to new patterns.
- **Code ownership**: Check if knowledge is concentrated in specific files or patterns that only one person understands. Identify bus-factor risks.

Output format:
```
## Maintainability Analysis
### Findings
1. [severity] Finding title — Description with file:line references
   Recommendation: ...
2. ...
### Summary
Brief overall assessment of maintainability.
```

---

## Synthesis Instructions

After ALL 8 agents have completed, synthesize their results into a single comprehensive report with the following structure:

### Final Report Format

```
# Project Review Report

## Executive Summary
A 3-5 sentence overview of the project's overall health, highlighting the most critical findings and strengths.

## Findings by Perspective

### Code Quality
[Summarize agent 1 findings]

### Architecture
[Summarize agent 2 findings]

### UX/Usability
[Summarize agent 3 findings]

### Performance
[Summarize agent 4 findings]

### Security
[Summarize agent 5 findings]

### Testing
[Summarize agent 6 findings]

### DX (Developer Experience)
[Summarize agent 7 findings]

### Maintainability
[Summarize agent 8 findings]

## Priority-Ranked Recommendations

### Quick Wins (low effort, high impact)
1. ...
2. ...

### Long-Term Improvements (higher effort, strategic value)
1. ...
2. ...

## Overall Project Health Score: X/10
Brief justification for the score.
```
