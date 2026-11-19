"use client";

import { Input } from "../../../components/shadcn/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "../../../components/shadcn/native-select";
import { Textarea } from "../../../components/shadcn/textarea";
import { FormField } from "../../../components/ui/dialog-form";
import { authCopy } from "../../../lib/i18n/auth";
import { buyerProfileCopy } from "../../../lib/i18n/buyer-profile";
import { languageNames, locales, type Locale } from "../../../lib/i18n/locales";
import type { ProfileIdentity } from "../api/profile";

export type ProfileDraft = {
	display_name: string;
	first_name: string;
	last_name: string;
	phone: string;
	bio: string;
	gender: string;
	date_of_birth: string;
	preferred_locale: string;
};

export const emptyProfileDraft: ProfileDraft = {
	display_name: "",
	first_name: "",
	last_name: "",
	phone: "",
	bio: "",
	gender: "",
	date_of_birth: "",
	preferred_locale: "",
};

export function profileDraft(identity: ProfileIdentity): ProfileDraft {
	return {
		display_name: identity.display_name,
		first_name: identity.first_name,
		last_name: identity.last_name,
		phone: identity.phone,
		bio: identity.bio,
		gender: identity.gender,
		date_of_birth: identity.date_of_birth ?? "",
		preferred_locale: identity.preferred_locale,
	};
}

export const profileFieldNames = Object.keys(
	emptyProfileDraft,
) as (keyof ProfileDraft)[];

export function ProfileFields({
	locale,
	idPrefix,
	draft,
	onChange,
	disabled = false,
	errors = [],
}: {
	locale: Locale;
	idPrefix: string;
	draft: ProfileDraft;
	onChange: (key: keyof ProfileDraft, value: string) => void;
	disabled?: boolean;
	errors?: string[];
}) {
	const t = buyerProfileCopy[locale];
	const field = (key: keyof ProfileDraft) => ({
		id: `${idPrefix}-${key}`,
		error: errors.includes(key) ? authCopy[locale].invalid : undefined,
	});
	const control = (key: keyof ProfileDraft) => ({
		id: `${idPrefix}-${key}`,
		disabled,
		"aria-invalid": errors.includes(key),
		"aria-describedby": errors.includes(key)
			? `${idPrefix}-${key}-error`
			: key === "bio"
				? `${idPrefix}-${key}-help`
				: undefined,
	});

	return (
		<>
			<div className="sm:col-span-2">
				<FormField {...field("display_name")} label={t.displayName} required>
					<Input
						{...control("display_name")}
						value={draft.display_name}
						maxLength={150}
						required
						autoComplete="name"
						onChange={(event) => onChange("display_name", event.target.value)}
					/>
				</FormField>
			</div>
			<FormField
				{...field("first_name")}
				label={t.firstName}
				optional={t.optional}
			>
				<Input
					{...control("first_name")}
					value={draft.first_name}
					maxLength={150}
					autoComplete="given-name"
					onChange={(event) => onChange("first_name", event.target.value)}
				/>
			</FormField>
			<FormField
				{...field("last_name")}
				label={t.lastName}
				optional={t.optional}
			>
				<Input
					{...control("last_name")}
					value={draft.last_name}
					maxLength={150}
					autoComplete="family-name"
					onChange={(event) => onChange("last_name", event.target.value)}
				/>
			</FormField>
			<FormField {...field("phone")} label={t.phone} optional={t.optional}>
				<Input
					{...control("phone")}
					type="tel"
					dir="ltr"
					value={draft.phone}
					maxLength={40}
					autoComplete="tel"
					onChange={(event) => onChange("phone", event.target.value)}
				/>
			</FormField>
			<FormField {...field("gender")} label={t.gender} optional={t.optional}>
				<NativeSelect
					{...control("gender")}
					value={draft.gender}
					onChange={(event) => onChange("gender", event.target.value)}
				>
					<NativeSelectOption value="">—</NativeSelectOption>
					<NativeSelectOption value="male">{t.genderMale}</NativeSelectOption>
					<NativeSelectOption value="female">
						{t.genderFemale}
					</NativeSelectOption>
					<NativeSelectOption value="other">{t.genderOther}</NativeSelectOption>
					<NativeSelectOption value="prefer_not_to_say">
						{t.genderPreferNot}
					</NativeSelectOption>
				</NativeSelect>
			</FormField>
			<FormField
				{...field("date_of_birth")}
				label={t.dateOfBirth}
				optional={t.optional}
			>
				<Input
					{...control("date_of_birth")}
					type="date"
					dir="ltr"
					value={draft.date_of_birth}
					onChange={(event) => onChange("date_of_birth", event.target.value)}
				/>
			</FormField>
			<FormField
				{...field("preferred_locale")}
				label={t.preferredLanguage}
				optional={t.optional}
			>
				<NativeSelect
					{...control("preferred_locale")}
					value={draft.preferred_locale}
					onChange={(event) => onChange("preferred_locale", event.target.value)}
				>
					<NativeSelectOption value="">{t.noLanguage}</NativeSelectOption>
					{locales.map((value) => (
						<NativeSelectOption key={value} value={value}>
							{languageNames[value]}
						</NativeSelectOption>
					))}
				</NativeSelect>
			</FormField>
			<div className="sm:col-span-2">
				<FormField
					{...field("bio")}
					label={t.bio}
					optional={t.optional}
					help={t.bioHelp}
				>
					<Textarea
						{...control("bio")}
						rows={3}
						maxLength={2000}
						value={draft.bio}
						onChange={(event) => onChange("bio", event.target.value)}
					/>
				</FormField>
			</div>
		</>
	);
}
