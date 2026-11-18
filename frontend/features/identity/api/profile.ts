import type { components } from "../../../lib/api/schema.d";
import { ApiError } from "../../../lib/api/client.ts";
import { privateRequest } from "../../../lib/api/private-client.ts";
import {
	accountSession,
	authMutation,
	type AccountContext,
	type AuthResult,
} from "./accounts.ts";

type Media = components["schemas"]["Media"];

export type Gender = "" | "male" | "female" | "other" | "prefer_not_to_say";
export type PreferredLocale = "" | "fa-AF" | "en" | "ps" | "ar";

// Mirrors accounts.api.contracts.IdentityData until the schema artifacts are regenerated.
export type ProfileIdentity = components["schemas"]["IdentityData"] & {
	first_name: string;
	last_name: string;
	phone: string;
	bio: string;
	gender: Gender;
	date_of_birth: string | null;
	preferred_locale: PreferredLocale;
	avatar: Media | null;
	date_joined: string;
};

export type ProfileUpdate = Partial<{
	display_name: string;
	first_name: string;
	last_name: string;
	phone: string;
	bio: string;
	gender: Gender;
	date_of_birth: string | null;
	preferred_locale: PreferredLocale;
}>;

export type Address = {
	id: string;
	label: string;
	recipient_name: string;
	phone: string;
	province: string;
	city: string;
	area: string;
	street_address: string;
	landmark: string;
	is_default: boolean;
};

export type AddressPayload = Partial<Omit<Address, "id">>;

function identityOf(result: AuthResult): ProfileIdentity {
	if (!result.identity) throw new ApiError("invalid");
	return result.identity as ProfileIdentity;
}

export async function fetchProfile(
	context: AccountContext,
): Promise<ProfileIdentity> {
	const session = await accountSession(context);
	return session.identity as ProfileIdentity;
}

export async function updateProfile(
	context: AccountContext,
	changes: ProfileUpdate,
): Promise<ProfileIdentity> {
	return identityOf(
		await authMutation(`${context}/profile/`, changes, "PATCH"),
	);
}

export async function uploadAvatar(
	context: AccountContext,
	file: File,
): Promise<ProfileIdentity> {
	const form = new FormData();
	form.append("file", file);
	return identityOf(
		await authMutation(`${context}/profile/avatar/`, form, "POST"),
	);
}

export async function removeAvatar(
	context: AccountContext,
): Promise<ProfileIdentity> {
	return identityOf(
		await authMutation(`${context}/profile/avatar/`, {}, "DELETE"),
	);
}

export function listAddresses(context: AccountContext): Promise<Address[]> {
	return privateRequest<Address[]>(`auth/${context}/profile/addresses/`);
}

export function createAddress(
	context: AccountContext,
	payload: AddressPayload,
): Promise<Address> {
	return privateRequest<Address>(
		`auth/${context}/profile/addresses/`,
		payload,
		"POST",
	);
}

export function updateAddress(
	context: AccountContext,
	id: string,
	payload: AddressPayload,
): Promise<Address> {
	return privateRequest<Address>(
		`auth/${context}/profile/addresses/${id}/`,
		payload,
		"PATCH",
	);
}

export function deleteAddress(
	context: AccountContext,
	id: string,
): Promise<{ status: string }> {
	return privateRequest<{ status: string }>(
		`auth/${context}/profile/addresses/${id}/`,
		{},
		"DELETE",
	);
}
