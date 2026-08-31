> [!WARNING]
> **Security warning: impersonation site**
>
> **ohmyopencode.com is NOT affiliated with this project.** We do not operate or endorse that site.
>
> OpenMath Orchestrator is **free and open-source**. Do **not** download installers or enter payment details on third-party sites that claim to be "official."
>
> Because the impersonation site is behind a paywall, we **cannot verify what it distributes**. Treat any downloads from it as **potentially unsafe**.
>
> ✅ Official downloads: https://github.com/code-yeongyu/oh-my-opencode/releases

<div align="center">

[![GitHub Release](https://img.shields.io/github/v/release/code-yeongyu/oh-my-opencode?color=369eff&labelColor=black&logo=github&style=flat-square)](https://github.com/code-yeongyu/oh-my-opencode/releases)
[![npm downloads](https://img.shields.io/npm/dt/oh-my-openmath?color=ff6b35&labelColor=black&style=flat-square)](https://www.npmjs.com/package/oh-my-openmath)
[![License](https://img.shields.io/badge/license-SUL--1.0-white?labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-opencode/blob/master/LICENSE.md)

</div>

# OpenMath Orchestrator

**OpenMath Orchestrator** is an OpenCode plugin designed for guided math problem-solving. It transforms OpenCode into a rigorous mathematical reasoning engine by orchestrating specialized agents to solve, review, verify, and coach through complex problems.

> [!IMPORTANT]
> **Canonical package/config name**
>
> Use `oh-my-openmath` going forward.
>
> - Install with `oh-my-openmath`
> - Configure `.opencode/oh-my-openmath.jsonc` or `~/.config/opencode/oh-my-openmath.jsonc`
> - Treat `oh-my-opencode` / `oh-my-opencode.json[c]` as **legacy compatibility names only** where older setups still mention them
>
> **Q: Should I create `oh-my-openmath.jsonc` instead of `oh-my-opencode.jsonc`?**
> Yes. `oh-my-openmath.jsonc` is the canonical filename for new setups.
>
> **Q: Can this coexist with `oh-my-openagent`?**
> That is the goal of the rename: keep `oh-my-openmath` on its own package/config namespace so it does not collide with `oh-my-openagent` migration behavior.

## Overview

This plugin replaces general-purpose coding agents with a structured loop coordinated by **Sisyphus**. The orchestrator manages a team of specialized sub-agents to ensure accuracy and depth in mathematical problem solving.

## The Team

### 🤖 Sisyphus (Orchestrator)
The central coordinator that manages the problem-solving loop. Sisyphus breaks down problems, delegates tasks to specialists, and synthesizes the final result.

### 🧮 Solver Agent
Focuses on proposing mathematical solutions. It explores different approaches and derives answers based on the problem statement.

- **`solver-markdown`**: Generates canonical markdown artifacts (reference solution, hint ladder, grading rubric, variant problem)
- **`solver-markdown-patch`**: Produces patch operations to refine existing artifacts based on reviewer feedback (Round ≥ 2)

### 📚 Reviewer Agent
Acts as a rigorous peer reviewer. It checks solutions against known references, identifies logical fallacies, and ensures mathematical precision.

- **`reference-reviewer-markdown`**: Reviews canonical markdown artifacts and returns verdict + blocking issues (no patch ops)

### ✅ Verifier Agent
Responsible for checking the correctness of the steps. It validates calculations and logical deductions to prevent hallucinations.

### 🎓 Coach Agent
Provides guidance and hints without giving away the answer directly. Useful for educational contexts or when the user wants to be guided through the solution.

## Key Features

- **Guided Problem Solving**: A structured loop ensuring rigorous thinking
- **Markdown Artifacts Mode**: Efficient patch-based refinement (default) or legacy JSON mode
- **Solve-Only Mode**: Batch problem solving with configurable concurrency
- **File Reference Support**: Reference problems from `@filename.md` or `@filename.tex`
- **State Management**: Durable state tools to track progress across sessions
- **Export Mode**: Generate student/teacher markdown artifacts
- **Research Educationalization**: Turn an explicitly approved, certified research result into independently reviewed student/teacher materials without changing the approved proof
- **Configurable Review Rounds**: Set `max_review_rounds` (default 3, minimum 1)
- **Specialized Roles**: Distinct prompts and contexts for each agent role.

## Installation

```bash
npx oh-my-openmath install
```

## Configuration

Configuration is stored in `.opencode/oh-my-openmath.jsonc` or `~/.config/opencode/oh-my-openmath.jsonc`. You can customize agent models and parameters there. If you are migrating from an older setup, `oh-my-opencode.json[c]` should be treated as a legacy compatibility filename, not the default for new installs.

```jsonc
{
  "openmath": {
    // Artifact format: "markdown" (default) or "json"
    "artifacts": {
      "format": "markdown",
      "patch": {
        "max_ops": 20,
        "allow_unique_substring_replace": true
      }
    },
    // Maximum review rounds (minimum 1, default 3)
    "max_review_rounds": 5,
    // Consecutive markdown patch failures before full regeneration (minimum 1, default 2)
    "max_consecutive_patch_failures": 3,
    // State storage filename mode: "linux" (default, backward-compatible) or "windows"
    // In "windows" mode, forbidden filename chars are escaped with underscore tokens (e.g., :: -> _x3A__x3A_)
    "state_filename_mode": "linux",
    // Optional mode selection
    "default_mode": "interactive",
    // Solve-only mode settings
    "solve_only": {
      "max_concurrency": 3,
      "auto_export": false,
      "export_dir": "./exports"
    },
    // Export settings
    "export": {
      "default_dir": "./exports",
      "overwrite": false,
      "allowed_base_dirs": [".", "~/test/openmath-test"]
    }
  },
  "localization": {
    // Response language: "auto" or specific tag (e.g., "ko", "en")
    "response_language": "auto"
  },
  "performance": {
    "delegate_task_timing": {
      "poll_interval_ms": 250,
      "min_stability_time_ms": 1000
    }
  }
}
```

```jsonc
{
  // Default markdown-mode agent overrides
  "openmath": {
    "artifacts": { "format": "markdown" }
  },
  "agents": {
    "solver-markdown": { "model": "openai/gpt-5.2" },
    "solver-markdown-patch": { "model": "openai/gpt-5.2" },
    "reference-reviewer-markdown": { "model": "anthropic/claude-opus-4-6" },
    "reference-reviewer-patch": { "model": "anthropic/claude-opus-4-6" },
    "verifier": { "model": "gpt-4o" }
  }
}
```

For legacy JSON mode (`"artifacts": { "format": "json" }`), use `solver` and `reference-reviewer` overrides instead of markdown-mode agent keys.

## Usage

### Interactive Mode

Let Sisyphus guide you through the problem-solving process:

```
Solve this problem: Prove that the intersection of any collection of σ-fields is a σ-field.
```

### Solve-Only Mode

Batch solve multiple problems with configurable concurrency:

**Direct problem text:**
```
/openmath-solve-only {"session_id":"SMT-HW1","problems":[{"id":"PB4","problem":"4. (a) Suppose each P_i is a σ-field..."}]}
```

**File reference (@[filename] + problem number):**
```
/openmath-solve-only {"session_id":"SMT-HW1","problems":[{"id":"PB4","problem_ref":{"file_path":"@[HW1.md]","problem_number":4}}]}
```

The tool will:
1. Extract problem 4 from `HW1.md` (supports `.md` and `.tex`)
2. Run solve → review → patch refinement loop
3. Stop on `[CORRECT]` or reach `max_review_rounds`

**With export:**
```
/openmath-solve-only {"session_id":"SMT-HW1","problems":[{"id":"PB4","problem_ref":{"file_path":"@[HW1.md]","problem_number":4}}],"auto_export":true,"export_dir":"./exports"}
```

### Research Campaign to Educational Export

Research campaigns are opt-in. Copy the Phase B example fields from [`docs/examples/openmath-research-campaign/profile.jsonc`](docs/examples/openmath-research-campaign/profile.jsonc) under your config's `openmath` key, including `workflow_profiles`, `research_profiles`, and `workflow_allowed_roots`.

Start a certified research campaign, then execute only actions returned by status. Every mutation must use the latest returned revision:

```text
/openmath-research-start {"campaign_id":"proof-1","research_profile":"phase-b-certification-example","objective":{"kind":"markdown","instruction":"Prove the stated result."},"reference_manifest_path":"docs/examples/openmath-research-campaign/references.yaml"}
/openmath-research-step {"campaign_id":"proof-1","expected_state_revision":0,"expected_certification_revision":null,"mode":"to_checkpoint"}
/openmath-research-status {"campaign_id":"proof-1"}
```

Repeat `status` → returned `next_actions` until the campaign pauses before promotion. Approve using the exact campaign revision, certification revision, and dossier hash returned by the campaign, then educationalize that approved identity:

```text
/openmath-research-promote {"campaign_id":"proof-1","expected_state_revision":<campaign-revision>,"expected_certification_revision":<certification-revision>,"dossier_sha256":"<64-char-dossier-sha256>","decision":"approve"}
/openmath-research-educationalize {"campaign_id":"proof-1","expected_state_revision":<approved-campaign-revision>,"expected_certification_revision":<certification-revision>,"dossier_sha256":"<same-dossier-sha256>"}
```

Export the returned frozen identity through the normal renderer:

```text
/openmath-export {"research_educationalization_id":"research-education-<sha256>","dir":"./exports","prefix":"proof-1"}
```

Educationalization preserves the approved proof bytes. It generates and independently reviews only hints, rubric, and a variant problem. `PEDAGOGICAL_PASS` is not canonical authority or a machine-checked correctness certificate. See the [research campaign guide](docs/openmath-research-campaigns.md) for recovery, Phase B evidence, and truth boundaries.

### Export Mode

Export solved artifacts to student/teacher markdown files:

```
/openmath-export {"session_id":"SMT-HW1::PB4","dir":"./exports","prefix":"hw1_pb4"}
```

Generates:
- `hw1_pb4_solution_for_student.md` - Hint ladder only (sequential)
- `hw1_pb4_solution_for_teacher.md` - Full solution + complete rubric + review certificate + variant problem

### Legacy State Management

Access and manage legacy OpenMath session state. These raw-state tools do not mutate configurable workflow runs:

```
/openmath_state_get {"session_id":"SMT-HW1::PB4"}
/openmath_state_set {"session_id":"SMT-HW1::PB4","state":{...}}
/openmath_state_reset {"session_id":"SMT-HW1::PB4"}
```

## How It Works

### Markdown Artifacts Mode (Default)

1. **Round 1**: `solver-markdown` generates canonical markdown artifacts
2. **Review**: `reference-reviewer-markdown` checks artifacts, returns:
   - `verdict`: `[CORRECT]`, `[ERROR]`, or `[INCONCLUSIVE]`
   - `blocking_issues`: Up to 3 specific issues to fix
3. **Round ≥ 2**: `solver-markdown-patch` produces patch operations to fix issues
4. **Apply**: Patch is applied deterministically with base-hash verification
5. **Repeat** until `[CORRECT]` or `max_review_rounds` reached

**Fallback**: If patch application fails `max_consecutive_patch_failures` rounds in a row with the same error, a full regeneration occurs. Default: `2`.

### Legacy JSON Mode

Set `"artifacts": { "format": "json" }` in config to use the original JSON-only mode with `solver` and `reference-reviewer` agents.

### Configurable Interruptible Workflows

Workflow profiles are opt-in configurations for the SOLVE, REVIEW, and REVISE stages. They select each stage's agent, model, prompt source, output adapter, stop policy, and checkpoint policy. Existing solve-only behavior remains available without defining a profile.

```text
/openmath-workflow-start {"run_id":"proof-1","workflow_profile":"openmath-documentation-example","request":{"kind":"markdown","instruction":"Write and verify a proof."},"reference_manifest_path":"docs/examples/openmath-workflow/references.yaml"}
/openmath-workflow-status {"run_id":"proof-1"}
/openmath-workflow-step {"run_id":"proof-1","expected_state_revision":0,"mode":"to_checkpoint"}
```

Use the revision returned by status or by the chosen `next_actions` entry; `0` above is the initial revision of a newly started run.

Core properties:

- Stages are atomic; interruption occurs between stages at explicit checkpoints, not during token streaming.
- Prompt and reference file bytes stay fixed for a run until an explicit reload from the persisted source.
- Every mutation is revision-checked, and every success response supplies authoritative `next_actions`.
- Runs persist across OpenCode restarts and resume through status plus the returned action and revision.

See the [OpenMath workflow guide](docs/openmath-workflows.md), [Phase A research campaign guide](docs/openmath-research-campaigns.md), [configuration reference](docs/configurations.md#interruptible-openmath-workflow-profiles), and [canonical workflow fixtures](docs/examples/openmath-workflow/).

## File Reference Format

When using `problem_ref`, the tool extracts problems from files using these patterns:

- **Numbered format**: `4. Problem text...` or `4) Problem text...`
- **Named format**: `Problem 4. Problem text...` or `Problem 4) Problem text...`

**Supported file types:** `.md`, `.tex`

**Allowed directories:** Project directory + `~/test/openmath-test`


## License

This project is licensed under the SUL-1.0 License.
