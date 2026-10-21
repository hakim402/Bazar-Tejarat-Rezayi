import { privateRequest } from "../../../lib/api/private-client";
import type { components } from "../../../lib/api/schema";
export type Profile = components["schemas"]["ProfileData"];
export type ReviewOperation = components["schemas"]["CaseOperation"];
export type ReviewCase = components["schemas"]["CaseData"];
export type Application = components["schemas"]["ApplicationData"];
export type Team = components["schemas"]["TeamData"];
export type Member = components["schemas"]["MemberData"];
export type Transfer = components["schemas"]["TransferData"];
export type Queue = components["schemas"]["QueueResult"];
export type TransferQueue = components["schemas"]["TransferQueue"];
export type InvitePreview = components["schemas"]["InvitationPreview"];
export const bundles = [
	"catalogue",
	"orders_negotiation",
	"payments_refunds",
	"fulfilment",
	"messaging",
] as const;
export const profileFields = [
	"display_name",
	"legal_name",
	"business_type",
	"contact_phone",
	"location",
	"representative",
] as const;
export const orgRequest = privateRequest;
export function profilePath(context: string, id?: string) {
	return `organizations/${context}/profiles/${id ? `${id}/` : ""}`;
}
