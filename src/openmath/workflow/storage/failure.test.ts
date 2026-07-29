import { registerCasValidationFailureCases } from "./cas-validation-failure-cases"
import { registerImmutabilityFailureCases } from "./immutability-failure-cases"
import { registerIterationTwoOwnershipRaces } from "./iteration-2-ownership-races"
import { registerLockFailureCases } from "./lock-failure-cases"
import { registerOwnershipRaceFailureCases } from "./ownership-race-failure-cases"
import { registerRaceFailureCases } from "./race-failure-cases"
import { registerStaleArchiveCleanupCases } from "./stale-archive-cleanup-cases"
import { registerWriteFaultCases } from "./write-fault-cases"

registerWriteFaultCases()
registerImmutabilityFailureCases()
registerIterationTwoOwnershipRaces()
registerCasValidationFailureCases()
registerOwnershipRaceFailureCases()
registerLockFailureCases()
registerRaceFailureCases()
registerStaleArchiveCleanupCases()
