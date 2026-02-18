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

### 📚 Reviewer Agent
Acts as a rigorous peer reviewer. It checks solutions against known references, identifies logical fallacies, and ensures mathematical precision.

### ✅ Verifier Agent
Responsible for checking the correctness of the steps. It validates calculations and logical deductions to prevent hallucinations.

### 🎓 Coach Agent
Provides guidance and hints without giving away the answer directly. Useful for educational contexts or when the user wants to be guided through the solution.

## Key Features

- **Guided Problem Solving**: A structured loop ensuring rigorous thinking.
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
  "agents": {
    "solver": { "model": "claude-3-5-sonnet" },
    "verifier": { "model": "gpt-4o" }
  }
}
```

## License

This project is licensed under the SUL-1.0 License.
