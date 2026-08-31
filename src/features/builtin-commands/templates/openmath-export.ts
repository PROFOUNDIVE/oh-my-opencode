export const OPENMATH_EXPORT_TEMPLATE = `# /openmath-export

Export frozen solve-only or research-derived OpenMath educational artifacts to student/teacher markdown files.

This command MUST NOT modify or regenerate artifacts. It only exports what is already frozen.

## Tool Contract (Non-Negotiable)

You MUST call this tool (exact name): openmath_export

### Required Tool Arguments

- exactly one of session_id or research_educationalization_id

### Optional Tool Arguments

- dir?: string
- prefix?: string
- overwrite?: boolean

## Usage

Preferred (deterministic): pass a JSON object matching the tool input schema:

\`\`\`
/openmath-export {"session_id":"root::p1","dir":"./exports","prefix":"algebra-","overwrite":false}
\`\`\`

Research-derived:

\`\`\`
/openmath-export {"research_educationalization_id":"research-education-<sha256>","dir":"./exports","prefix":"research-proof","overwrite":false}
\`\`\`

Fallback (simple):

\`\`\`
/openmath-export <session_id> [dir]
\`\`\`

If required arguments are missing or ambiguous, ask exactly ONE targeted question, then proceed.

## Execute

1) Parse $ARGUMENTS into the tool input.
2) Call openmath_export with the parsed input.
3) Return the tool output. Do not paraphrase or add extra analysis.
`;
