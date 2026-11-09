import type { components } from "../../lib/api/schema.d";
import { ApiError, apiOrigin } from "../../lib/api/client.ts";
import { privateRequest } from "../../lib/api/private-client.ts";

export type ReportProfile = components["schemas"]["ReportProfile"];
export type SellerSummary = components["schemas"]["SellerSummary"];
export type BuyerSummary = components["schemas"]["BuyerSummary"];
export type ExportKind = "orders" | "payments" | "refunds";
export type Period = { start?: string; end?: string };

function search(values: Record<string, string | undefined>) {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(values))
		if (value) query.set(key, value);
	return query.size ? `?${query}` : "";
}

export function reportProfiles() {
	return privateRequest<{ results: ReportProfile[] }>(
		"reports/seller/profiles/",
	);
}

export function sellerSummary(seller: string, period: Period) {
	return privateRequest<SellerSummary>(
		`reports/seller/summary/${search({ seller, ...period })}`,
	);
}

export function buyerSummary(period: Period) {
	return privateRequest<BuyerSummary>(
		`reports/buyer/summary/${search({ ...period })}`,
	);
}

export async function downloadExport(
	seller: string,
	kind: ExportKind,
	period: Period,
) {
	const base = apiOrigin(process.env.NEXT_PUBLIC_API_URL);
	let response: Response;
	try {
		response = await fetch(
			`${base}/api/v1/reports/seller/export/${search({ seller, kind, ...period })}`,
			{
				credentials: "include",
				cache: "no-store",
				signal: AbortSignal.timeout(30000),
			},
		);
	} catch {
		throw new ApiError("unavailable");
	}
	if (
		!response.ok ||
		!response.headers.get("content-type")?.startsWith("text/csv")
	)
		throw new ApiError("invalid", response.status);
	const url = URL.createObjectURL(await response.blob());
	const link = document.createElement("a");
	link.href = url;
	link.download = `${kind}-${period.start ?? "start"}-${period.end ?? "end"}.csv`;
	document.body.append(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
