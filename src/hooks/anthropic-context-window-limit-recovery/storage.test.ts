import { describe, test, expect, mock, beforeEach } from "bun:test"

import { truncateUntilTargetTokens } from "./target-token-truncation"
import type { ToolResultInfo } from "./tool-part-types"

describe("truncateUntilTargetTokens", () => {
	const sessionID = "test-session"

	const findToolResultsBySizeMock = mock((_sessionID: string): ToolResultInfo[] => [])
	const truncateToolResultMock = mock(
		(_partPath: string): { success: boolean; toolName?: string; originalSize?: number } => ({
			success: false,
		})
	)

	beforeEach(() => {
		findToolResultsBySizeMock.mockReset()
		truncateToolResultMock.mockReset()
	})

	test("truncates only until target is reached", async () => {
		const results = [
			{ partPath: "path1", partId: "id1", messageID: "m1", toolName: "tool1", outputSize: 1000 },
			{ partPath: "path2", partId: "id2", messageID: "m2", toolName: "tool2", outputSize: 1000 },
		]

		findToolResultsBySizeMock.mockReturnValue(results)
		truncateToolResultMock.mockImplementation((path: string) => ({
			success: true,
			toolName: path === "path1" ? "tool1" : "tool2",
			originalSize: 1000,
		}))

		const result = await truncateUntilTargetTokens(sessionID, 1000, 1000, 0.5, 1, undefined, {
			findToolResultsBySize: findToolResultsBySizeMock,
			truncateToolResult: truncateToolResultMock,
		})

		expect(result.truncatedCount).toBe(1)
		expect(truncateToolResultMock).toHaveBeenCalledTimes(1)
		expect(truncateToolResultMock).toHaveBeenCalledWith("path1")
		expect(result.totalBytesRemoved).toBe(1000)
		expect(result.sufficient).toBe(true)
	})

	test("truncates all if target not reached", async () => {
		const results = [
			{ partPath: "path1", partId: "id1", messageID: "m1", toolName: "tool1", outputSize: 100 },
			{ partPath: "path2", partId: "id2", messageID: "m2", toolName: "tool2", outputSize: 100 },
		]

		findToolResultsBySizeMock.mockReturnValue(results)
		truncateToolResultMock.mockImplementation((path: string) => ({
			success: true,
			toolName: path === "path1" ? "tool1" : "tool2",
			originalSize: 100,
		}))

		const result = await truncateUntilTargetTokens(sessionID, 1000, 1000, 0.5, 1, undefined, {
			findToolResultsBySize: findToolResultsBySizeMock,
			truncateToolResult: truncateToolResultMock,
		})

		expect(result.truncatedCount).toBe(2)
		expect(truncateToolResultMock).toHaveBeenCalledTimes(2)
		expect(result.totalBytesRemoved).toBe(200)
		expect(result.sufficient).toBe(false)
	})
})
