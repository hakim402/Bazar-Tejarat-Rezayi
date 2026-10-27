import { privateRequest } from "../../../lib/api/private-client.ts";
import type { components } from "../../../lib/api/schema.d";
export type StockPosition = components["schemas"]["Position"];
export type StockOverview = components["schemas"]["Overview"];
export type StockMovement = components["schemas"]["Movement"];
export type StockHistory = components["schemas"]["History"];
export type StockProfiles = components["schemas"]["Profiles"];
export function inventoryRequest<T>(path: string, data?: unknown) {
	return privateRequest<T>(`inventory/${path}`, data);
}
