import { readWorkflowState } from "../../../workflow/storage"
import { compareAndSwapResearchCampaignState, readResearchCampaignState } from "../../storage"
import {
  acquireCertificationOperationLock,
  compareAndSwapCertificationGeneration,
  initializeCertificationGeneration,
  readCertificationAttachment,
  readCertificationGeneration,
  releaseCertificationOperationLock,
  repairCertificationGenerationIndex,
} from "../storage"

export type CertificationApplicationDependencies = Readonly<{
  readonly read_campaign?: typeof readResearchCampaignState
  readonly compare_and_swap_campaign?: typeof compareAndSwapResearchCampaignState
  readonly read_child?: typeof readWorkflowState
  readonly read_generation?: typeof readCertificationGeneration
  readonly read_attachment?: typeof readCertificationAttachment
  readonly initialize_generation?: typeof initializeCertificationGeneration
  readonly repair_generation_index?: typeof repairCertificationGenerationIndex
  readonly compare_and_swap_generation?: typeof compareAndSwapCertificationGeneration
  readonly acquire_operation_lock?: typeof acquireCertificationOperationLock
  readonly release_operation_lock?: typeof releaseCertificationOperationLock
}>
