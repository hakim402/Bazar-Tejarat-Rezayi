"use client";
import type { FormEvent } from "react";
import { Field, Input, Select } from "../../../components/ui/form-field";
import { Button } from "../../../components/ui/button";
import { organizationCopy } from "../../../lib/i18n/organizations";
import type { Locale } from "../../../lib/i18n/locales";
import { type Profile, profileFields } from "../api/organizations";
export function ProfileEditor({
	locale,
	context,
	profile,
	busy,
	errors = [],
	onSave,
}: {
	locale: Locale;
	context: string;
	profile?: Profile;
	busy: boolean;
	errors?: string[];
	onSave: (data: Record<string, unknown>) => Promise<unknown>;
}) {
	const t = organizationCopy[locale];
	function submit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const data = new FormData(e.currentTarget);
		const fields: Record<string, unknown> = {};
		for (const key of profileFields) fields[key] = String(data.get(key) ?? "");
		if (profile) fields.version = profile.version;
		else fields.kind = data.get("kind");
		void onSave(fields);
	}
	return (
		<form
			onSubmit={submit}
			className="grid grid-cols-1 gap-4 rounded-card border border-border bg-page p-5"
			aria-busy={busy}
		>
			{!profile && (
				<Field name="kind" label={t.profile}>
					<Select name="kind">
						{(context === "buyer"
							? ["business"]
							: ["individual", "company"]
						).map((kind) => (
							<option key={kind} value={kind}>
								{t[kind as "individual" | "company" | "business"]}
							</option>
						))}
					</Select>
				</Field>
			)}
			{profileFields.map((key) => (
				<Field key={key} name={key} label={t[key]}>
					<Input
						name={key}
						aria-invalid={errors.includes(key)}
						defaultValue={profile?.[key] ?? ""}
						maxLength={
							key === "location"
								? 500
								: key === "display_name"
									? 150
									: key === "contact_phone"
										? 40
										: 200
						}
						required={key === "display_name"}
						dir={key === "contact_phone" ? "ltr" : undefined}
					/>
				</Field>
			))}
			<Button type="submit" disabled={busy}>
				{profile ? t.save : t.create}
			</Button>
		</form>
	);
}
