import { describe, it, expect, mock, afterAll, spyOn } from "bun:test"

import * as backgroundUpdateCheck from "./hook/background-update-check"

const mockShowConfigErrorsIfAny = mock(async () => {})
const mockShowModelCacheWarningIfNeeded = mock(async () => {})
const mockUpdateAndShowConnectedProvidersCacheStatus = mock(async () => {})
const mockShowLocalDevToast = mock(async () => {})
const mockShowVersionToast = mock(async () => {})
const mockRunBackgroundUpdateCheck = mock(async () => {})
const mockGetCachedVersion = mock(() => "3.6.0")
const mockGetLocalDevVersion = mock(() => "3.6.0")

mock.module("./hook/config-errors-toast", () => ({
  showConfigErrorsIfAny: mockShowConfigErrorsIfAny,
}))

mock.module("./hook/model-cache-warning", () => ({
  showModelCacheWarningIfNeeded: mockShowModelCacheWarningIfNeeded,
}))

mock.module("./hook/connected-providers-status", () => ({
  updateAndShowConnectedProvidersCacheStatus:
    mockUpdateAndShowConnectedProvidersCacheStatus,
}))

mock.module("./hook/startup-toasts", () => ({
  showLocalDevToast: mockShowLocalDevToast,
  showVersionToast: mockShowVersionToast,
}))

mock.module("./checker", () => ({
  getCachedVersion: mockGetCachedVersion,
  getLocalDevVersion: mockGetLocalDevVersion,
}))

mock.module("../../shared/logger", () => ({
  log: () => {},
}))

afterAll(() => {
  mock.restore()
})

const { createAutoUpdateCheckerHook } = await import("./hook")

describe("createAutoUpdateCheckerHook", () => {
  it("skips startup toasts and checks in CLI run mode", async () => {
    //#given - CLI run mode enabled
    process.env.OPENCODE_CLI_RUN_MODE = "true"
    mockShowConfigErrorsIfAny.mockClear()
    mockShowModelCacheWarningIfNeeded.mockClear()
    mockUpdateAndShowConnectedProvidersCacheStatus.mockClear()
    mockShowLocalDevToast.mockClear()
    mockShowVersionToast.mockClear()
    mockRunBackgroundUpdateCheck.mockClear()

    const bgSpy = spyOn(backgroundUpdateCheck, "runBackgroundUpdateCheck").mockImplementation(
      mockRunBackgroundUpdateCheck as never,
    )

    try {
      const hook = createAutoUpdateCheckerHook(
        {
          directory: "/test",
          client: {} as never,
        } as never,
        { showStartupToast: true, isSisyphusEnabled: true, autoUpdate: true }
      )

      //#when - session.created event arrives
      hook.event({
        event: {
          type: "session.created",
          properties: { info: { parentID: undefined } },
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 25))

      //#then - no update checker side effects run
      expect(mockShowConfigErrorsIfAny).not.toHaveBeenCalled()
      expect(mockShowModelCacheWarningIfNeeded).not.toHaveBeenCalled()
      expect(mockUpdateAndShowConnectedProvidersCacheStatus).not.toHaveBeenCalled()
      expect(mockShowLocalDevToast).not.toHaveBeenCalled()
      expect(mockShowVersionToast).not.toHaveBeenCalled()
      expect(mockRunBackgroundUpdateCheck).not.toHaveBeenCalled()
    } finally {
      bgSpy.mockRestore()
      delete process.env.OPENCODE_CLI_RUN_MODE
    }
  })
})
