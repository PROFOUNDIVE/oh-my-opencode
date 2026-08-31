import { readCertificationGeneration, type CertificationReadResult } from "../storage"
import type { CertificationApplicationDependencies } from "./certification-application-dependencies"
import type {
  CertificationApplicationFailure,
  CertificationContext,
} from "./certification-application-types"
import { loadCertificationContext } from "./load-certification-context"

export type ResearchCertificationReadResult =
  | Readonly<{ readonly kind: "disabled"; readonly campaign: CertificationContext["campaign"] }>
  | Readonly<{
      readonly kind: "ok"
      readonly context: CertificationContext
      readonly read: Exclude<CertificationReadResult, { readonly kind: "error" }>
    }>
  | (CertificationApplicationFailure & Readonly<{ readonly campaign?: CertificationContext["campaign"] }>)

export async function readResearchCertification(
  input: Readonly<{ readonly directory: string; readonly campaign_id: string }>,
  dependencies: CertificationApplicationDependencies = {},
  options: Readonly<{ readonly allow_aborted?: boolean }> = {},
): Promise<ResearchCertificationReadResult> {
  const loaded = await loadCertificationContext(input, dependencies, options)
  if (loaded.kind !== "ok") return loaded
  const read = await (dependencies.read_generation ?? readCertificationGeneration)({
    directory: input.directory,
    ...loaded.context.storage_identity,
  })
  return read.kind === "error"
    ? { ...read, campaign: loaded.context.campaign }
    : { kind: "ok", context: loaded.context, read }
}
