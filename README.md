> [!WARNING]
> **Security warning: impersonation site**
>
> **ohmyopencode.com is NOT affiliated with this project.** We do not operate or endorse that site.
>
> OhMyOpenCode is **free and open-source**. Do **not** download installers or enter payment details on third-party sites that claim to be "official."
>
> Because the impersonation site is behind a paywall, we **cannot verify what it distributes**. Treat any downloads from it as **potentially unsafe**.
>
> ✅ Official downloads: https://github.com/code-yeongyu/oh-my-opencode/releases

<div align="center">

[![GitHub Release](https://img.shields.io/github/v/release/code-yeongyu/oh-my-opencode?color=369eff&labelColor=black&logo=github&style=flat-square)](https://github.com/code-yeongyu/oh-my-opencode/releases)
[![npm downloads](https://img.shields.io/npm/dt/oh-my-opencode?color=ff6b35&labelColor=black&style=flat-square)](https://www.npmjs.com/package/oh-my-opencode)
[![License](https://img.shields.io/badge/license-SUL--1.0-white?labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-opencode/blob/master/LICENSE.md)

</div>

# OpenMath Orchestrator

**OpenMath Orchestrator** is an OpenCode plugin designed for guided math problem-solving. It transforms OpenCode into a rigorous mathematical reasoning engine by orchestrating specialized agents to solve, review, verify, and coach through complex problems.

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
Focuses on proposing mathematical solutions. It explores different approaches and derives answers based on the problem statement.

### 📚 Reviewer Agent
Acts as a rigorous peer reviewer. It checks solutions against known references, identifies logical fallacies, and ensures mathematical precision.

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
- **Configurable Review Rounds**: Set `max_review_rounds` (default 3, max 20)
- **State Management**: Durable state tools (`openmath_state_get`, `openmath_state_set`, `openmath_state_reset`) to track progress across sessions.
- **Specialized Roles**: Distinct prompts and contexts for each agent role.

## Installation

```bash
npx oh-my-opencode install
```

## Configuration

Configuration is stored in `.opencode/oh-my-opencode.jsonc`. You can customize agent models and parameters there.

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
    // Maximum review rounds (1-20, default 3)
    "max_review_rounds": 5,
    // Default mode
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
{
  "agents": {
    "solver": { "model": "claude-3-5-sonnet" },
    "verifier": { "model": "gpt-4o" }
  }
}
```

## Usage

### Interactive Mode (Default)

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

### Export Mode

Export solved artifacts to student/teacher markdown files:

```
/openmath-export {"session_id":"SMT-HW1::PB4","dir":"./exports","prefix":"hw1_pb4"}
```

Generates:
- `hw1_pb4_solution_for_student.md` - Hint ladder only (sequential)
- `hw1_pb4_solution_for_teacher.md` - Full solution + complete rubric + review certificate + variant problem

### State Management

Access and manage OpenMath session state:

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

**Fallback**: If patch application fails 2 rounds in a row with the same error, a full regeneration occurs.

### Legacy JSON Mode

Set `"artifacts": { "format": "json" }` in config to use the original JSON-only mode with `solver` and `reference-reviewer` agents.

## File Reference Format

When using `problem_ref`, the tool extracts problems from files using these patterns:

- **Numbered format**: `4. Problem text...` or `4) Problem text...`
- **Named format**: `Problem 4. Problem text...` or `Problem 4) Problem text...`

**Supported file types:** `.md`, `.tex`

**Allowed directories:** Project directory + `~/test/openmath-test`


## License

This project is licensed under the SUL-1.0 License.
