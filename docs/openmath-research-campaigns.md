# OpenMath Research Campaigns: Phase A Operations

This guide covers only Phase A research campaigns. A campaign creates isolated proof candidates as ordinary [OpenMath workflows](openmath-workflows.md), blind-screens them, runs a categorical tournament, deep-refines one survivor, and prepares an immutable dossier for an explicit human decision. The repository-owned fixture is in [`docs/examples/openmath-research-campaign/`](examples/openmath-research-campaign/).

Phase A evidence is not mathematical certification. The campaign never writes a canonical artifact or refines canonical authority.

## Configuration

Research campaigns are opt-in. There is no built-in or implicit research profile. Selection is an explicit `research_profile` supplied to start, then `openmath.default_research_profile`; otherwise start returns `PROFILE_NOT_FOUND`.

Add the fixture's [`profile.jsonc`](examples/openmath-research-campaign/profile.jsonc) fields under the top-level `openmath` key. File prompt URIs are relative to the config file that declares them, so adjust the fixture paths when copying it into `.opencode/oh-my-openmath.jsonc`. `workflow_allowed_roots` applies to workflow, research-prompt, and reference sources.

Each entry in `research_profiles` has exactly these fields:

| Field | Contract |
| --- | --- |
| `candidate_workflow_profile` | An existing workflow profile whose checkpoint is exactly `after_solve` |
| `strategies` | 2–8 unique `{ id, prompt }` entries |
| `candidates_per_strategy` | 1–4; strategies times this value must not exceed 32 |
| `screening_roles` | 1–4 unique `{ id, agent, prompt, model?, variant? }` entries |
| `max_active_candidates` | 1–32 and no greater than the total candidate count |
| `survivor_limit` | 1–32 and no greater than the total candidate count |
| `tournament_role` | `{ agent, prompt, model?, variant? }` |

Research prompts are either `{ "kind": "inline", "content": "..." }` or `{ "kind": "file", "uri": "file://..." }`; the workflow-only `builtin` prompt source is not accepted. `variant` requires `model`. Start freezes the selected profile, all prompt bytes and hashes, resolved models, candidate workflow profile, objective, and references before dispatch.

The objective is the existing workflow request union: a `problem` with text or file source, or `markdown`. Reference manifests use the same YAML/JSON/JSONC format and source controls described in the [workflow guide](openmath-workflows.md#reference-manifests-and-snapshots).

## Tools and Operating Loop

Tool names use underscores; slash commands use hyphens.

| Tool / slash command | Exact purpose |
| --- | --- |
| `openmath_research_start` / `/openmath-research-start` | Create revision 0 from `campaign_id`, optional `research_profile`, `objective`, and optional `reference_manifest_path`; dispatch nothing |
| `openmath_research_status` / `/openmath-research-status` | Read state; dispatch and recovery are never triggered |
| `openmath_research_step` / `/openmath-research-step` | Execute or reconcile using `campaign_id`, exact `expected_state_revision`, and optional `one_stage` or `to_checkpoint` mode |
| `openmath_research_amend` / `/openmath-research-amend` | Add or retract a revision-checked Phase A amendment |
| `openmath_research_promote` / `/openmath-research-promote` | Record `approve` or `reject` against an exact revision and dossier SHA-256 |
| `openmath_research_abort` / `/openmath-research-abort` | Request or complete a revision-checked abort |

The fixture's [`expected-tool-sequence.json`](examples/openmath-research-campaign/expected-tool-sequence.json) is a structural catalog of all six routes and valid input shapes. `promote` and `abort` are alternative terminal controls, not two operations to run consecutively.

1. Start with a unique campaign ID. Start does not create candidates.
2. Select only an entry returned in `next_actions` and send its `required_state_revision` as `expected_state_revision`.
3. Use `one_stage` for one persisted operation or reconciliation. Use `to_checkpoint` to continue only within that explicit call until a pause, block, or terminal state.
4. After interruption or restart, call status, then explicitly call `step` with the returned revision. Status, startup, timers, and recovery hooks never dispatch work.
5. On `STALE_STATE_REVISION`, discard the planned mutation, read status, and choose again. On a live operation owner, expect `STORAGE_BUSY`; only an explicit step can recover a dead recorded owner.
6. Treat `ok: true` as a successfully returned state, not as campaign completion. Inspect `status`, `awaiting_reason`, and `next_actions`.

## Phase Matrix

Campaign phases are not workflow stages. Child workflows remain SOLVE, REVIEW, and REVISE.

| Phase | Phase A operation | Boundary |
| --- | --- | --- |
| `DISCOVERY` | Create strategy candidates as separate child workflows and stop each at `after_solve` | Candidate isolation remains active |
| `SCREENING` | Run every configured independent screen and aggregate only after all required receipts commit | Pause at `AWAITING_HUMAN/AFTER_INITIAL_SCREEN` |
| `TOURNAMENT` | Compare admitted candidates with categorical actions; optionally create one lineage-only merge candidate | `NEEDS_HUMAN` pauses for an applicable amendment |
| `DEEP_REFINEMENT` | Continue exactly one selected or fresh merge child through the unchanged workflow | Child intervention pauses; child `EXHAUSTED` or `ABORTED` rejects |
| `PROMOTION` | Build an immutable dossier and wait for the exact human decision | Pause at `AWAITING_HUMAN/BEFORE_PROMOTION`; decision ends at `PROMOTION_READY` or `REJECTED` |

## Status and Action Matrices

| Status | Meaning |
| --- | --- |
| `READY` | The next phase operation may be explicitly run. |
| `RUNNING` | A persisted operation is active or requires explicit reconciliation. |
| `AWAITING_HUMAN` | Execution is at one of the four declared human pauses. |
| `BLOCKED` | Reconciliation cannot safely infer one result. |
| `PROMOTION_READY` | Terminal approved metadata; not canonical promotion or correctness certification. |
| `REJECTED` | Terminal rejection. |
| `ABORTED` | Terminal abort. |

| State | Returned actions |
| --- | --- |
| `READY` | `step_one_stage`, `step_to_checkpoint`, `amend`, `abort` |
| `RUNNING` | `step_one_stage`, `abort` |
| `BLOCKED` | `step_one_stage`, `abort` |
| `AWAITING_HUMAN/AFTER_INITIAL_SCREEN` | `step_one_stage`, `step_to_checkpoint`, `amend`, `abort` |
| `AWAITING_HUMAN/TOURNAMENT_NEEDS_HUMAN` | `amend`, `abort`; both step actions appear only after an applicable `next_tournament` amendment |
| `AWAITING_HUMAN/CHILD_WORKFLOW_INTERVENTION` | `amend`, `abort`; both step actions appear only after an applicable `selected_refinement` amendment |
| `AWAITING_HUMAN/BEFORE_PROMOTION` | `promote`, `abort` |
| `PROMOTION_READY`, `REJECTED`, `ABORTED` | No actions |

Every returned action carries the current `required_state_revision`. Amendment kinds are `question`, `required_check`, `suspected_blocker`, and `scope_change`. Scopes are `candidate:<id>`, `all_candidates`, `next_screen`, `all_remaining_screens`, `next_tournament`, and `selected_refinement`.

## Candidate Isolation and Blind Screening

Every candidate starts in a fresh session with all tools denied. Its request contains only the common frozen objective and references plus that candidate's strategy prompt. It cannot contain a sibling ID, strategy, lineage, model, prompt, session, artifact, output, hash, timing, or size. Child identity is logical: each candidate owns one ordinary workflow run `<campaign_id>::<candidate_id>`; no Git branch is created.

Before all required initial screens commit, public `candidate_details` is `null`. Candidate summaries expose only candidate ID, strategy ID, and execution status.

Every screen also runs in a fresh all-tools-denied session. The model-facing blind DTO has exactly:

- `objective`: frozen objective content without source provenance
- `reference_contents`: captured reference text only
- `target_artifact`: `{ content }` only
- `screening_instructions`: the selected role's captured instructions

It excludes campaign, candidate, parent, and sibling IDs; strategy and lineage; model/provider and prompt provenance; session IDs; timestamps; artifact versions, media types, and hashes; and every other candidate output. Provenance is attached only to the internal receipt after the model-facing input is built.

## Categorical Screening and Tournament Rules

A screen output has one verdict, `VIABLE`, `REPAIRABLE`, `FATAL_FLAW`, or `INCONCLUSIVE`, plus exactly four string arrays: `blocking_issues`, `unresolved_obligations`, `assumptions`, and `novel_elements`. These are reviewer text only. In particular, `unresolved_obligations` does not create proof-obligation entities or a graph.

All configured roles must screen every candidate before tournament admission. Per-candidate aggregation is deterministic: any `FATAL_FLAW` wins; otherwise any `REPAIRABLE`; otherwise any `INCONCLUSIVE`; otherwise `VIABLE`. Only `VIABLE` and `REPAIRABLE` survive. The cap uses all viable candidates first, then repairable candidates, preserving candidate creation order. There are no scores, ranks, or probabilities.

The tournament sees only admitted candidates under stable anonymous labels. Its result is either:

- one `KEEP` and `DROP` for every other admitted candidate;
- `MERGE_IDEA` for at least two acyclic parents, `DROP` for the rest, and one synthesis brief; or
- `NEEDS_HUMAN`.

Actions cover every admitted candidate exactly once. Numeric comparison fields are rejected. `MERGE_IDEA` can occur at most once and creates exactly one fresh child with immutable parent IDs and the synthesis brief. It never concatenates, copies, patches, or stores parent artifact bytes.

## Human Gate and Dossier

After the selected child reaches workflow `PASSED`, Phase A creates and hash-binds an immutable dossier, then stops at `AWAITING_HUMAN/BEFORE_PROMOTION`. The public dossier always reports:

```json
{
  "canonical": false,
  "mathematical_correctness_certified": false,
  "human_approval_required": true
}
```

`openmath_research_promote` requires the exact current revision, exact dossier SHA-256, and explicit `approve` or `reject`. Caller session and message identity come only from trusted tool context. Approval records the decision and transitions to terminal `PROMOTION_READY`; rejection transitions to terminal `REJECTED`. Neither result writes or exports a canonical artifact, certifies correctness, changes authority, dispatches work, schedules a task, or exposes another action.

## Opaque Attachments

An attachment reference has exactly `attachment_id`, `kind`, `schema_version`, `content_sha256`, and `storage_ref`. Phase A may retain and hash these references. It has no attachment loader, verifier, result/status model, dependency graph, invalidation algorithm, or domain-specific attachment subtype.

## Phase B–D Exclusions and STOP Boundary

Phase A does not configure or implement obligations, counterexample or witness execution, Lean or another formal verifier, axiom or statement-alignment audits, independence groups, diversity enforcement, novelty search, certification, or later-phase budget policy. Keys such as `obligations`, `counterexample`, `formal_verifier`, `independence_group`, and `novelty` are rejected by the strict profile schema. There is no `canonical_promote` route.

The campaign ends at terminal `PROMOTION_READY` or `REJECTED` after the explicit human decision. It produces no canonical artifact, correctness certification, authority refinement, or automatic continuation. Any later phase requires a separate explicit human request and a separately approved plan.
