import type { z } from "zod"

import type { AggregateInvariantInput } from "./aggregate-invariant-input"

export function validateTournamentSelection(state: AggregateInvariantInput, context: z.RefinementCtx): void {
  if (state.selected_candidate_id === null) return
  const latest = state.tournament_receipts[state.tournament_receipts.length - 1]
  if (latest === undefined) {
    addIssue(context, "Selected candidate requires a tournament receipt")
    return
  }
  switch (latest.result.kind) {
    case "NEEDS_HUMAN":
      addIssue(context, "NEEDS_HUMAN cannot select a candidate")
      return
    case "DECIDED": {
      const kept = latest.result.actions.find((action) => action.action === "KEEP")
      if (kept !== undefined) {
        if (state.selected_candidate_id !== kept.candidate_id) addIssue(context, "Selected candidate must match KEEP")
        return
      }
      validateMergeSelection(state, latest.result, context)
      return
    }
    default:
      assertNever(latest.result)
  }
}

function validateMergeSelection(
  state: AggregateInvariantInput,
  result: Extract<AggregateInvariantInput["tournament_receipts"][number]["result"], { readonly kind: "DECIDED" }>,
  context: z.RefinementCtx,
): void {
  const selected = state.candidates.find((candidate) => candidate.candidate_id === state.selected_candidate_id)
  if (selected === undefined) {
    addIssue(context, "Selected merge candidate must exist")
    return
  }
  switch (selected.candidate_kind) {
    case "STRATEGY":
      addIssue(context, "MERGE_IDEA must select a merge candidate")
      return
    case "MERGE_IDEA": {
      const parents = result.actions.filter((action) => action.action === "MERGE_IDEA").map((action) => action.candidate_id)
      const parentsMatch = parents.length === selected.parent_candidate_ids.length
        && parents.every((parent, index) => parent === selected.parent_candidate_ids[index])
      const briefMatches = selected.synthesis_brief === result.synthesis_brief
        && selected.synthesis_brief_sha256 === result.synthesis_brief_sha256
      if (!parentsMatch || !briefMatches) addIssue(context, "Merge selection must match ordered parents and synthesis brief")
      return
    }
    default:
      assertNever(selected)
  }
}

function addIssue(context: z.RefinementCtx, message: string): void {
  context.addIssue({ code: "custom", path: ["selected_candidate_id"], message })
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected tournament selection variant: ${String(value)}`)
}
