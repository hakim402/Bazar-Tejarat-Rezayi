"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	type FormEvent,
	type ReactNode,
} from "react";
import toast from "react-hot-toast";
import { LogOut, Pencil, Star, Trash2 } from "lucide-react";
import { Badge } from "../../../components/shadcn/badge";
import { Button } from "../../../components/shadcn/button";
import { Card } from "../../../components/shadcn/card";
import { Input } from "../../../components/shadcn/input";
import { Icon } from "../../../components/ui/icon";
import { GoogleButton } from "../../../components/authentication/google-entry";
import {
	DetailDialog,
	ConfirmDialog,
} from "../../orders/components/detail-dialog";
import { FormField } from "../../../components/ui/dialog-form";
import { PasswordDialog } from "./buyer-password";
import {
	emptyProfileDraft,
	profileDraft,
	ProfileFields,
	type ProfileDraft,
} from "./profile-fields";
import { BuyerRowMenu } from "../../orders/components/buyer-ui";
import { salesTableCard } from "../../sales/components/seller-sales-ui";
import { mediaUrl } from "../../marketplace/api";
import { buyerProfileCopy } from "../../../lib/i18n/buyer-profile";
import { authCopy } from "../../../lib/i18n/auth";
import { googleCopy } from "../../../lib/i18n/google";
import { languageNames, type Locale } from "../../../lib/i18n/locales";
import {
	ACCOUNT_SESSION_CHANGED,
	AccountError,
	authMutation,
} from "../api/accounts";
import {
	createAddress,
	deleteAddress,
	fetchProfile,
	listAddresses,
	removeAvatar,
	updateAddress,
	updateProfile,
	uploadAvatar,
	type Address,
	type AddressPayload,
	type Gender,
	type PreferredLocale,
	type ProfileIdentity,
} from "../api/profile";

function profileError(locale: Locale, error: unknown): string {
	const t = authCopy[locale];
	if (!(error instanceof AccountError)) return t.unavailable;
	if (error.status === 429) return t.limited;
	if (error.code === "csrf_failed") return t.stale;
	if (error.status === 401 || error.status === 403) return t.denied;
	if (error.status === 400) return t.invalid;
	return t.unavailable;
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
			<dt className="shrink-0 text-sm text-muted">{label}</dt>
			<dd className="m-0 wrap-anywhere text-sm font-medium sm:text-end">
				{value}
			</dd>
		</div>
	);
}

function SecurityRow({
	icon,
	title,
	help,
	children,
	onClick,
	href,
	disabled = false,
	last = false,
}: {
	icon: ReactNode;
	title: string;
	help?: ReactNode;
	children?: ReactNode;
	onClick?: () => void;
	href?: string;
	disabled?: boolean;
	last?: boolean;
}) {
	const interactive = !!onClick || !!href;
	const content = (
		<>
			<span className="flex min-w-0 flex-1 basis-56 items-center gap-3">
				<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-page text-muted">
					{icon}
				</span>
				<span className="min-w-0">
					<span className="block text-sm font-medium">{title}</span>
					{help && (
						<span className="block wrap-anywhere text-xs text-muted">
							{help}
						</span>
					)}
				</span>
			</span>
			{children && <span className="shrink-0">{children}</span>}
			{interactive && (
				<Icon
					name="chevron"
					className="size-4 shrink-0 text-muted rtl:-scale-x-100"
				/>
			)}
		</>
	);
	const rowClass = `flex w-full flex-wrap items-center gap-y-3 border-0 border-b border-solid border-border px-4 py-4 text-start sm:px-5 ${last ? "border-b-0" : ""}`;
	if (href)
		return (
			<Link
				href={href}
				className={`${rowClass} text-foreground no-underline transition-colors hover:bg-info focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action motion-reduce:transition-none`}
			>
				{content}
			</Link>
		);
	if (onClick)
		return (
			<button
				type="button"
				onClick={onClick}
				disabled={disabled}
				className={`${rowClass} cursor-pointer bg-transparent transition-colors hover:bg-info focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action disabled:cursor-not-allowed disabled:opacity-65 motion-reduce:transition-none`}
			>
				{content}
			</button>
		);
	return <div className={rowClass}>{content}</div>;
}

function PhotoDialog({
	locale,
	identity,
	open,
	onOpenChange,
	onSaved,
	trigger,
}: {
	locale: Locale;
	identity: ProfileIdentity | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved: (identity: ProfileIdentity) => void;
	trigger?: ReactNode;
}) {
	const t = buyerProfileCopy[locale],
		a = authCopy[locale];
	const [file, setFile] = useState<File | null>(null),
		[preview, setPreview] = useState<string | null>(null),
		[busy, setBusy] = useState(false),
		[error, setError] = useState("");
	useEffect(() => {
		if (open) {
			setFile(null);
			setPreview(null);
			setError("");
		}
	}, [open]);
	useEffect(
		() => () => {
			if (preview) URL.revokeObjectURL(preview);
		},
		[preview],
	);
	function choose(next: File | null) {
		if (preview) URL.revokeObjectURL(preview);
		setFile(next);
		setPreview(next ? URL.createObjectURL(next) : null);
		setError("");
	}
	async function upload() {
		if (!file || busy) return;
		setBusy(true);
		setError("");
		try {
			onSaved(await uploadAvatar("buyer", file));
			toast.success(t.photoSaved);
			onOpenChange(false);
		} catch (err) {
			const message = profileError(locale, err);
			setError(message);
			toast.error(message);
		} finally {
			setBusy(false);
		}
	}
	async function remove() {
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			onSaved(await removeAvatar("buyer"));
			toast.success(t.photoRemoved);
			onOpenChange(false);
		} catch (err) {
			const message = profileError(locale, err);
			setError(message);
			toast.error(message);
		} finally {
			setBusy(false);
		}
	}
	const current = identity?.avatar ? mediaUrl(identity.avatar.url) : null;
	const shown = preview ?? current;
	return (
		<DetailDialog
			locale={locale}
			title={t.photo}
			icon="image"
			label={t.changePhoto}
			triggerVariant="outline"
			trigger={trigger}
			inline
			open={open}
			onOpenChange={onOpenChange}
			footer={
				<>
					{identity?.avatar && (
						<Button
							type="button"
							variant="outline"
							onClick={remove}
							disabled={busy}
						>
							{t.removePhoto}
						</Button>
					)}
					<Button type="button" onClick={upload} disabled={!file || busy}>
						{busy ? a.saving : t.uploadPhoto}
					</Button>
				</>
			}
		>
			<div className="flex flex-col items-center gap-4">
				<div className="size-28 overflow-hidden rounded-full border border-border bg-page">
					{shown ? (
						// biome-ignore lint/performance/noImgElement: private avatar bytes are served with credentials; next/image cannot optimize them.
						<img
							src={shown}
							alt={t.photoPreview}
							className="size-full object-cover"
						/>
					) : (
						<div className="flex size-full items-center justify-center text-muted">
							<Icon name="user-circle" className="size-12" />
						</div>
					)}
				</div>
				<input
					type="file"
					aria-label={t.changePhoto}
					accept="image/jpeg,image/png,image/webp"
					onChange={(event) => choose(event.target.files?.[0] ?? null)}
					className="w-full max-w-xs cursor-pointer rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted file:me-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-info file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-action"
				/>
				<p className="text-center text-xs text-muted">{t.photoHelp}</p>
				{error && (
					<p role="alert" className="text-sm text-danger">
						{error}
					</p>
				)}
			</div>
		</DetailDialog>
	);
}

function DetailsDialog({
	locale,
	identity,
	open,
	onOpenChange,
	onSaved,
}: {
	locale: Locale;
	identity: ProfileIdentity | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved: (identity: ProfileIdentity) => void;
}) {
	const t = buyerProfileCopy[locale],
		a = authCopy[locale];
	const base = useId(),
		formId = `${base}-form`;
	const [draft, setDraft] = useState<ProfileDraft>({ ...emptyProfileDraft });
	const [busy, setBusy] = useState(false),
		[error, setError] = useState("");
	useEffect(() => {
		if (open && identity) {
			setDraft(profileDraft(identity));
			setError("");
		}
	}, [open, identity]);
	const set = (key: keyof ProfileDraft, value: string) =>
		setDraft((current) => ({ ...current, [key]: value }));
	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy) return;
		if (!draft.display_name.trim()) {
			setError(a.invalid);
			return;
		}
		setBusy(true);
		setError("");
		try {
			const result = await updateProfile("buyer", {
				display_name: draft.display_name,
				first_name: draft.first_name,
				last_name: draft.last_name,
				phone: draft.phone,
				bio: draft.bio,
				gender: draft.gender as Gender,
				date_of_birth: draft.date_of_birth || null,
				preferred_locale: draft.preferred_locale as PreferredLocale,
			});
			onSaved(result);
			toast.success(t.saved);
			onOpenChange(false);
		} catch (err) {
			const message = profileError(locale, err);
			setError(message);
			toast.error(message);
		} finally {
			setBusy(false);
		}
	}
	return (
		<DetailDialog
			locale={locale}
			title={t.editProfile}
			icon="user-circle"
			label={t.editDetails}
			description={t.personalDetailsHelp}
			triggerVariant="outline"
			wide
			open={open}
			onOpenChange={onOpenChange}
			footer={
				<>
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={busy}
					>
						{t.cancel}
					</Button>
					<Button type="submit" form={formId} disabled={busy}>
						{busy ? a.saving : t.save}
					</Button>
				</>
			}
		>
			<form id={formId} onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
				{error && (
					<p
						role="alert"
						className="rounded-lg border border-danger bg-danger-surface px-3 py-2 text-sm text-danger sm:col-span-2"
					>
						{error}
					</p>
				)}
				<ProfileFields
					locale={locale}
					idPrefix={base}
					draft={draft}
					onChange={set}
				/>
			</form>
		</DetailDialog>
	);
}

type AddressDraft = {
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
const emptyAddress: AddressDraft = {
	label: "",
	recipient_name: "",
	phone: "",
	province: "",
	city: "",
	area: "",
	street_address: "",
	landmark: "",
	is_default: false,
};

function AddressDialog({
	locale,
	open,
	mode,
	address,
	onClose,
	onTrigger,
	onSaved,
}: {
	locale: Locale;
	open: boolean;
	mode: "add" | "edit";
	address: Address | null;
	onClose: () => void;
	onTrigger: () => void;
	onSaved: () => void;
}) {
	const t = buyerProfileCopy[locale],
		a = authCopy[locale];
	const base = useId(),
		formId = `${base}-form`;
	const [draft, setDraft] = useState<AddressDraft>({ ...emptyAddress });
	const [busy, setBusy] = useState(false),
		[error, setError] = useState("");
	useEffect(() => {
		if (!open) return;
		setDraft(
			mode === "edit" && address
				? {
						label: address.label,
						recipient_name: address.recipient_name,
						phone: address.phone,
						province: address.province,
						city: address.city,
						area: address.area,
						street_address: address.street_address,
						landmark: address.landmark,
						is_default: address.is_default,
					}
				: { ...emptyAddress },
		);
		setError("");
	}, [open, mode, address]);
	const set = (key: keyof AddressDraft, value: string | boolean) =>
		setDraft((current) => ({ ...current, [key]: value }) as AddressDraft);
	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy) return;
		if (!draft.recipient_name.trim() || !draft.street_address.trim()) {
			setError(t.addressRequired);
			return;
		}
		setBusy(true);
		setError("");
		try {
			const payload: AddressPayload = { ...draft };
			if (mode === "edit" && address)
				await updateAddress("buyer", address.id, payload);
			else await createAddress("buyer", payload);
			onSaved();
			toast.success(t.addressSaved);
			onClose();
		} catch (err) {
			const message = profileError(locale, err);
			setError(message);
			toast.error(message);
		} finally {
			setBusy(false);
		}
	}
	return (
		<DetailDialog
			locale={locale}
			title={mode === "edit" ? t.editAddress : t.addAddress}
			icon="map-pin"
			label={t.addAddress}
			description={t.addressesHelp}
			triggerVariant="default"
			wide
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
			onTrigger={onTrigger}
			footer={
				<>
					<Button
						type="button"
						variant="outline"
						onClick={onClose}
						disabled={busy}
					>
						{t.cancel}
					</Button>
					<Button type="submit" form={formId} disabled={busy}>
						{busy ? a.saving : t.save}
					</Button>
				</>
			}
		>
			<form id={formId} onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
				{error && (
					<p
						role="alert"
						className="rounded-lg border border-danger bg-danger-surface px-3 py-2 text-sm text-danger sm:col-span-2"
					>
						{error}
					</p>
				)}
				<FormField
					id={`${base}-label`}
					label={t.addressLabel}
					optional={t.optional}
					help={t.addressLabelHelp}
				>
					<Input
						id={`${base}-label`}
						value={draft.label}
						maxLength={80}
						onChange={(event) => set("label", event.target.value)}
					/>
				</FormField>
				<FormField id={`${base}-recipient`} label={t.recipientName} required>
					<Input
						id={`${base}-recipient`}
						value={draft.recipient_name}
						maxLength={150}
						required
						autoComplete="name"
						onChange={(event) => set("recipient_name", event.target.value)}
					/>
				</FormField>
				<FormField
					id={`${base}-phone`}
					label={t.addressPhone}
					optional={t.optional}
				>
					<Input
						id={`${base}-phone`}
						type="tel"
						dir="ltr"
						value={draft.phone}
						maxLength={40}
						autoComplete="tel"
						onChange={(event) => set("phone", event.target.value)}
					/>
				</FormField>
				<FormField
					id={`${base}-province`}
					label={t.province}
					optional={t.optional}
				>
					<Input
						id={`${base}-province`}
						value={draft.province}
						maxLength={120}
						autoComplete="address-level1"
						onChange={(event) => set("province", event.target.value)}
					/>
				</FormField>
				<FormField id={`${base}-city`} label={t.city} optional={t.optional}>
					<Input
						id={`${base}-city`}
						value={draft.city}
						maxLength={120}
						autoComplete="address-level2"
						onChange={(event) => set("city", event.target.value)}
					/>
				</FormField>
				<FormField id={`${base}-area`} label={t.area} optional={t.optional}>
					<Input
						id={`${base}-area`}
						value={draft.area}
						maxLength={120}
						onChange={(event) => set("area", event.target.value)}
					/>
				</FormField>
				<div className="sm:col-span-2">
					<FormField id={`${base}-street`} label={t.streetAddress} required>
						<Input
							id={`${base}-street`}
							value={draft.street_address}
							maxLength={400}
							required
							autoComplete="street-address"
							onChange={(event) => set("street_address", event.target.value)}
						/>
					</FormField>
				</div>
				<div className="sm:col-span-2">
					<FormField
						id={`${base}-landmark`}
						label={t.landmark}
						optional={t.optional}
					>
						<Input
							id={`${base}-landmark`}
							value={draft.landmark}
							maxLength={200}
							onChange={(event) => set("landmark", event.target.value)}
						/>
					</FormField>
				</div>
				<label className="flex cursor-pointer items-center gap-2 text-sm font-medium sm:col-span-2">
					<input
						type="checkbox"
						checked={draft.is_default}
						onChange={(event) => set("is_default", event.target.checked)}
						className="size-4 shrink-0"
					/>
					{t.setAsDefault}
				</label>
			</form>
		</DetailDialog>
	);
}

function AddressRow({
	locale,
	address,
	busy,
	onEdit,
	onDefault,
	onDelete,
}: {
	locale: Locale;
	address: Address;
	busy: boolean;
	onEdit: () => void;
	onDefault: () => void;
	onDelete: () => void;
}) {
	const t = buyerProfileCopy[locale];
	const separator = locale === "en" ? ", " : "، ";
	const line = [
		address.province,
		address.city,
		address.area,
		address.street_address,
	]
		.filter(Boolean)
		.join(separator);
	return (
		<li className="flex items-start gap-3 px-4 py-4 sm:px-5">
			<span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-info text-action">
				<Icon name="map-pin" className="size-4" />
			</span>
			<div className="min-w-0 flex-1 space-y-1">
				<div className="flex flex-wrap items-center gap-2">
					<p className="m-0 text-sm font-semibold">
						{address.label || address.recipient_name}
					</p>
					{address.is_default && (
						<Badge variant="secondary" className="border-0 bg-info text-action">
							{t.default}
						</Badge>
					)}
				</div>
				<p className="m-0 wrap-anywhere text-sm text-muted">
					{address.recipient_name}
					{line ? ` — ${line}` : ""}
				</p>
				{address.phone && (
					<p className="m-0 text-xs text-muted">
						<bdi dir="ltr">{address.phone}</bdi>
					</p>
				)}
			</div>
			<BuyerRowMenu
				locale={locale}
				label={t.menu}
				links={[]}
				actions={[
					{ label: t.editAddress, Icon: Pencil, onSelect: onEdit },
					{
						label: t.setDefault,
						Icon: Star,
						onSelect: onDefault,
						disabled: address.is_default || busy,
					},
					{
						label: t.deleteAddress,
						Icon: Trash2,
						onSelect: onDelete,
						disabled: busy,
					},
				]}
			/>
		</li>
	);
}

export function BuyerProfile({ locale }: { locale: Locale }) {
	const t = buyerProfileCopy[locale],
		a = authCopy[locale];
	const router = useRouter();
	const mounted = useRef(true);
	const [identity, setIdentity] = useState<ProfileIdentity | null>(null),
		[addresses, setAddresses] = useState<Address[]>([]),
		[loading, setLoading] = useState(true),
		[loadError, setLoadError] = useState(""),
		[busy, setBusy] = useState(false);
	const [photoOpen, setPhotoOpen] = useState(false),
		[detailsOpen, setDetailsOpen] = useState(false),
		[passwordOpen, setPasswordOpen] = useState(false),
		[googleOpen, setGoogleOpen] = useState(false),
		[addressDialog, setAddressDialog] = useState<{
			mode: "add" | "edit";
			address: Address | null;
		} | null>(null),
		[deleteTarget, setDeleteTarget] = useState<Address | null>(null),
		[signOutTarget, setSignOutTarget] = useState<"single" | "all" | null>(null);

	const refresh = useCallback(async () => {
		try {
			const [profile, list] = await Promise.all([
				fetchProfile("buyer"),
				listAddresses("buyer"),
			]);
			if (!mounted.current) return;
			setIdentity(profile);
			setAddresses(list);
			setLoadError("");
		} catch (err) {
			if (!mounted.current) return;
			setIdentity(null);
			setLoadError(
				err instanceof AccountError &&
					(err.status === 401 || err.status === 403)
					? a.anonymous
					: a.unavailable,
			);
		} finally {
			if (mounted.current) setLoading(false);
		}
	}, [a]);

	const reloadAddresses = useCallback(async () => {
		try {
			const list = await listAddresses("buyer");
			if (mounted.current) setAddresses(list);
		} catch {
			/* keep the current list on a transient read failure */
		}
	}, []);

	useEffect(() => {
		mounted.current = true;
		const load = () => {
			if (mounted.current) void refresh();
		};
		load();
		window.addEventListener("focus", load);
		window.addEventListener(ACCOUNT_SESSION_CHANGED, load);
		return () => {
			mounted.current = false;
			window.removeEventListener("focus", load);
			window.removeEventListener(ACCOUNT_SESSION_CHANGED, load);
		};
	}, [refresh]);

	async function makeDefault(address: Address) {
		if (busy) return;
		setBusy(true);
		try {
			await updateAddress("buyer", address.id, { is_default: true });
			await reloadAddresses();
			toast.success(t.defaultUpdated);
		} catch (err) {
			toast.error(profileError(locale, err));
		} finally {
			if (mounted.current) setBusy(false);
		}
	}

	async function confirmDelete() {
		if (!deleteTarget || busy) return;
		setBusy(true);
		try {
			await deleteAddress("buyer", deleteTarget.id);
			if (mounted.current)
				setAddresses((list) =>
					list.filter((item) => item.id !== deleteTarget.id),
				);
			toast.success(t.addressDeleted);
			setDeleteTarget(null);
		} catch (err) {
			toast.error(profileError(locale, err));
		} finally {
			if (mounted.current) setBusy(false);
		}
	}

	async function confirmSignOut() {
		if (!signOutTarget || busy) return;
		setBusy(true);
		try {
			await authMutation(
				signOutTarget === "all" ? "logout-all/" : "buyer/logout/",
			);
			toast.success(t.signedOut);
			router.push(`/${locale}/auth/buyer-sign-in`);
		} catch (err) {
			toast.error(profileError(locale, err));
			if (mounted.current) setBusy(false);
		}
	}

	const genderLabels: Record<string, string> = {
		male: t.genderMale,
		female: t.genderFemale,
		other: t.genderOther,
		prefer_not_to_say: t.genderPreferNot,
	};
	const fullName = identity
		? [identity.first_name, identity.last_name].filter(Boolean).join(" ")
		: "";
	const memberSince = identity
		? t.memberSince.replace(
				"{date}",
				new Intl.DateTimeFormat(locale, {
					year: "numeric",
					month: "long",
					day: "numeric",
				}).format(new Date(identity.date_joined)),
			)
		: "";
	const birthDate = identity?.date_of_birth
		? new Intl.DateTimeFormat(locale, {
				year: "numeric",
				month: "long",
				day: "numeric",
			}).format(new Date(`${identity.date_of_birth}T00:00:00`))
		: "";
	const languageLabel =
		identity?.preferred_locale && identity.preferred_locale in languageNames
			? languageNames[identity.preferred_locale as Locale]
			: "";
	const avatarUrl = identity?.avatar ? mediaUrl(identity.avatar.url) : null;
	const verified = identity?.email_verified;
	const empty = <span className="font-normal text-muted">{t.notAdded}</span>;

	return (
		<div className="min-w-0 space-y-6">
			<header className="space-y-1">
				<h1 className="m-0 text-xl font-semibold tracking-tight">{t.title}</h1>
				<p className="m-0 text-sm text-muted">{t.subtitle}</p>
			</header>

			{loading && (
				<p role="status" className="text-sm text-muted">
					{a.loading}
				</p>
			)}
			{loadError && (
				<div
					role="alert"
					className="rounded-xl border border-danger bg-danger-surface px-4 py-3 text-sm text-danger"
				>
					{loadError}
				</div>
			)}

			{identity && (
				<>
					<Card className={salesTableCard}>
						<div className="flex flex-col items-center gap-3 border-0 border-b border-solid border-border px-4 py-6 text-center sm:px-5">
							<PhotoDialog
								locale={locale}
								identity={identity}
								open={photoOpen}
								onOpenChange={setPhotoOpen}
								onSaved={setIdentity}
								trigger={
									<button
										type="button"
										onClick={() => setPhotoOpen(true)}
										aria-label={t.changePhoto}
										title={t.changePhoto}
										className="group relative size-24 shrink-0 cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
									>
										<span className="block size-full overflow-hidden rounded-full border border-border bg-page transition-colors group-hover:border-action motion-reduce:transition-none">
											{avatarUrl ? (
												// biome-ignore lint/performance/noImgElement: private avatar bytes are served with credentials; next/image cannot optimize them.
												<img
													src={avatarUrl}
													alt={t.photo}
													className="size-full object-cover"
												/>
											) : (
												<span className="flex size-full items-center justify-center text-muted">
													<Icon name="user-circle" className="size-12" />
												</span>
											)}
										</span>
										<span className="absolute bottom-0 end-0 flex size-7 items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors group-hover:text-action motion-reduce:transition-none">
											<Icon name="image" className="size-3.5" />
										</span>
									</button>
								}
							/>
							<div className="space-y-1">
								<div className="flex flex-wrap items-center justify-center gap-2">
									<h2 className="m-0 text-lg font-semibold">
										<bdi>{identity.display_name}</bdi>
									</h2>
									<Badge
										variant="secondary"
										className={
											verified
												? "border-0 bg-success-surface text-success"
												: "border-0 bg-warning-surface text-warning"
										}
									>
										{verified ? a.verifiedLabel : t.notVerified}
									</Badge>
								</div>
								<p className="m-0 text-sm text-muted">
									<bdi dir="ltr">{identity.email}</bdi>
								</p>
								<p className="m-0 text-xs text-muted">{memberSince}</p>
							</div>
						</div>
						<div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-border px-4 py-4 sm:px-5">
							<div className="min-w-0">
								<h3 className="m-0 text-base font-semibold">
									{t.personalDetails}
								</h3>
								<p className="m-0 text-xs text-muted">
									{t.personalDetailsHelp}
								</p>
							</div>
							<DetailsDialog
								locale={locale}
								identity={identity}
								open={detailsOpen}
								onOpenChange={setDetailsOpen}
								onSaved={setIdentity}
							/>
						</div>
						<dl className="m-0 divide-y divide-border px-4 sm:px-5">
							<DetailRow label={t.fullName} value={fullName || empty} />
							<DetailRow
								label={t.displayName}
								value={<bdi>{identity.display_name}</bdi>}
							/>
							<DetailRow
								label={t.phone}
								value={
									identity.phone ? <bdi dir="ltr">{identity.phone}</bdi> : empty
								}
							/>
							<DetailRow
								label={t.gender}
								value={genderLabels[identity.gender] || empty}
							/>
							<DetailRow label={t.dateOfBirth} value={birthDate || empty} />
							<DetailRow
								label={t.preferredLanguage}
								value={languageLabel || empty}
							/>
							<DetailRow label={t.bio} value={identity.bio || empty} />
						</dl>
					</Card>

					<div className="grid items-start gap-6 lg:grid-cols-2">
						<Card className={salesTableCard}>
							<div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-border px-4 py-4 sm:px-5">
								<div className="min-w-0">
									<div className="flex flex-wrap items-center gap-2">
										<h2 className="m-0 text-base font-semibold">
											{t.addresses}
										</h2>
										<Badge
											variant="secondary"
											className="rounded-full border-0 bg-page text-muted"
										>
											{new Intl.NumberFormat(locale).format(addresses.length)}
										</Badge>
									</div>
									<p className="m-0 text-xs text-muted">{t.addressesHelp}</p>
								</div>
								<AddressDialog
									locale={locale}
									open={addressDialog !== null}
									mode={addressDialog?.mode ?? "add"}
									address={addressDialog?.address ?? null}
									onClose={() => setAddressDialog(null)}
									onTrigger={() =>
										setAddressDialog({ mode: "add", address: null })
									}
									onSaved={() => void reloadAddresses()}
								/>
							</div>
							{addresses.length === 0 ? (
								<div className="px-4 py-10 text-center sm:px-5">
									<p className="m-0 text-sm text-muted">{t.noAddresses}</p>
								</div>
							) : (
								<ul className="m-0 list-none divide-y divide-border p-0">
									{addresses.map((address) => (
										<AddressRow
											key={address.id}
											locale={locale}
											address={address}
											busy={busy}
											onEdit={() => setAddressDialog({ mode: "edit", address })}
											onDefault={() => void makeDefault(address)}
											onDelete={() => setDeleteTarget(address)}
										/>
									))}
								</ul>
							)}
						</Card>

						<Card className={salesTableCard}>
							<div className="border-0 border-b border-solid border-border px-4 py-4 sm:px-5">
								<h2 className="m-0 text-base font-semibold">{t.security}</h2>
								<p className="m-0 text-xs text-muted">{t.securityHelp}</p>
							</div>
							<div>
								<SecurityRow
									icon={<Icon name="mail" className="size-4" />}
									title={a.email}
									help={<bdi dir="ltr">{identity.email}</bdi>}
								>
									<Badge
										variant="secondary"
										className={
											verified
												? "border-0 bg-success-surface text-success"
												: "border-0 bg-warning-surface text-warning"
										}
									>
										{verified ? a.verifiedLabel : t.notVerified}
									</Badge>
								</SecurityRow>
								<PasswordDialog
									locale={locale}
									open={passwordOpen}
									onOpenChange={setPasswordOpen}
									trigger={
										<SecurityRow
											icon={<Icon name="shield-lock" className="size-4" />}
											title={a.password}
											help={t.passwordRowHelp}
											onClick={() => setPasswordOpen(true)}
										/>
									}
								/>
								<DetailDialog
									locale={locale}
									title={t.connectGoogle}
									icon="link"
									label={t.connectGoogle}
									description={googleCopy[locale].link}
									open={googleOpen}
									onOpenChange={setGoogleOpen}
									trigger={
										<SecurityRow
											icon={<Icon name="link" className="size-4" />}
											title={t.googleAccount}
											help={t.googleRowHelp}
											onClick={() => setGoogleOpen(true)}
										/>
									}
								>
									<GoogleButton
										locale={locale}
										context="buyer"
										sourceContext="buyer"
										action="link"
										compact
										embedded
									/>
								</DetailDialog>
								<SecurityRow
									icon={<Icon name="gear" className="size-4" />}
									title={t.accountSettings}
									help={t.settingsRowHelp}
									href={`/${locale}/account/buyer/settings`}
								/>
								<SecurityRow
									icon={<LogOut className="size-4" />}
									title={t.signOut}
									help={t.signOutHelp}
									disabled={busy}
									onClick={() => setSignOutTarget("single")}
								/>
								<SecurityRow
									icon={<Icon name="monitor" className="size-4" />}
									title={t.signOutAll}
									help={t.signOutAllHelp}
									disabled={busy}
									last
									onClick={() => setSignOutTarget("all")}
								/>
							</div>
						</Card>
					</div>
				</>
			)}

			{!loading && !identity && (
				<div className="flex flex-wrap gap-3">
					<Button asChild variant="secondary">
						<Link href={`/${locale}/auth/buyer-sign-in`}>{a.backSignin}</Link>
					</Button>
					<Button
						type="button"
						variant="outline"
						onClick={() => void refresh()}
					>
						{a.retry}
					</Button>
				</div>
			)}

			<ConfirmDialog
				locale={locale}
				open={deleteTarget !== null}
				title={t.deleteTitle}
				body={t.deleteBody}
				confirmLabel={t.delete}
				destructive
				busy={busy}
				onCancel={() => setDeleteTarget(null)}
				onConfirm={() => void confirmDelete()}
			/>
			<ConfirmDialog
				locale={locale}
				open={signOutTarget !== null}
				title={signOutTarget === "all" ? t.signOutAllTitle : t.signOutTitle}
				body={signOutTarget === "all" ? t.signOutAllBody : t.signOutBody}
				confirmLabel={t.signOut}
				busy={busy}
				onCancel={() => setSignOutTarget(null)}
				onConfirm={() => void confirmSignOut()}
			/>
		</div>
	);
}
