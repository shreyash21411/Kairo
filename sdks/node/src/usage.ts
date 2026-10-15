import { KairoValidationError } from "./exceptions";
import type { Kairo } from "./client";
import type { ProjectUsageReport, GetUsageOptions } from "./models";

/**
 * Usage reporting resource.
 * Access via `client.usage`.
 */
export class UsageResource {
    /** @internal */
    private readonly _client: Kairo;

    constructor(client: Kairo) {
        this._client = client;
    }

    /**
     * Retrieve aggregated usage report for a specified project.
     *
     * @param projectId - The unique project identifier.
     * @param options - Optional date filtering options (from, to).
     * @returns The aggregated ProjectUsageReport.
     */
    async get(
        projectId: number,
        options?: GetUsageOptions
    ): Promise<ProjectUsageReport> {
        if (typeof projectId !== "number" || projectId <= 0 || !Number.isInteger(projectId)) {
            throw new KairoValidationError(
                "projectId must be a positive integer.",
                400
            );
        }

        const queryParams = new URLSearchParams();
        if (options?.from) {
            const fromStr = options.from instanceof Date ? options.from.toISOString() : String(options.from);
            queryParams.set("from", fromStr);
        }
        if (options?.to) {
            const toStr = options.to instanceof Date ? options.to.toISOString() : String(options.to);
            queryParams.set("to", toStr);
        }

        const queryString = queryParams.toString();
        const path = queryString
            ? `api/v1/projects/${projectId}/usage?${queryString}`
            : `api/v1/projects/${projectId}/usage`;

        return this._client.request<ProjectUsageReport>("GET", path);
    }
}
