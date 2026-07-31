# Configurable and Interruptible OpenMath Workflows

This is the operational guide for profile-driven OpenMath workflows. For the configuration schema alone, see [Configurations](configurations.md#interruptible-openmath-workflow-profiles). The repository-owned fixture is in [`docs/examples/openmath-workflow/`](examples/openmath-workflow/).

## Purpose

Use workflow tools when a run needs named SOLVE, REVIEW, and REVISE roles, external prompts or references, deterministic stop rules, explicit checkpoints, amendments, source reloads, or restart-safe progress.

Use `/openmath-solve-only` for the existing batch-oriented educational solve/review loop when those controls are unnecessary. Workflow stages are atomic: a run pauses between stages, never by interrupting token streaming or live-editing a stage in progress.

## Quick Start

The canonical [`profile.jsonc`](examples/openmath-workflow/profile.jsonc) is a complete `openmath` object, accompanied by three prompt files and [`references.yaml`](examples/openmath-workflow/references.yaml). To use it from `.opencode/oh-my-openmath.jsonc`:

1. Put the fixture's fields under the top-level `openmath` key.
2. Because file prompt URIs are relative to the declaring config file, change the three URIs to `file://../docs/examples/openmath-workflow/SOLVER_MARKDOWN.md`, `file://../docs/examples/openmath-workflow/REFERENCE_REVIEWER.md`, and `file://../docs/examples/openmath-workflow/SOLVER_MARKDOWN_PATCH.md`.
3. Restart OpenCode so the profile and file prompts are loaded.
4. Start the run, read status, then use the revision attached to the selected action:

```text
/openmath-workflow-start {"run_id":"proof-1","workflow_profile":"openmath-documentation-example","request":{"kind":"markdown","instruction":"Write and verify a proof."},"reference_manifest_path":"docs/examples/openmath-workflow/references.yaml"}
/openmath-workflow-status {"run_id":"proof-1"}
/openmath-workflow-step {"run_id":"proof-1","expected_state_revision":0,"mode":"to_checkpoint"}
```

Revision `0` is valid immediately after a successful start. After any other operation, take `required_state_revision` from the chosen `next_actions` entry instead of reusing this example value.

## Configuration and Profile Schema

New configuration belongs in `.opencode/oh-my-openmath.jsonc` or the corresponding user config. These `openmath` defaults are relevant to workflows:

| Field | Default |
| --- | --- |
| `artifacts.format` | `"markdown"` |
| `max_review_rounds` | `3` |
| `max_consecutive_patch_failures` | `2` |
| `workflow_profiles` | `{}` |
| `workflow_allowed_roots` | `["."]` |
| `state_filename_mode` | `"linux"` |

`default_mode` is optional and has no schema default.

`workflow_profiles` is keyed by names matching `^[a-z][a-z0-9-]*$`. Every profile has these required fields:

| Field | Contract |
| --- | --- |
| `solve`, `review`, `revise` | Role objects described below |
| `min_review_rounds` | Positive integer |
| `max_review_rounds` | Positive integer, at least `min_review_rounds` |
| `required_consecutive_passes` | Positive integer, no greater than `max_review_rounds` |
| `checkpoint` | `none`, `after_solve`, `after_review`, or `every_stage` |

Each role object has:

| Field | Contract |
| --- | --- |
| `agent` | Required nonblank agent name |
| `model` | Optional explicit `provider/model`; both segments must be nonblank and contain no whitespace |
| `variant` | Optional nonblank variant; valid only with an explicit `model` |
| `prompt` | Required prompt source |
| `output_adapter` | Required adapter compatible with the role's stage |

Prompt sources have exactly one of these shapes:

```json
{ "kind": "builtin" }
{ "kind": "inline", "content": "Nonblank instructions" }
{ "kind": "file", "uri": "file://./PROMPT.md" }
```

A file prompt is resolved relative to the config layer that declared it and must remain inside `workflow_allowed_roots`. Its bytes and hash are captured when the profile is loaded.

Profile selection order is:

1. `workflow_profile` supplied to start.
2. `openmath.default_workflow_profile`.
3. A legacy built-in selected from `openmath.artifacts.format`.

The only built-in workflow profiles are:

| Name | SOLVE | REVIEW | REVISE | Stop and checkpoint policy |
| --- | --- | --- | --- | --- |
| `legacy-educational-markdown` | `solver-markdown` / `legacy_omo_sections` | `reference-reviewer-markdown` / `review_verdict_json` | `solver-markdown-patch` / `patch_set_json` | minimum 1, consecutive passes 1, checkpoint `none`, maximum inherited from `openmath.max_review_rounds` |
| `legacy-educational-json` | `solver` / `legacy_json_artifacts` | `reference-reviewer` / `review_verdict_json` | `solver` / `legacy_json_artifacts` | minimum 1, consecutive passes 1, checkpoint `none`, maximum inherited from `openmath.max_review_rounds` |

Any other profile name must be configured; `research-full-markdown` is not built in.

## Stage-Compatible Adapters

| Stage | Valid `output_adapter` values |
| --- | --- |
| SOLVE | `legacy_omo_sections`, `legacy_json_artifacts`, `opaque_markdown` |
| REVIEW | `review_verdict_json`, `review_verdict_markdown` |
| REVISE | `patch_set_json`, `full_replace_markdown`, `legacy_json_artifacts` |

`review_verdict_markdown` requires exactly one standalone, unfenced line: `VERDICT: PASS`, `VERDICT: REVISE`, or `VERDICT: INCONCLUSIVE`. `full_replace_markdown` expects complete replacement Markdown, not patch-set JSON.

## Stop Policy and Checkpoints

A `PASS` completes the run only after both `min_review_rounds` and `required_consecutive_passes` are satisfied. An earlier `PASS` continues to another REVIEW. `REVISE` advances to REVISE. `INCONCLUSIVE` pauses and resumes at REVIEW after an applicable amendment or reload. If the pass criteria are not met by `max_review_rounds`, the run becomes `EXHAUSTED`.

Checkpoint policies apply after committed, nonterminal stages:

| Policy | Pauses after |
| --- | --- |
| `none` | No routine stage checkpoint |
| `after_solve` | SOLVE |
| `after_review` | REVIEW |
| `every_stage` | SOLVE, REVIEW, and REVISE |

Terminal outcomes override checkpoints. A nonterminal inconclusive review pauses for intervention rather than as a routine checkpoint.

## Request Shapes

Start accepts either a problem request or a Markdown request.

Problem text:

```json
{
  "kind": "problem",
  "source": { "kind": "text", "text": "Prove that ..." },
  "subject": "Analysis",
  "chapter_context": "Chapter 2",
  "textbook_markdown": "Optional context",
  "supplementary_refs": ["Optional inline reference"]
}
```

Problem file:

```json
{
  "kind": "problem",
  "source": { "kind": "file", "file_path": "@[problems.md]", "problem_number": 4 }
}
```

The file source requires a positive integer `problem_number` and uses the existing `.md`/`.tex` problem extractor. `subject`, `chapter_context`, `textbook_markdown`, and `supplementary_refs` are optional.

Markdown:

```json
{
  "kind": "markdown",
  "instruction": "Review and improve this proof.",
  "initial_artifact": "Optional starting Markdown"
}
```

`instruction` is nonblank. `initial_artifact`, when supplied, is also nonblank.

## Reference Manifests and Snapshots

`reference_manifest_path` points to a YAML, JSON, or JSONC manifest:

```yaml
version: 1
references:
  - id: proof-source
    path: proof-source.md
    role: authoritative
    stages: [solve, review, revise]
    required: true
```

Each entry has a nonblank unique `id`, a nonblank `path`, one `role`, one or more unique `stages`, and optional `required` (default `true`). Valid roles are `authoritative`, `accepted_prior`, `background`, `candidate`, and `empirical_evidence`. Valid stage scopes are `solve`, `review`, and `revise`; only matching references are supplied to a stage.

The manifest itself may use a project-relative path, an absolute path, a `file://` path, or `~/`, but its canonical path must be inside `workflow_allowed_roots`. Each allowed root must resolve to a directory. Entry paths are relative to the manifest directory; absolute and `file://` entry paths are invalid. The manifest and references must resolve to regular files inside an allowed root. Canonical-path checks reject traversal, prefix collisions, and symlink escapes. A missing entry is tolerated only when `required: false`; other source failures reject the snapshot.

Manifest provenance and paths are retained, while captured reference content and stage-specific reference bundles are hash-bound. Manifest document bytes are not retained as a hash-bound snapshot. Editing source files does not change a running workflow. `openmath_workflow_reload` re-reads the persisted original manifest path and increments the snapshot version; it cannot substitute a new path. Likewise, prompt reload uses each persisted original URI and base directory. File prompt and reference bytes remain fixed until that explicit reload.

Without `reference_manifest_path`, a problem request's `supplementary_refs` are retained as legacy inline references for all three stages. Such a run has no persisted manifest path and cannot reload references.

## Tools and Slash Commands

Tool names use underscores. Built-in slash commands use the corresponding hyphenated names.

| Tool / slash command | Exact input fields |
| --- | --- |
| `openmath_workflow_start` / `/openmath-workflow-start` | `run_id`, `request`; optional `workflow_profile`, `reference_manifest_path` |
| `openmath_workflow_step` / `/openmath-workflow-step` | `run_id`, `expected_state_revision`; optional `mode` (`one_stage` or `to_checkpoint`) |
| `openmath_workflow_status` / `/openmath-workflow-status` | `run_id` |
| `openmath_workflow_amend` / `/openmath-workflow-amend` | Add: `run_id`, `expected_state_revision`, `operation: "add"`, `kind`, `scope`, `content`; retract: `run_id`, `expected_state_revision`, `operation: "retract"`, `amendment_id` |
| `openmath_workflow_reload` / `/openmath-workflow-reload` | `run_id`, `expected_state_revision`, nonempty unique `targets` containing `prompts`, `references`, or both |
| `openmath_workflow_abort` / `/openmath-workflow-abort` | `run_id`, `expected_state_revision`; optional `reason` |

`one_stage` executes or reconciles one stage and is used when `mode` is omitted. `to_checkpoint` continues until the next pause or terminal state.

Every success envelope contains `ok`, `run_id`, `state_revision`, `status`, nullable `stage`, nullable `artifact`, nullable `latest_review`, and `next_actions`. Every error envelope contains `ok: false`, `error_code`, `message`, and, when available, `current_state_revision`.

## Revision-Safe Operating Loop

1. Start with a unique `run_id` and retain the success envelope.
2. Select only an operation listed in `next_actions`.
3. Send that action's `required_state_revision` as `expected_state_revision` for every mutation.
4. After a checkpoint, client interruption, or OpenCode restart, call status before acting and use its returned `next_actions[].required_state_revision`.
5. If `STALE_STATE_REVISION` occurs, discard the planned mutation, call status, and choose again from the new `next_actions`.
6. Stop when status is `PASSED`, `EXHAUSTED`, or `ABORTED`.

`RUNNING` intentionally has no `next_actions` while a stage attempt is active. If status still reports `RUNNING` after an interrupted call or restart, invoke step in `one_stage` mode with the envelope's current `state_revision` to reconcile the persisted attempt. A `BLOCKED` reconciliation exposes only `step_one_stage` and `abort`.

## Statuses, Pauses, and Actions

| Status | Meaning |
| --- | --- |
| `READY` | The next stage can run. |
| `RUNNING` | A stage attempt is active or awaiting restart reconciliation. |
| `AWAITING_HUMAN` | The run paused at a checkpoint or requires an input change. |
| `BLOCKED` | Automatic reconciliation could not establish a safe stage result. |
| `PASSED` | Terminal success; stop policy satisfied. |
| `EXHAUSTED` | Terminal; maximum reviews reached without satisfying the stop policy. |
| `ABORTED` | Terminal; the run was aborted. |

`AWAITING_HUMAN` reasons are:

| Reason | Meaning |
| --- | --- |
| `CHECKPOINT` | Routine policy checkpoint. |
| `INCONCLUSIVE` | REVIEW needs an applicable amendment or source reload before retrying REVIEW. |
| `PARSE_FAILURE` | Adapter output was invalid and requires an applicable intervention before retrying. |

`next_actions` reasons are `READY_TO_RUN`, `CHECKPOINT_PAUSED`, `INPUT_CHANGE_REQUIRED`, and `RECONCILIATION_BLOCKED`. Actions are `step_one_stage`, `step_to_checkpoint`, `amend`, `reload_prompts`, `reload_references`, and `abort`. Terminal states have `stage: null` and no next actions; step, amend, reload, and abort mutations are rejected after termination.

## Amend, Retract, Reload, and Abort

Add amendments only while `READY` or `AWAITING_HUMAN`:

- `kind`: `question`, `required_check`, `suspected_blocker`, or `scope_change`.
- `scope`: `next_review`, `all_remaining`, or `round:N` where `N` is a positive integer.
- `content`: nonblank text.

`next_review` amendments are consumed by the next REVIEW. Retract only an active `amendment_id`, also while `READY` or `AWAITING_HUMAN`. Retraction does not erase history and can make an intervention unsatisfied again.

Reload is allowed only while `READY` or `AWAITING_HUMAN`. Targets must be nonempty and unique. Reloading either prompts or references can satisfy an `INCONCLUSIVE` or `PARSE_FAILURE` intervention, but a routine checkpoint does not require intervention. Reload always uses persisted sources, not caller-supplied replacement paths.

Abort immediately enters `ABORTED` from `READY`, `AWAITING_HUMAN`, or `BLOCKED`. During `RUNNING`, it records an abort request that the atomic stage lifecycle honors; it does not interrupt a token stream. Abort normally returns a success envelope; terminal status `ABORTED` is not a top-level tool error in the public flow. Terminal runs cannot be aborted again.

## Persistence Note

Workflow state is stored under `.sisyphus/openmath-workflows/<sha256(run_id)>`. Revision `N` is published as a new immutable `state.rev-NNNNNNNNNNNN.json` file; earlier revision files are not overwritten. Mutations use compare-and-swap against `expected_state_revision`.

On restart, the reader selects the highest allocated revision. If that revision is unreadable, invalid, or unsupported, it returns `STORAGE_READ_FAILED` and never falls back to an older revision. A committed stage is not redispatched. An incomplete recorded attempt is reconciled from its persisted session and receipt identity; ambiguous reconciliation becomes `BLOCKED` rather than guessing. Resume with status and the revision-safe loop above, never by editing persistence files.

## Legacy Compatibility

- `oh-my-openmath` and `oh-my-openmath.json[c]` are canonical. `oh-my-opencode` and `oh-my-opencode.json[c]` are legacy compatibility names only.
- `artifacts.format: "markdown"` selects `legacy-educational-markdown` when no explicit or default profile is selected; `"json"` selects `legacy-educational-json`.
- `/openmath-solve-only`, export behavior, and existing educational artifact adapters remain supported.
- `openmath_state_get`, `openmath_state_set`, and `openmath_state_reset` are legacy raw-state tools. They are not workflow status or mutation tools.
- `supplementary_refs` without a manifest preserves the legacy inline-reference path, but explicit reference reload requires a file-backed manifest.

## Troubleshooting

Tool calls return either the success envelope described above or a top-level `ok: false` error envelope. Stage-record diagnostics are retained internally and are not exposed as fields in the public success envelope.

| Scope | Error code | Meaning and response |
| --- | --- | --- |
| Top-level error envelope | `VALIDATION_ERROR` | Input does not match the strict request schema. Correct field names, values, and request shape. |
| Top-level error envelope | `RUN_NOT_FOUND` | No persisted run matches `run_id`. Check the ID and project directory. |
| Top-level error envelope | `RUN_ALREADY_EXISTS` | The `run_id` already has revision 0. Resume it with status or choose a new ID. |
| Top-level error envelope | `PROFILE_NOT_FOUND` | The selected profile is neither configured nor one of the two legacy built-ins. |
| Top-level error envelope | `ILLEGAL_TRANSITION` | The operation is not allowed in the current status. Call status and follow `next_actions`. |
| Top-level error envelope | `STALE_STATE_REVISION` | Another operation advanced the run. Call status and retry only with the newly returned required revision. |
| Top-level error envelope | `PROMPT_SOURCE_ERROR` | A file prompt is missing, stale, invalid, or outside allowed roots. Fix the configured source, restart for config changes, or reload the persisted prompt source where allowed. |
| Top-level error envelope | `REFERENCE_SOURCE_ERROR` | The manifest or a reference failed source validation. Manifest detail codes are `invalid_path`, `missing`, `unreadable`, `not_directory`, `non_regular`, `outside_allowed_roots`, `unsupported_extension`, `invalid_utf8`, `invalid_syntax`, `invalid_schema`, and `duplicate_id`. |
| Stage-record diagnostic | `ADAPTER_OUTPUT_INVALID` | The public call may return `ok: true` with `AWAITING_HUMAN` and authoritative `next_actions`. Adapter detail is retained internally; follow `next_actions` to amend or reload, then retry. |
| Top-level error envelope | `STORAGE_READ_FAILED` | The highest allocated revision could not be read or validated. Repair storage; the reader will not fall back to an older revision. |
| Top-level error envelope | `STORAGE_WRITE_FAILED` | A new revision could not be written. Check filesystem access and space, then call status before retrying. |
| Top-level error envelope | `STORAGE_BUSY` | Another writer owns the mutation. Call status and retry from the latest revision. |
| Top-level error envelope | `STORAGE_ATOMICITY_UNAVAILABLE` | The filesystem cannot provide the required no-replace atomic publication. Use a supported local filesystem. |
| Top-level error envelope | `SUBAGENT_FAILED` | Stage dispatch or an unexpected operation failed. Call status before deciding whether to retry or abort. |
| Stage-record diagnostic | `RECONCILIATION_BLOCKED` | The tool call may return `ok: true` with `BLOCKED`; use the returned `step_one_stage` action or abort. |

For `review_verdict_markdown`, emit exactly one standalone valid verdict line; do not omit, duplicate, conflict, or fence it.
