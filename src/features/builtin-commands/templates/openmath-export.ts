export const OPENMATH_EXPORT_TEMPLATE = `# /openmath-export

Export the currently frozen OpenMath artifacts for a session to student/teacher markdown files.

This command MUST NOT modify or regenerate artifacts. It only exports what is already frozen.

## Tool Contract (Non-Negotiable)

You MUST call this tool (exact name): openmath_export

### Required Tool Arguments

- session_id: string

### Optional Tool Arguments

- dir?: string
- prefix?: string
- overwrite?: boolean

## Usage

Preferred (deterministic): pass a JSON object matching the tool input schema:

\`\`\`
/openmath-export {"session_id":"root::p1","dir":"./exports","prefix":"algebra-","overwrite":false}
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
