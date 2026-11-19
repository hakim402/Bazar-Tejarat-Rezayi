"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { SettingsActions } from "../../../components/accounts/seller-settings-ui";
import { sellerAccountSettingsCopy } from "../../../lib/i18n/seller-account-settings";
import { sellerSettingsCopy } from "../../../lib/i18n/seller-settings";
import { Button as ShadcnButton } from "../../../components/shadcn/button";
import { Input } from "../../../components/shadcn/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "../../../components/shadcn/native-select";
import { FormActions, FormField } from "../../../components/ui/dialog-form";
import { Icon } from "../../../components/ui/icon";
import { organizationCopy } from "../../../lib/i18n/organizations";
import type { Locale } from "../../../lib/i18n/locales";
import { type Profile, profileFields } from "../api/organizations";
type Copy = (typeof organizationCopy)[Locale];
export const profileGroups: {
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
	singleCreationKind?: boolean;
	onDirtyChange?: (dirty: boolean) => void;
	onCancel?: () => void;
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
	const [values, setValues] = useState(
		() =>
			Object.fromEntries(
				profileFields.map((key) => [key, profile?.[key] ?? ""]),
			) as Record<(typeof profileFields)[number], string>,
	);
	const creationKinds =
		kinds ?? (context === "buyer" ? ["business"] : ["individual", "company"]);
	const [kind, setKind] = useState<string>(creationKinds[0]);
	function submit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const fields: Record<string, unknown> = { ...values };
		if (profile) fields.version = profile.version;
		else fields.kind = kind;
		void onSave(fields);
	}
	function field(key: (typeof profileFields)[number]) {
		const id = `org-profile-${key}`,
			invalid = errors.includes(key);
		return (
			<div
				key={key}
				className={key === "location" ? "sm:col-span-2" : undefined}
			>
				<FormField
					id={id}
					label={t[key]}
					required={key === "display_name"}
					error={invalid ? t.fields : undefined}
				>
					<Input
						id={id}
						name={key}
						value={values[key]}
						onChange={(event) =>
							setValues((current) => ({
								...current,
								[key]: event.target.value,
							}))
						}
						type={key === "contact_phone" ? "tel" : "text"}
						dir={key === "contact_phone" ? "ltr" : undefined}
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
						aria-invalid={invalid}
						aria-describedby={invalid ? `${id}-error` : undefined}
					/>
				</FormField>
			</div>
		);
	}
	return (
		<form onSubmit={submit} className="min-w-0 space-y-5" aria-busy={busy}>
			{profile ? (
				profileGroups.map((group) => (
					<section key={group.title} className="space-y-3">
						<div className="space-y-0.5">
							<h3 className="m-0 flex items-center gap-1.5 text-sm font-semibold">
								{group.help && (
									<Icon name="lock" className="size-3.5 text-muted" />
								)}
								{t[group.title]}
							</h3>
							{group.help && (
								<p className="m-0 text-xs text-muted">{t[group.help]}</p>
							)}
						</div>
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							{group.keys.map(field)}
						</div>
					</section>
				))
			) : (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<FormField id="org-profile-kind" label={t.profile}>
						<NativeSelect
							id="org-profile-kind"
							name="kind"
							value={kind}
							onChange={(event) => setKind(event.target.value)}
						>
							{creationKinds.map((value) => (
								<NativeSelectOption key={value} value={value}>
									{t[value]}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</FormField>
					{profileFields.map(field)}
				</div>
			)}
			<FormActions>
				<ShadcnButton type="submit" disabled={busy}>
					{profile ? t.save : t.create}
				</ShadcnButton>
			</FormActions>
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
	onCancel,
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
					{key === "display_name" && (
						<span aria-hidden="true" className="ms-1 text-danger">
							*
						</span>
					)}
				</label>
				<Input
					id={id}
					name={key}
					className="min-h-11 rounded-lg shadow-none"
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
		<form onSubmit={submit} className="grid min-w-0 gap-5" aria-busy={disabled}>
			{!profile && <input type="hidden" name="kind" value={creationKind} />}
			{failed && (
				<p role="alert" className="text-sm text-danger">
					{copy.fieldError}
				</p>
			)}
			{profileGroups.map((group) => (
				<fieldset
					key={group.title}
					className="m-0 min-w-0 space-y-3 border-0 border-t border-solid border-border px-0 pb-0 pt-3"
				>
					<legend className="pe-3 text-sm font-semibold">
						{t[group.title]}
					</legend>
					{group.help && (
						<p className="m-0 flex items-start gap-2 text-xs leading-relaxed text-muted">
							<Icon name="lock" className="mt-0.5 size-3.5 shrink-0" />
							{t[group.help]}
						</p>
					)}
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						{group.keys.map(field)}
					</div>
				</fieldset>
			))}
			<SettingsActions locale={locale} dirty={dirty}>
				{onCancel && (
					<ShadcnButton
						type="button"
						variant="outline"
						disabled={disabled}
						onClick={onCancel}
						className="min-h-11 rounded-lg"
					>
						{sellerSettingsCopy[locale].cancel}
					</ShadcnButton>
				)}
				<ShadcnButton
					type="submit"
					disabled={disabled}
					className="min-h-11 rounded-lg"
				>
					{profile ? t.save : t.create}
				</ShadcnButton>
			</SettingsActions>
		</form>
	);
}
