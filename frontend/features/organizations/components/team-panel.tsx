"use client";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type FormEvent,
} from "react";
import { BusinessDialog } from "../../../components/accounts/seller-settings-ui";
import { TabNav } from "../../../components/ui/tabs";
import type { SellerBusinessOptions } from "./seller-business-ui";
import { useSellerWorkflow } from "./workflow-state";
import { Button } from "../../../components/shadcn/button";
import { Checkbox } from "../../../components/shadcn/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../../../components/shadcn/dropdown-menu";
import { Input } from "../../../components/shadcn/input";
import { Label } from "../../../components/shadcn/label";
import {
	NativeSelect,
	NativeSelectOption,
} from "../../../components/shadcn/native-select";
import { DashboardCard } from "../../../components/ui/dashboard-card";
import { Icon } from "../../../components/ui/icon";
import {
	StatusBadge,
	statusVariant,
} from "../../../components/ui/status-badge";
import { organizationCopy, label } from "../../../lib/i18n/organizations";
import { sellerSettingsCopy } from "../../../lib/i18n/seller-settings";
import type { Locale } from "../../../lib/i18n/locales";
import { ConfirmDialog } from "../../orders/components/detail-dialog";
import {
	bundles,
	profilePath,
	type Member,
	type Profile,
	type Team,
} from "../api/organizations";
import { WorkflowState } from "./workflow-state";

type TeamPanelProps = {
	locale: Locale;
	context: string;
	profile: Profile;
	onChanged: () => void;
	sellerBusiness?: SellerBusinessOptions;
};
export function TeamPanel(props: TeamPanelProps) {
	return props.sellerBusiness && props.context === "seller" ? (
		<SellerTeamPanel {...props} sellerBusiness={props.sellerBusiness} />
	) : null;
}

function SellerBundles({
	locale,
	name = "bundles",
	values,
	onChange,
	id,
}: {
	locale: Locale;
	name?: string;
	values: string[];
	onChange: (values: string[]) => void;
	id: string;
}) {
	const t = organizationCopy[locale];
	return (
		<fieldset className="min-w-0 rounded-xl border border-border p-4">
			<legend className="px-1 text-sm font-semibold">
				{name === "retained_bundles" ? t.retained : t.bundles}
			</legend>
			<div className="grid gap-1 sm:grid-cols-2">
				{bundles.map((bundle) => (
					<div key={bundle} className="flex min-h-11 items-center gap-3">
						<Checkbox
							id={`${id}-${bundle}`}
							name={name}
							value={bundle}
							checked={values.includes(bundle)}
							onCheckedChange={(checked) =>
								onChange(
									checked === true
										? [...values, bundle]
										: values.filter((value) => value !== bundle),
								)
							}
							className="size-5"
						/>
						<Label
							htmlFor={`${id}-${bundle}`}
							className="flex-1 cursor-pointer text-sm leading-relaxed"
						>
							{t[bundle]}
						</Label>
					</div>
				))}
			</div>
		</fieldset>
	);
}
function SellerMember({
	item,
	locale,
	canManage,
	disabled,
	version,
	onAction,
	onDirty,
}: {
	item: Member;
	locale: Locale;
	canManage: boolean;
	disabled: boolean;
	version: number;
	onAction: (
		action: string,
		values?: string[],
		version?: number,
	) => Promise<boolean>;
	onDirty: (id: string, dirty: boolean) => void;
}) {
	const t = organizationCopy[locale];
	const [values, setValues] = useState(item.bundles);
	const [confirmRevoke, setConfirmRevoke] = useState(false);
	const [permissionsOpen, setPermissionsOpen] = useState(false);
	const baseline = useRef(item.bundles);
	const lastServerBundles = useRef(item.bundles);
	// A retained draft is checked against the profile version it was read from.
	const draftVersion = useRef(version);
	const dirty =
		values.slice().sort().join(",") !==
		baseline.current.slice().sort().join(",");
	useEffect(() => {
		onDirty(item.id, dirty);
	}, [item.id, dirty, onDirty]);
	useEffect(() => () => onDirty(item.id, false), [item.id, onDirty]);
	useEffect(() => {
		if (canManage && item.active && !item.is_owner) return;
		baseline.current = item.bundles;
		lastServerBundles.current = item.bundles;
		draftVersion.current = version;
		setValues(item.bundles);
		onDirty(item.id, false);
	}, [
		canManage,
		item.active,
		item.is_owner,
		item.id,
		item.bundles,
		onDirty,
		version,
	]);
	useEffect(() => {
		if (!dirty && item.bundles !== lastServerBundles.current) {
			lastServerBundles.current = item.bundles;
			baseline.current = item.bundles;
			draftVersion.current = version;
			setValues(item.bundles);
		}
	}, [item.bundles, dirty, version]);
	return (
		<li className="flex min-w-0 flex-wrap items-start gap-3 py-3">
			<span
				className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
					item.is_owner ? "bg-primary text-on-primary" : "bg-info text-action"
				}`}
				aria-hidden="true"
			>
				<Icon name={item.is_owner ? "crown" : "user"} className="size-5" />
			</span>
			<div className="min-w-0 flex-1">
				<p className="m-0 flex flex-wrap items-center gap-2 font-semibold">
					<span className="wrap-anywhere">
						<bdi>{item.name}</bdi>
					</span>
					<StatusBadge size="sm" variant={item.is_owner ? "accent" : "neutral"}>
						{item.is_owner ? t.owner : t.member}
					</StatusBadge>
					{!item.active && (
						<StatusBadge size="sm" variant="neutral">
							{t.inactive}
						</StatusBadge>
					)}
				</p>
				<p className="m-0 mt-1 text-sm text-muted">
					{item.bundles.map((value) => label(t, value)).join(" · ") || "—"}
				</p>
				{dirty && (
					<p className="m-0 mt-1 text-xs font-medium text-warning">
						{sellerSettingsCopy[locale].unsaved}
					</p>
				)}
			</div>
			{canManage && item.active && !item.is_owner && (
				<>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="size-11 shrink-0 rounded-lg text-muted"
								aria-label={t.actions}
								title={t.actions}
							>
								<Icon name="more-horizontal" className="size-5" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="min-w-48">
							<DropdownMenuItem onSelect={() => setPermissionsOpen(true)}>
								<Icon name="shield" />
								{t.permissions}
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								variant="destructive"
								onSelect={() => setConfirmRevoke(true)}
							>
								<Icon name="trash" />
								{t.revoke}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<BusinessDialog
						locale={locale}
						title={t.permissions}
						open={permissionsOpen}
						onOpenChange={setPermissionsOpen}
					>
						<form
							onSubmit={async (event) => {
								event.preventDefault();
								const submitted = new FormData(event.currentTarget)
									.getAll("bundles")
									.map(String);
								if (
									await onAction("permissions", submitted, draftVersion.current)
								) {
									baseline.current = submitted;
									setValues(submitted);
									onDirty(item.id, false);
									setPermissionsOpen(false);
								}
							}}
						>
							<fieldset disabled={disabled} className="min-w-0 space-y-4">
								<SellerBundles
									locale={locale}
									values={values}
									onChange={setValues}
									id={`member-${item.id}`}
								/>
								<Button type="submit" disabled={disabled} className="min-h-11">
									{t.permissions}
								</Button>
							</fieldset>
						</form>
					</BusinessDialog>
					<ConfirmDialog
						locale={locale}
						open={confirmRevoke}
						title={t.revoke}
						body={t.destructive}
						confirmLabel={t.revoke}
						destructive
						busy={disabled}
						onCancel={() => setConfirmRevoke(false)}
						onConfirm={() => {
							setConfirmRevoke(false);
							void onAction("revoke");
						}}
					/>
				</>
			)}
		</li>
	);
}
function SellerTeamPanel({
	locale,
	context,
	profile,
	sellerBusiness,
}: TeamPanelProps & { sellerBusiness: SellerBusinessOptions }) {
	const base = profilePath(context, profile.id);
	const state = useSellerWorkflow<Team>(`${base}team/`, locale, sellerBusiness);
	const t = organizationCopy[locale];
	const [tab, setTab] = useState("members");
	const [email, setEmail] = useState("");
	const [inviteBundles, setInviteBundles] = useState<string[]>([]);
	const [recipient, setRecipient] = useState("");
	const [retained, setRetained] = useState<string[]>([]);
	const [memberDrafts, setMemberDrafts] = useState<Record<string, boolean>>({});
	const [discarded, setDiscarded] = useState(0);
	const [inviteOpen, setInviteOpen] = useState(false);
	const [transferOpen, setTransferOpen] = useState(false);
	const [pending, setPending] = useState<{
		title: string;
		body: string;
		label: string;
		destructive?: boolean;
		run: () => void | Promise<void>;
	} | null>(null);
	const onMemberDirty = useCallback(
		(id: string, dirty: boolean) =>
			setMemberDrafts((values) =>
				values[id] === dirty ? values : { ...values, [id]: dirty },
			),
		[],
	);
	const callback = useRef(sellerBusiness.onDirtyChange);
	callback.current = sellerBusiness.onDirtyChange;
	const dirty =
		!!email ||
		!!inviteBundles.length ||
		!!recipient ||
		!!retained.length ||
		Object.values(memberDrafts).some(Boolean) ||
		state.busy;
	useEffect(() => {
		callback.current(dirty);
	}, [dirty]);
	useEffect(() => () => callback.current(false), []);
	useEffect(() => {
		if (!state.denied && profile.can_manage) return;
		setEmail("");
		setInviteBundles([]);
		setRecipient("");
		setRetained([]);
		setMemberDrafts({});
		setInviteOpen(false);
		setTransferOpen(false);
	}, [state.denied, profile.can_manage]);
	const disabled = state.busy || state.blocked || state.loading;
	// A confirmed reload discards every draft, not only this panel's inputs.
	function discard() {
		setEmail("");
		setInviteBundles([]);
		setRecipient("");
		setRetained([]);
		setMemberDrafts({});
		setInviteOpen(false);
		setTransferOpen(false);
		setDiscarded((epoch) => epoch + 1);
	}
	async function mutate(path: string, data: unknown) {
		return !!(await state.mutate(path, data));
	}
	async function invite(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		if (
			await mutate(`${base}invitations/`, {
				email: data.get("email"),
				bundles: data.getAll("bundles"),
				locale,
			})
		) {
			setEmail("");
			setInviteBundles([]);
			setInviteOpen(false);
		}
	}
	function transfer(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		const payload = {
			recipient: data.get("recipient"),
			retained_bundles: data.getAll("retained_bundles"),
		};
		setTransferOpen(false);
		setPending({
			title: t.requestTransfer,
			body: t.transferConfirm,
			label: t.requestTransfer,
			run: async () => {
				if (await mutate(`${base}transfers/`, payload)) {
					setRecipient("");
					setRetained([]);
				}
			},
		});
	}
	return (
		<section className="min-w-0 space-y-5" aria-label={t.team}>
			<WorkflowState
				locale={locale}
				state={{
					...state,
					refresh: () =>
						sellerBusiness.choose(() => {
							discard();
							void state.refresh();
						}),
				}}
			/>
			<TabNav
				locale={locale}
				aria-label={t.team}
				tabs={["members", "invitations", "transfers"].map((key) => ({
					label: t[key as "members" | "invitations" | "transfers"],
					active: tab === key,
					onClick: () => {
						if (tab !== key)
							sellerBusiness.choose(() => {
								if (tab === "invitations") {
									setEmail("");
									setInviteBundles([]);
									setInviteOpen(false);
								}
								if (tab === "transfers") {
									setRecipient("");
									setRetained([]);
									setTransferOpen(false);
								}
								setTab(key);
							});
					},
				}))}
			/>
			{state.data && (
				<>
					{tab === "members" && (
						<DashboardCard
							title={t.members}
							description={t.bundleHelp}
							icon="team"
						>
							<ul className="m-0 list-none divide-y divide-border p-0">
								{state.data.members.map((item) => (
									<SellerMember
										key={`${item.id}:${discarded}`}
										item={item}
										locale={locale}
										version={profile.version}
										canManage={profile.can_manage}
										disabled={disabled}
										onDirty={onMemberDirty}
										onAction={(action, values = [], memberVersion) =>
											mutate(`${base}members/${item.id}/`, {
												action,
												bundles: values,
												version: memberVersion ?? profile.version,
											})
										}
									/>
								))}
							</ul>
							{!state.data.members.length && (
								<p className="m-0 text-sm text-muted">{t.empty}</p>
							)}
							{profile.my_membership_id && (
								<div className="mt-4 border-t border-danger/30 pt-4">
									<Button
										variant="outline"
										className="min-h-11 text-danger"
										disabled={disabled}
										onClick={() =>
											setPending({
												title: t.leave,
												body: t.destructive,
												label: t.leave,
												destructive: true,
												run: () => {
													void mutate(
														`${base}members/${profile.my_membership_id}/`,
														{ action: "leave", version: profile.version },
													);
												},
											})
										}
									>
										<Icon name="logout" className="size-4" />
										{t.leave}
									</Button>
								</div>
							)}
						</DashboardCard>
					)}
					{tab === "invitations" && (
						<DashboardCard
							title={t.invitations}
							description={t.inviteHelp}
							icon="mail"
							action={
								profile.can_manage ? (
									<BusinessDialog
										locale={locale}
										title={t.invite}
										open={inviteOpen}
										busy={state.busy}
										onOpenChange={(open) => {
											if (open) setInviteOpen(true);
											else if (email || inviteBundles.length)
												sellerBusiness.choose(() => {
													setEmail("");
													setInviteBundles([]);
													setInviteOpen(false);
												});
											else setInviteOpen(false);
										}}
										trigger={
											<Button
												type="button"
												variant="outline"
												size="sm"
												className="min-h-11 sm:min-h-8"
											>
												<Icon name="plus" className="size-4" />
												{t.invite}
											</Button>
										}
									>
										<form onSubmit={invite} aria-busy={state.busy}>
											<fieldset
												disabled={disabled}
												className="min-w-0 space-y-4"
											>
												<div className="grid min-w-0 gap-2">
													<Label htmlFor="field-email" className="font-bold">
														{t.email}
													</Label>
													<Input
														id="field-email"
														name="email"
														type="email"
														dir="ltr"
														required
														value={email}
														onChange={(event) => setEmail(event.target.value)}
													/>
												</div>
												<SellerBundles
													locale={locale}
													values={inviteBundles}
													onChange={setInviteBundles}
													id="invitation"
												/>
												<p className="m-0 text-sm text-muted">{t.bundleHelp}</p>
												<Button
													type="submit"
													disabled={disabled}
													className="min-h-11"
												>
													{t.invite}
												</Button>
											</fieldset>
										</form>
									</BusinessDialog>
								) : undefined
							}
						>
							<ul className="m-0 list-none divide-y divide-border p-0">
								{state.data.invitations.map((item) => (
									<li
										key={item.id}
										className="flex min-w-0 flex-wrap items-center gap-3 py-3"
									>
										<span
											className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-info text-action"
											aria-hidden="true"
										>
											<Icon name="mail" className="size-4" />
										</span>
										<div className="min-w-0 flex-1">
											<p className="m-0 break-all font-semibold">
												<bdi>{item.email}</bdi>
											</p>
											<p className="m-0 mt-1 flex flex-wrap items-center gap-2">
												<StatusBadge
													size="sm"
													variant={statusVariant(item.status)}
												>
													{label(t, item.status)}
												</StatusBadge>
												<span className="text-xs text-muted">
													{label(t, item.delivery_status)}
												</span>
											</p>
											<p className="m-0 mt-1 text-xs text-muted">
												{item.bundles.map((key) => label(t, key)).join(" · ")}
											</p>
										</div>
										{["pending", "expired"].includes(item.status) && (
											<div className="flex shrink-0 flex-wrap gap-2">
												<Button
													variant="outline"
													size="sm"
													className="min-h-11 sm:min-h-8"
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
													variant="ghost"
													size="sm"
													className="min-h-11 text-danger sm:min-h-8"
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
								<p className="m-0 text-sm text-muted">{t.empty}</p>
							)}
						</DashboardCard>
					)}
					{tab === "transfers" && (
						<DashboardCard
							title={t.transfers}
							description={t.transferHelp}
							icon="handshake"
							action={
								profile.can_manage ? (
									<BusinessDialog
										locale={locale}
										title={t.requestTransfer}
										open={transferOpen}
										busy={state.busy}
										onOpenChange={(open) => {
											if (open) setTransferOpen(true);
											else if (recipient || retained.length)
												sellerBusiness.choose(() => {
													setRecipient("");
													setRetained([]);
													setTransferOpen(false);
												});
											else setTransferOpen(false);
										}}
										trigger={
											<Button
												type="button"
												variant="outline"
												size="sm"
												className="min-h-11 sm:min-h-8"
											>
												<Icon name="plus" className="size-4" />
												{t.requestTransfer}
											</Button>
										}
									>
										<form onSubmit={transfer} aria-busy={state.busy}>
											<fieldset
												disabled={disabled}
												className="min-w-0 space-y-4"
											>
												<div className="grid min-w-0 gap-2">
													<Label
														htmlFor="field-recipient"
														className="font-bold"
													>
														{t.recipient}
													</Label>
													<NativeSelect
														id="field-recipient"
														name="recipient"
														required
														value={recipient}
														onChange={(event) =>
															setRecipient(event.target.value)
														}
													>
														<NativeSelectOption value="">—</NativeSelectOption>
														{state.data.members
															.filter(
																(item) =>
																	item.active &&
																	item.eligible &&
																	!item.is_owner,
															)
															.map((item) => (
																<NativeSelectOption
																	key={item.id}
																	value={item.id}
																>
																	{item.name}
																</NativeSelectOption>
															))}
													</NativeSelect>
												</div>
												<SellerBundles
													locale={locale}
													name="retained_bundles"
													values={retained}
													onChange={setRetained}
													id="transfer"
												/>
												<Button
													type="submit"
													disabled={disabled}
													className="min-h-11"
												>
													{t.requestTransfer}
												</Button>
											</fieldset>
										</form>
									</BusinessDialog>
								) : undefined
							}
						>
							<ul className="m-0 list-none divide-y divide-border p-0">
								{state.data.transfers.map((item) => (
									<li
										key={item.id}
										className="flex min-w-0 flex-wrap items-start gap-3 py-3"
									>
										<span
											className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-info text-action"
											aria-hidden="true"
										>
											<Icon name="handshake" className="size-4" />
										</span>
										<div className="min-w-0 flex-1 space-y-1">
											<p className="m-0 flex flex-wrap items-center gap-2 font-semibold">
												<span className="wrap-anywhere">
													{item.recipient_name}
												</span>
												<StatusBadge
													size="sm"
													variant={statusVariant(item.status)}
												>
													{label(t, item.status)}
												</StatusBadge>
											</p>
											<p className="m-0 text-sm text-muted">
												{t.retained}:{" "}
												{item.retained_bundles
													.map((key) => label(t, key))
													.join(" · ") || "—"}
											</p>
											{item.reason && (
												<p className="m-0 text-sm break-words whitespace-pre-wrap">
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
														size="sm"
														className="min-h-11 sm:min-h-8"
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
														variant="outline"
														size="sm"
														className="min-h-11 sm:min-h-8"
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
								<p className="m-0 text-sm text-muted">{t.empty}</p>
							)}
						</DashboardCard>
					)}
				</>
			)}
			<ConfirmDialog
				locale={locale}
				open={!!pending}
				title={pending?.title ?? ""}
				body={pending?.body ?? ""}
				confirmLabel={pending?.label ?? ""}
				destructive={pending?.destructive}
				busy={disabled}
				onCancel={() => setPending(null)}
				onConfirm={() => {
					const action = pending;
					setPending(null);
					void action?.run();
				}}
			/>
		</section>
	);
}
