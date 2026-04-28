export const OPENMATH_SOLVE_ONLY_TEMPLATE = `# /openmath-solve-only

Run OpenMath in SOLVE_ONLY mode: generate artifacts for one or more problems, run SOLVE->REVIEW rounds, freeze artifacts on [CORRECT], then STOP.

## Tool Contract (Non-Negotiable)

You MUST call this tool (exact name): openmath_solve_only

### Required Tool Arguments

- session_id: string
- problems: [{ id: string, prefix?: string, problem?: string, problem_ref?: { file_path: string, problem_number: number } }]

### Optional Tool Arguments

- subject?: string
- chapter_context?: string
- textbook_markdown?: string
- supplementary_refs?: string[]
- max_concurrency?: number
- max_review_rounds?: number
- note: consecutive patch-failure fallback is configured via openmath.max_consecutive_patch_failures in project config
- auto_export?: boolean
- export_dir?: string

## Usage

Preferred (deterministic): pass a JSON object matching the tool input schema:

\`\`\`
/openmath-solve-only {"session_id":"root","problems":[{"id":"p1","problem":"x+1=2"}]}
\`\`\`

Problem references (from file):

\`\`\`
/openmath-solve-only {"session_id":"root","problems":[{"id":"p3","problem_ref":{"file_path":"@sheet.md","problem_number":3}}]}
\`\`\`

\`problem_ref\` reads from either the project directory or \`~/test/openmath-test\` only. Supported file types: \`.md\`, \`.tex\`. Supported headers: \`N.\` or \`Problem N\`.

Fallback (simple):

\`\`\`
/openmath-solve-only <session_id> <problem_id> "<problem text>"
\`\`\`

If required arguments are missing or ambiguous, ask exactly ONE targeted question, then proceed.

## Execute

1) Parse $ARGUMENTS into the tool input.
2) Call openmath_solve_only with the parsed input.
3) Return the tool output. Do not paraphrase or add extra analysis.
`;
