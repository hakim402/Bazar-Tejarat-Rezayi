"use client";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type FormEvent,
} from "react";
import { SettingsSection } from "../../../components/accounts/seller-settings-ui";
import { TabNav } from "../../../components/ui/tabs";
import type { SellerBusinessOptions } from "./seller-business-ui";
import { useSellerWorkflow } from "./workflow-state";
import { Button } from "../../../components/ui/button";
import {
	CheckField,
	Field,
	Input,
	Select,
} from "../../../components/ui/form-field";
import { organizationCopy, label } from "../../../lib/i18n/organizations";
import type { Locale } from "../../../lib/i18n/locales";
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
					<CheckField
						key={bundle}
						id={`${id}-${bundle}`}
						name={name}
						value={bundle}
						label={t[bundle]}
						checked={values.includes(bundle)}
						onChange={(event) =>
							onChange(
								event.target.checked
									? [...values, bundle]
									: values.filter((value) => value !== bundle),
							)
						}
					/>
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
		<li className="min-w-0 rounded-xl border border-border p-4 sm:p-5">
			<h3 className="break-words font-semibold">
				{item.name} · {item.is_owner ? t.owner : t.member}
				{!item.active && ` · ${t.inactive}`}
			</h3>
			<p className="my-3 text-sm text-muted">
				{item.bundles.map((value) => label(t, value)).join(" · ") || "—"}
			</p>
			{canManage && item.active && !item.is_owner && (
				<details>
					<summary className="min-h-11 cursor-pointer py-3 font-semibold">
						{t.permissions}
					</summary>
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
							<Button type="submit" disabled={disabled}>
								{t.permissions}
							</Button>
						</fieldset>
					</form>
					<div className="mt-5 border-t border-danger/30 pt-4">
						<Button
							variant="secondary"
							className="text-danger"
							disabled={disabled}
							onClick={() => {
								if (window.confirm(t.destructive)) void onAction("revoke");
							}}
						>
							{t.revoke}
						</Button>
					</div>
				</details>
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
	}, [state.denied, profile.can_manage]);
	const disabled = state.busy || state.blocked || state.loading;
	// A confirmed reload discards every draft, not only this panel's inputs.
	function discard() {
		setEmail("");
		setInviteBundles([]);
		setRecipient("");
		setRetained([]);
		setMemberDrafts({});
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
		}
	}
	async function transfer(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!window.confirm(t.transferConfirm)) return;
		const data = new FormData(event.currentTarget);
		if (
			await mutate(`${base}transfers/`, {
				recipient: data.get("recipient"),
				retained_bundles: data.getAll("retained_bundles"),
			})
		) {
			setRecipient("");
			setRetained([]);
		}
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
								}
								if (tab === "transfers") {
									setRecipient("");
									setRetained([]);
								}
								setTab(key);
							});
					},
				}))}
			/>
			{state.data && (
				<>
					{tab === "members" && (
						<SettingsSection title={t.members} description={t.bundleHelp}>
							<ul className="m-0 grid list-none gap-4 p-0">
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
								<p className="text-muted">{t.empty}</p>
							)}
							{profile.my_membership_id && (
								<div className="border-t border-danger/30 pt-5">
									<Button
										variant="secondary"
										className="text-danger"
										disabled={disabled}
										onClick={() => {
											if (window.confirm(t.destructive))
												void mutate(
													`${base}members/${profile.my_membership_id}/`,
													{ action: "leave", version: profile.version },
												);
										}}
									>
										{t.leave}
									</Button>
								</div>
							)}
						</SettingsSection>
					)}
					{tab === "invitations" && (
						<SettingsSection title={t.invitations} description={t.inviteHelp}>
							{profile.can_manage && (
								<form onSubmit={invite} aria-busy={state.busy}>
									<fieldset disabled={disabled} className="min-w-0 space-y-4">
										<legend className="font-semibold">{t.invite}</legend>
										<Field name="email" label={t.email}>
											<Input
												name="email"
												type="email"
												dir="ltr"
												required
												value={email}
												onChange={(event) => setEmail(event.target.value)}
											/>
										</Field>
										<SellerBundles
											locale={locale}
											values={inviteBundles}
											onChange={setInviteBundles}
											id="invitation"
										/>
										<p className="text-sm text-muted">{t.bundleHelp}</p>
										<Button type="submit" disabled={disabled}>
											{t.invite}
										</Button>
									</fieldset>
								</form>
							)}
							<ul className="m-0 grid list-none gap-4 p-0">
								{state.data.invitations.map((item) => (
									<li
										key={item.id}
										className="min-w-0 space-y-3 rounded-xl border border-border p-4"
									>
										<p className="break-all font-semibold">
											<bdi>{item.email}</bdi>
										</p>
										<p>
											{label(t, item.status)} · {label(t, item.delivery_status)}
										</p>
										<p className="text-sm text-muted">
											{item.bundles.map((key) => label(t, key)).join(" · ")}
										</p>
										{["pending", "expired"].includes(item.status) && (
											<div className="flex flex-wrap gap-3">
												{["resend", "cancel"].map((action) => (
													<Button
														key={action}
														variant="secondary"
														disabled={disabled}
														onClick={() =>
															mutate(`${base}invitations/${item.id}/`, {
																action,
																version: item.version,
															})
														}
													>
														{t[action as "resend" | "cancel"]}
													</Button>
												))}
											</div>
										)}
									</li>
								))}
							</ul>
							{!state.data.invitations.length && (
								<p className="text-muted">{t.empty}</p>
							)}
						</SettingsSection>
					)}
					{tab === "transfers" && (
						<SettingsSection title={t.transfers} description={t.transferHelp}>
							{profile.can_manage && (
								<form onSubmit={transfer} aria-busy={state.busy}>
									<fieldset disabled={disabled} className="min-w-0 space-y-4">
										<legend className="font-semibold">
											{t.requestTransfer}
										</legend>
										<Field name="recipient" label={t.recipient}>
											<Select
												name="recipient"
												required
												value={recipient}
												onChange={(event) => setRecipient(event.target.value)}
											>
												<option value="">—</option>
												{state.data.members
													.filter(
														(item) =>
															item.active && item.eligible && !item.is_owner,
													)
													.map((item) => (
														<option key={item.id} value={item.id}>
															{item.name}
														</option>
													))}
											</Select>
										</Field>
										<SellerBundles
											locale={locale}
											name="retained_bundles"
											values={retained}
											onChange={setRetained}
											id="transfer"
										/>
										<div className="border-t border-danger/30 pt-4">
											<Button type="submit" disabled={disabled}>
												{t.requestTransfer}
											</Button>
										</div>
									</fieldset>
								</form>
							)}
							<ul className="m-0 grid list-none gap-4 p-0">
								{state.data.transfers.map((item) => (
									<li
										key={item.id}
										className="min-w-0 space-y-3 rounded-xl border border-border p-4"
									>
										<h3 className="break-words font-semibold">
											{item.recipient_name}
										</h3>
										<p>{label(t, item.status)}</p>
										<p className="text-sm text-muted">
											{t.retained}:{" "}
											{item.retained_bundles
												.map((key) => label(t, key))
												.join(" · ") || "—"}
										</p>
										{item.reason && (
											<p className="break-words whitespace-pre-wrap">
												{item.reason}
											</p>
										)}
										<div className="flex flex-wrap gap-3">
											{item.status === "pending" &&
												state.data?.members.some(
													(member) =>
														member.id === item.recipient_id &&
														member.id === profile.my_membership_id,
												) && (
													<Button
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
														variant="secondary"
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
								<p className="text-muted">{t.empty}</p>
							)}
						</SettingsSection>
					)}
				</>
			)}
		</section>
	);
}
