"use client";
import { useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import { Button } from "../../../components/shadcn/button";
import { Card } from "../../../components/shadcn/card";
import { Input } from "../../../components/shadcn/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "../../../components/shadcn/native-select";
import { Alert } from "../../../components/ui/alert";
import { FormActions, FormField } from "../../../components/ui/dialog-form";
import { Icon } from "../../../components/ui/icon";
import {
	StatusBadge,
	statusVariant,
} from "../../../components/ui/status-badge";
import { TabNav } from "../../../components/ui/tabs";
import { organizationCopy, label } from "../../../lib/i18n/organizations";
import type { Locale } from "../../../lib/i18n/locales";
import { cn } from "../../../lib/shadcn-utils";
import {
	ConfirmDialog,
	DetailDialog,
} from "../../orders/components/detail-dialog";
import { salesTableCard } from "../../sales/components/seller-sales-ui";
import {
	bundles,
	profilePath,
	type Member,
	type Profile,
	type Team,
} from "../api/organizations";
import { useWorkflow, WorkflowState } from "./workflow-state";

function BundleChecks({
	locale,
	id,
	name = "bundles",
	values,
	onChange,
	retained = false,
}: {
	locale: Locale;
	id: string;
	name?: string;
	values: string[];
	onChange: (values: string[]) => void;
	retained?: boolean;
}) {
	const t = organizationCopy[locale];
	return (
		<fieldset className="m-0 min-w-0 border-0 p-0">
			<legend className="mb-2 text-sm font-medium">
				{retained ? t.retained : t.bundles}
			</legend>
			<div className="grid gap-2 sm:grid-cols-2">
				{bundles.map((bundle) => {
					const checked = values.includes(bundle);
					return (
						<label
							key={bundle}
							htmlFor={`${id}-${bundle}`}
							className={cn(
								"flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-solid px-3 py-2 text-sm transition-colors motion-reduce:transition-none",
								checked
									? "border-action bg-info"
									: "border-border hover:bg-info/50",
							)}
						>
							<input
								id={`${id}-${bundle}`}
								type="checkbox"
								name={name}
								value={bundle}
								checked={checked}
								onChange={(event) =>
									onChange(
										event.target.checked
											? [...values, bundle]
											: values.filter((value) => value !== bundle),
									)
								}
								className="size-4 shrink-0 accent-action"
							/>
							<span className="min-w-0">{t[bundle]}</span>
						</label>
					);
				})}
			</div>
		</fieldset>
	);
}

type Confirmation =
	| { kind: "revoke"; id: string }
	| { kind: "leave" }
	| { kind: "transfer" };

// Buyer team workspace: flat member/invitation/transfer rows with every
// form and destructive step in a dialog instead of inline disclosures.
export function BuyerTeamPanel({
	locale,
	profile,
	onChanged,
}: {
	locale: Locale;
	profile: Profile;
	onChanged: () => void;
}) {
	const base = profilePath("buyer", profile.id);
	const state = useWorkflow<Team>(`${base}team/`, locale);
	const t = organizationCopy[locale];
	const [tab, setTab] = useState("members");
	const [inviteOpen, setInviteOpen] = useState(false);
	const [email, setEmail] = useState("");
	const [inviteBundles, setInviteBundles] = useState<string[]>([]);
	const [transferOpen, setTransferOpen] = useState(false);
	const [recipient, setRecipient] = useState("");
	const [retained, setRetained] = useState<string[]>([]);
	const [member, setMember] = useState<Member | null>(null);
	const [memberBundles, setMemberBundles] = useState<string[]>([]);
	const [confirm, setConfirm] = useState<Confirmation | null>(null);
	const disabled = state.busy || state.loading;
	const recipients =
		state.data?.members.filter(
			(item) => item.active && item.eligible && !item.is_owner,
		) ?? [];
	async function mutate(path: string, data: unknown) {
		const ok = await state.mutate(path, data);
		if (ok) {
			toast.success(t.saved);
			onChanged();
		}
		return ok;
	}
	async function savePermissions(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!member) return;
		if (
			await mutate(`${base}members/${member.id}/`, {
				action: "permissions",
				bundles: memberBundles,
				version: profile.version,
			})
		)
			setMember(null);
	}
	async function invite(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (
			await mutate(`${base}invitations/`, {
				email,
				bundles: inviteBundles,
				locale,
			})
		) {
			setEmail("");
			setInviteBundles([]);
			setInviteOpen(false);
		}
	}
	async function requestTransfer() {
		if (
			await mutate(`${base}transfers/`, {
				recipient,
				retained_bundles: retained,
			})
		) {
			setRecipient("");
			setRetained([]);
			setTransferOpen(false);
		}
		setConfirm(null);
	}
	function confirmMembership() {
		if (!confirm || confirm.kind === "transfer") return;
		const id = confirm.kind === "leave" ? profile.my_membership_id : confirm.id;
		if (!id) return;
		void mutate(`${base}members/${id}/`, {
			action: confirm.kind,
			bundles: [],
			version: profile.version,
		}).then(() => setConfirm(null));
	}
	const confirmTitle =
		confirm?.kind === "transfer"
			? t.requestTransfer
			: confirm?.kind === "leave"
				? t.leave
				: t.revoke;
	return (
		<section className="min-w-0 space-y-4" aria-label={t.team}>
			<WorkflowState state={{ ...state, notice: "" }} locale={locale} />
			<div className="flex flex-wrap items-center justify-between gap-2">
				<TabNav
					locale={locale}
					aria-label={t.team}
					tabs={["members", "invitations", "transfers"].map((key) => ({
						label: t[key as "members" | "invitations" | "transfers"],
						active: tab === key,
						onClick: () => setTab(key),
					}))}
				/>
				{tab === "invitations" && profile.can_manage && (
					<Button
						type="button"
						size="sm"
						className="gap-2"
						disabled={disabled}
						onClick={() => setInviteOpen(true)}
					>
						<Icon name="plus" className="size-3.5" />
						{t.invite}
					</Button>
				)}
				{tab === "transfers" && profile.can_manage && (
					<Button
						type="button"
						size="sm"
						className="gap-2"
						disabled={disabled}
						onClick={() => setTransferOpen(true)}
					>
						<Icon name="team" className="size-3.5" />
						{t.requestTransfer}
					</Button>
				)}
			</div>
			{state.data && tab === "members" && (
				<Card className={salesTableCard}>
					<ul className="m-0 list-none divide-y divide-border p-0">
						{state.data.members.map((item) => (
							<li
								key={item.id}
								className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
							>
								<div className="min-w-0 flex-1 space-y-1">
									<p className="m-0 flex flex-wrap items-center gap-2 text-sm font-medium">
										<bdi className="break-words">{item.name}</bdi>
										<StatusBadge
											size="sm"
											dot={false}
											variant={item.is_owner ? "accent" : "neutral"}
										>
											{item.is_owner ? t.owner : t.member}
										</StatusBadge>
										{!item.active && (
											<StatusBadge size="sm" dot={false} variant="danger">
												{t.inactive}
											</StatusBadge>
										)}
									</p>
									<p className="m-0 text-xs text-muted">
										{item.bundles.map((key) => label(t, key)).join(" · ") ||
											"—"}
									</p>
								</div>
								{profile.can_manage && item.active && !item.is_owner && (
									<div className="flex shrink-0 flex-wrap gap-2">
										<Button
											type="button"
											variant="outline"
											size="sm"
											disabled={disabled}
											onClick={() => {
												setMember(item);
												setMemberBundles(item.bundles);
											}}
										>
											{t.permissions}
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="text-danger hover:bg-danger-surface hover:text-danger"
											disabled={disabled}
											onClick={() =>
												setConfirm({ kind: "revoke", id: item.id })
											}
										>
											{t.revoke}
										</Button>
									</div>
								)}
							</li>
						))}
					</ul>
					{!state.data.members.length && (
						<p className="m-0 px-4 py-4 text-sm text-muted sm:px-5">
							{t.empty}
						</p>
					)}
					{profile.my_membership_id && (
						<div className="border-0 border-t border-solid border-border px-4 py-3 sm:px-5">
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="text-danger hover:bg-danger-surface hover:text-danger"
								disabled={disabled}
								onClick={() => setConfirm({ kind: "leave" })}
							>
								{t.leave}
							</Button>
						</div>
					)}
				</Card>
			)}
			{state.data && tab === "invitations" && (
				<Card className={salesTableCard}>
					<ul className="m-0 list-none divide-y divide-border p-0">
						{state.data.invitations.map((item) => (
							<li
								key={item.id}
								className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
							>
								<div className="min-w-0 flex-1 space-y-1">
									<p className="m-0 break-all text-sm font-medium">
										<bdi>{item.email}</bdi>
									</p>
									<p className="m-0 flex flex-wrap items-center gap-2">
										<StatusBadge size="sm" variant={statusVariant(item.status)}>
											{label(t, item.status)}
										</StatusBadge>
										<StatusBadge
											size="sm"
											variant={statusVariant(item.delivery_status)}
										>
											{label(t, item.delivery_status)}
										</StatusBadge>
									</p>
									<p className="m-0 text-xs text-muted">
										{item.bundles.map((key) => label(t, key)).join(" · ")}
									</p>
								</div>
								{["pending", "expired"].includes(item.status) && (
									<div className="flex shrink-0 flex-wrap gap-2">
										<Button
											type="button"
											variant="outline"
											size="sm"
											disabled={disabled}
											onClick={() =>
												mutate(`${base}invitations/${item.id}/`, {
													action: "resend",
													version: item.version,
												})
											}
										>
											{t.resend}
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											disabled={disabled}
											onClick={() =>
												mutate(`${base}invitations/${item.id}/`, {
													action: "cancel",
													version: item.version,
												})
											}
										>
											{t.cancel}
										</Button>
									</div>
								)}
							</li>
						))}
					</ul>
					{!state.data.invitations.length && (
						<p className="m-0 px-4 py-4 text-sm text-muted sm:px-5">
							{t.empty}
						</p>
					)}
				</Card>
			)}
			{state.data && tab === "transfers" && (
				<Card className={salesTableCard}>
					<ul className="m-0 list-none divide-y divide-border p-0">
						{state.data.transfers.map((item) => (
							<li
								key={item.id}
								className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
							>
								<div className="min-w-0 flex-1 space-y-1">
									<p className="m-0 flex flex-wrap items-center gap-2 text-sm font-medium">
										<span className="break-words">{item.recipient_name}</span>
										<StatusBadge size="sm" variant={statusVariant(item.status)}>
											{label(t, item.status)}
										</StatusBadge>
									</p>
									<p className="m-0 text-xs text-muted">
										{t.retained}:{" "}
										{item.retained_bundles
											.map((key) => label(t, key))
											.join(" · ") || "—"}
									</p>
									{item.reason && (
										<p className="m-0 break-words text-xs whitespace-pre-wrap">
											{item.reason}
										</p>
									)}
								</div>
								<div className="flex shrink-0 flex-wrap gap-2">
									{item.status === "pending" &&
										state.data?.members.some(
											(member) =>
												member.id === item.recipient_id &&
												member.id === profile.my_membership_id,
										) && (
											<Button
												type="button"
												size="sm"
												disabled={disabled}
												onClick={() =>
													mutate(`${base}transfers/${item.id}/`, {
														action: "accept",
														version: item.version,
													})
												}
											>
												{t.acceptTransfer}
											</Button>
										)}
									{profile.can_manage &&
										["pending", "accepted"].includes(item.status) && (
											<Button
												type="button"
												variant="outline"
												size="sm"
												disabled={disabled}
												onClick={() =>
													mutate(`${base}transfers/${item.id}/`, {
														action: "cancel",
														version: item.version,
													})
												}
											>
												{t.cancel}
											</Button>
										)}
								</div>
							</li>
						))}
					</ul>
					{!state.data.transfers.length && (
						<p className="m-0 px-4 py-4 text-sm text-muted sm:px-5">
							{t.empty}
						</p>
					)}
				</Card>
			)}
			<DetailDialog
				locale={locale}
				title={t.permissions}
				icon="shield"
				label={t.permissions}
				description={member?.name}
				open={!!member}
				onOpenChange={(next) => {
					if (!next) setMember(null);
				}}
				trigger={<span />}
			>
				{member && (
					<form
						onSubmit={savePermissions}
						className="space-y-4"
						aria-busy={state.busy}
					>
						{state.error && (
							<Alert role="alert" className="m-0 text-sm">
								{state.error}
							</Alert>
						)}
						<BundleChecks
							locale={locale}
							id={`org-member-${member.id}`}
							values={memberBundles}
							onChange={setMemberBundles}
						/>
						<p className="m-0 text-xs text-muted">{t.bundleHelp}</p>
						<FormActions>
							<Button type="submit" disabled={disabled}>
								{t.permissions}
							</Button>
						</FormActions>
					</form>
				)}
			</DetailDialog>
			<DetailDialog
				locale={locale}
				title={t.invite}
				icon="mail"
				label={t.invite}
				description={t.inviteHelp}
				open={inviteOpen}
				onOpenChange={setInviteOpen}
				trigger={<span />}
			>
				<form onSubmit={invite} className="space-y-4" aria-busy={state.busy}>
					{state.error && (
						<Alert role="alert" className="m-0 text-sm">
							{state.error}
						</Alert>
					)}
					<FormField
						id="org-invite-email"
						label={t.email}
						required
						error={state.fields.includes("email") ? t.fields : undefined}
					>
						<Input
							id="org-invite-email"
							name="email"
							type="email"
							dir="ltr"
							required
							maxLength={254}
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							aria-invalid={state.fields.includes("email")}
						/>
					</FormField>
					<BundleChecks
						locale={locale}
						id="org-invite"
						values={inviteBundles}
						onChange={setInviteBundles}
					/>
					<p className="m-0 text-xs text-muted">{t.bundleHelp}</p>
					<FormActions>
						<Button type="submit" disabled={disabled}>
							{t.invite}
						</Button>
					</FormActions>
				</form>
			</DetailDialog>
			<DetailDialog
				locale={locale}
				title={t.requestTransfer}
				icon="team"
				label={t.requestTransfer}
				description={t.transferHelp}
				open={transferOpen}
				onOpenChange={setTransferOpen}
				trigger={<span />}
			>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						setConfirm({ kind: "transfer" });
					}}
					className="space-y-4"
					aria-busy={state.busy}
				>
					{state.error && (
						<Alert role="alert" className="m-0 text-sm">
							{state.error}
						</Alert>
					)}
					<FormField
						id="org-transfer-recipient"
						label={t.recipient}
						required
						error={state.fields.includes("recipient") ? t.fields : undefined}
					>
						<NativeSelect
							id="org-transfer-recipient"
							name="recipient"
							required
							value={recipient}
							onChange={(event) => setRecipient(event.target.value)}
						>
							<NativeSelectOption value="">—</NativeSelectOption>
							{recipients.map((item) => (
								<NativeSelectOption key={item.id} value={item.id}>
									{item.name}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</FormField>
					<BundleChecks
						locale={locale}
						id="org-transfer"
						name="retained_bundles"
						retained
						values={retained}
						onChange={setRetained}
					/>
					<FormActions>
						<Button type="submit" disabled={disabled}>
							{t.requestTransfer}
						</Button>
					</FormActions>
				</form>
			</DetailDialog>
			<ConfirmDialog
				locale={locale}
				open={!!confirm}
				title={confirmTitle}
				body={confirm?.kind === "transfer" ? t.transferConfirm : t.destructive}
				confirmLabel={confirmTitle}
				destructive={confirm?.kind !== "transfer"}
				busy={state.busy}
				onCancel={() => setConfirm(null)}
				onConfirm={() => {
					if (confirm?.kind === "transfer") void requestTransfer();
					else confirmMembership();
				}}
			/>
		</section>
	);
}
