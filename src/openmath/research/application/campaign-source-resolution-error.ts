export class CampaignSourceResolutionError extends Error {
  readonly name = "CampaignSourceResolutionError"

  constructor(message: string) {
    super(message)
  }
}
