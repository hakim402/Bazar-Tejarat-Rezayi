"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
	SettingsSection,
	SettingsActions,
	settingsControl,
} from "../../../components/accounts/seller-settings-ui";
import { sellerAccountSettingsCopy } from "../../../lib/i18n/seller-account-settings";
import { Field, Input, Select } from "../../../components/ui/form-field";
import { Button } from "../../../components/ui/button";
import { SectionCard } from "../../../components/ui/section-card";
import { StickyActionBar } from "../../../components/ui/sticky-action-bar";
import { Icon } from "../../../components/ui/icon";
import { organizationCopy } from "../../../lib/i18n/organizations";
import type { Locale } from "../../../lib/i18n/locales";
import { type Profile, profileFields } from "../api/organizations";
type Copy = (typeof organizationCopy)[Locale];
const groups: {
	title: keyof Copy;
	help?: keyof Copy;
	keys: readonly (typeof profileFields)[number][];
}[] = [
	{ title: "publicInfo", keys: ["display_name", "business_type"] },
	{ title: "legalInfo", keys: ["legal_name", "representative"] },
	{
		title: "privateInfo",
		help: "privateInfoHelp",
		keys: ["contact_phone", "location"],
	},
];
type ProfileEditorProps = {
	locale: Locale;
	context: string;
	profile?: Profile;
	kinds?: ("individual" | "company" | "business")[];
	busy: boolean;
	errors?: string[];
	onSave: (data: Record<string, unknown>) => Promise<unknown>;
	sellerSettings?: boolean;
	sellerBusiness?: boolean;
	// Deliberate single-kind creation; Settings keeps its company default.
	singleCreationKind?: boolean;
	onDirtyChange?: (dirty: boolean) => void;
};
export function ProfileEditor(props: ProfileEditorProps) {
	if (
		(props.sellerSettings || props.sellerBusiness) &&
		props.context === "seller"
	)
		return (
			<SellerProfileEditor
				key={`${props.locale}:${props.context}:${props.profile?.id ?? "new"}`}
				{...props}
			/>
		);
	return <DefaultProfileEditor {...props} />;
}
function DefaultProfileEditor({
	locale,
	context,
	profile,
	kinds,
	busy,
	errors = [],
	onSave,
}: {
	locale: Locale;
	context: string;
	profile?: Profile;
	kinds?: ("individual" | "company" | "business")[];
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
	function field(key: (typeof profileFields)[number]) {
		return (
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
		);
	}
	return (
		<form onSubmit={submit} className="min-w-0 space-y-5" aria-busy={busy}>
			{profile ? (
				groups.map((group) => (
					<SectionCard
						key={group.title}
						title={t[group.title]}
						description={group.help ? t[group.help] : undefined}
						icon={
							group.help && (
								<Icon name="lock" className="size-4 shrink-0 text-muted" />
							)
						}
					>
						<div className="grid grid-cols-1 gap-4 desktop:grid-cols-2">
							{group.keys.map(field)}
						</div>
					</SectionCard>
				))
			) : (
				<SectionCard>
					<div className="grid grid-cols-1 gap-4 desktop:grid-cols-2">
						<Field name="kind" label={t.profile}>
							<Select name="kind">
								{(
									kinds ??
									(context === "buyer"
										? ["business"]
										: ["individual", "company"])
								).map((kind) => (
									<option key={kind} value={kind}>
										{t[kind as "individual" | "company" | "business"]}
									</option>
								))}
							</Select>
						</Field>
						{profileFields.map(field)}
					</div>
				</SectionCard>
			)}
			{profile ? (
				<StickyActionBar>
					<Button type="submit" disabled={busy}>
						{t.save}
					</Button>
				</StickyActionBar>
			) : (
				<Button type="submit" disabled={busy}>
					{t.create}
				</Button>
			)}
		</form>
	);
}

function SellerProfileEditor({
	locale,
	profile,
	busy,
	errors = [],
	onSave,
	onDirtyChange,
	kinds,
	singleCreationKind,
	sellerBusiness,
}: ProfileEditorProps) {
	const creationKind = singleCreationKind
		? (kinds?.[0] ?? "company")
		: "company";
	const draftVersion = useRef(profile?.version);
	const t = organizationCopy[locale],
		copy = sellerAccountSettingsCopy[locale];
	const initial = Object.fromEntries(
		profileFields.map((key) => [key, profile?.[key] ?? ""]),
	) as Record<(typeof profileFields)[number], string>;
	const [values, setValues] = useState(initial),
		[saving, setSaving] = useState(false),
		[failed, setFailed] = useState(false);
	const baseline = useRef(initial),
		live = useRef<object | null>(null),
		write = useRef<object | null>(null);
	const dirtyCallback = useRef(onDirtyChange);
	dirtyCallback.current = onDirtyChange;
	const dirty = profileFields.some(
		(key) => values[key] !== baseline.current[key],
	);
	useEffect(() => {
		onDirtyChange?.(dirty || (!!sellerBusiness && saving));
	}, [dirty, sellerBusiness, saving, onDirtyChange]);
	useEffect(() => {
		live.current = {};
		return () => {
			live.current = null;
			write.current = null;
			dirtyCallback.current?.(false);
		};
	}, []);
	useEffect(() => {
		if (
			!sellerBusiness ||
			!profile ||
			dirty ||
			saving ||
			write.current ||
			profile.version === draftVersion.current
		)
			return;
		const next = Object.fromEntries(
			profileFields.map((key) => [key, profile[key] ?? ""]),
		) as typeof values;
		baseline.current = next;
		draftVersion.current = profile.version;
		setValues((current) =>
			profileFields.every((key) => current[key] === next[key]) ? current : next,
		);
	}, [sellerBusiness, profile, dirty, saving]);
	const disabled = busy || saving;
	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || write.current || !live.current) return;
		const owner = {},
			life = live.current,
			submitted = { ...values };
		write.current = owner;
		setSaving(true);
		setFailed(false);
		try {
			const result = await onSave({
				...submitted,
				...(profile
					? { version: sellerBusiness ? draftVersion.current : profile.version }
					: { kind: creationKind }),
			});
			if (live.current !== life || write.current !== owner) return;
			// Only an explicit successful save owns resetting this draft.
			if (result === true) {
				const next = profile
					? submitted
					: (Object.fromEntries(
							profileFields.map((key) => [key, ""]),
						) as typeof values);
				baseline.current = next;
				setValues(next);
				dirtyCallback.current?.(false);
			}
		} catch {
			if (live.current === life && write.current === owner) setFailed(true);
		} finally {
			if (live.current === life && write.current === owner) {
				write.current = null;
				setSaving(false);
			}
		}
	}
	function field(key: (typeof profileFields)[number]) {
		const id = `seller-company-${key}`,
			invalid = errors.includes(key);
		return (
			<div className="min-w-0 space-y-2" key={key}>
				<label htmlFor={id} className="block text-sm font-semibold">
					{t[key]}
				</label>
				<input
					id={id}
					name={key}
					className={settingsControl}
					value={values[key]}
					onChange={(event) =>
						setValues((current) => ({ ...current, [key]: event.target.value }))
					}
					type={key === "contact_phone" ? "tel" : "text"}
					dir={key === "contact_phone" ? "ltr" : undefined}
					maxLength={
						key === "location"
							? 500
							: key === "contact_phone"
								? 40
								: key === "display_name" || key === "business_type"
									? 150
									: 200
					}
					required={key === "display_name"}
					disabled={disabled}
					aria-invalid={invalid}
					aria-describedby={invalid ? `${id}-error` : undefined}
				/>
				{invalid && (
					<p id={`${id}-error`} role="alert" className="text-sm text-danger">
						{copy.fieldError}
					</p>
				)}
			</div>
		);
	}
	return (
		<form onSubmit={submit} className="min-w-0 space-y-5" aria-busy={disabled}>
			{!profile && (
				<div className="space-y-2">
					<input type="hidden" name="kind" value={creationKind} />
					<p className="text-sm font-semibold">
						{t.profile}: {t[creationKind]}
					</p>
					{creationKind === "company" && (
						<p className="text-sm leading-relaxed text-muted">
							{copy.companyHelp}
						</p>
					)}
				</div>
			)}
			{failed && (
				<p role="alert" className="text-sm text-danger">
					{copy.fieldError}
				</p>
			)}
			{groups.map((group) => (
				<SettingsSection
					key={group.title}
					title={t[group.title]}
					description={group.help ? t[group.help] : undefined}
					icon={group.help ? "lock" : undefined}
				>
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						{group.keys.map(field)}
					</div>
				</SettingsSection>
			))}
			<SettingsActions locale={locale} dirty={dirty}>
				<Button type="submit" disabled={disabled}>
					{profile ? t.save : t.create}
				</Button>
			</SettingsActions>
		</form>
	);
}
