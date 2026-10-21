"use client";
import { useState, type FormEvent } from "react";
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
import { useWorkflow, WorkflowState } from "./workflow-state";

export function BundlePicker({
	locale,
	name = "bundles",
	defaults = [],
	disabled = false,
}: {
	locale: Locale;
	name?: string;
	defaults?: string[];
	disabled?: boolean;
}) {
	const t = organizationCopy[locale];
	return (
		<fieldset className="my-3 min-w-0 rounded-control border border-border p-3">
			<legend className="font-bold">
				{name === "retained_bundles" ? t.retained : t.bundles}
			</legend>
			{bundles.map((bundle) => (
				<CheckField
					key={bundle}
					name={name}
					value={bundle}
					label={t[bundle]}
					defaultChecked={defaults.includes(bundle)}
					disabled={disabled}
				/>
			))}
		</fieldset>
	);
}
function MemberRow({
	item,
	locale,
	canManage,
	busy,
	onAction,
}: {
	item: Member;
	locale: Locale;
	canManage: boolean;
	busy: boolean;
	onAction: (action: string, bundles?: string[]) => void;
}) {
	const t = organizationCopy[locale];
	return (
		<li className="rounded-card border border-border p-4">
			<h4 className="break-words font-bold">
				{item.name} · {item.is_owner ? t.owner : t.member}{" "}
				{!item.active && `· ${t.inactive}`}
			</h4>
			<ul className="list-none p-0 my-3 text-muted">
				{item.bundles.map((bundle) => (
					<li key={bundle}>{label(t, bundle)}</li>
				))}
			</ul>
			{canManage && item.active && !item.is_owner && (
				<details>
					<summary className="cursor-pointer py-3 font-bold">
						{t.permissions}
					</summary>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							onAction(
								"permissions",
								new FormData(e.currentTarget).getAll("bundles").map(String),
							);
						}}
					>
						<BundlePicker
							key={item.bundles.join(",")}
							locale={locale}
							defaults={item.bundles}
						/>
						<div className="flex flex-wrap gap-3">
							<Button type="submit" disabled={busy}>
								{t.permissions}
							</Button>
							<Button
								variant="secondary"
								type="button"
								disabled={busy}
								onClick={() => {
									if (window.confirm(t.destructive)) onAction("revoke");
								}}
							>
								{t.revoke}
							</Button>
						</div>
					</form>
				</details>
			)}
		</li>
	);
}
export function TeamPanel({
	locale,
	context,
	profile,
	onChanged,
}: {
	locale: Locale;
	context: string;
	profile: Profile;
	onChanged: () => void;
}) {
	const base = profilePath(context, profile.id);
	const state = useWorkflow<Team>(`${base}team/`, locale);
	const t = organizationCopy[locale];
	const [tab, setTab] = useState("members");
	async function refreshTeam() {
		await Promise.all([state.refresh(), onChanged()]);
	}
	async function mutate(path: string, data: unknown) {
		if (await state.mutate(path, data)) onChanged();
	}
	async function invite(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = e.currentTarget;
		const data = new FormData(form);
		if (
			await state.mutate(`${base}invitations/`, {
				email: data.get("email"),
				bundles: data.getAll("bundles"),
				locale,
			})
		)
			form.reset();
	}
	async function transfer(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (!window.confirm(t.transferConfirm)) return;
		const data = new FormData(e.currentTarget);
		await mutate(`${base}transfers/`, {
			recipient: data.get("recipient"),
			retained_bundles: data.getAll("retained_bundles"),
		});
	}
	return (
		<section className="mt-6" aria-label={t.team}>
			<h2 className="text-2xl font-bold">{t.team}</h2>
			<WorkflowState
				state={{ ...state, refresh: refreshTeam }}
				locale={locale}
			/>
			<nav className="my-4 flex flex-wrap gap-3">
				{["members", "invitations", "transfers"].map((key) => (
					<Button
						key={key}
						variant={tab === key ? "primary" : "secondary"}
						onClick={() => {
							setTab(key);
							void refreshTeam();
						}}
					>
						{t[key as "members" | "invitations" | "transfers"]}
					</Button>
				))}
			</nav>
			{state.data && (
				<>
					{tab === "members" && (
						<>
							<ul className="list-none p-0 flex flex-col gap-4">
								{state.data.members.map((item) => (
									<MemberRow
										key={item.id}
										item={item}
										locale={locale}
										canManage={profile.can_manage}
										busy={state.busy}
										onAction={(action, bundles = []) =>
											mutate(`${base}members/${item.id}/`, {
												action,
												bundles,
												version: profile.version,
											})
										}
									/>
								))}
							</ul>
							{profile.my_membership_id && (
								<Button
									className="mt-5"
									variant="secondary"
									disabled={state.busy}
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
							)}
						</>
					)}
					{tab === "invitations" && (
						<>
							{profile.can_manage && (
								<form className="my-4 flex flex-col gap-3" onSubmit={invite}>
									<h3 className="text-xl font-bold">{t.invite}</h3>
									<p>{t.inviteHelp}</p>
									<Field name="email" label={t.email}>
										<Input name="email" type="email" required dir="ltr" />
									</Field>
									<BundlePicker locale={locale} />
									<p className="text-muted">{t.bundleHelp}</p>
									<Button type="submit" disabled={state.busy}>
										{t.invite}
									</Button>
								</form>
							)}
							<ul className="list-none p-0 flex flex-col gap-4">
								{state.data.invitations.map((item) => (
									<li
										key={item.id}
										className="rounded-card border border-border p-4"
									>
										<bdi className="break-all font-identifier">
											{item.email}
										</bdi>
										<p>
											{label(t, item.status)} · {label(t, item.delivery_status)}
										</p>
										<p className="my-3">
											{item.bundles.map((key) => label(t, key)).join(" · ")}
										</p>
										{["pending", "expired"].includes(item.status) && (
											<div className="flex flex-wrap gap-3">
												<Button
													variant="secondary"
													disabled={state.busy}
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
													variant="secondary"
													disabled={state.busy}
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
							{!state.data.invitations.length && <p>{t.empty}</p>}
						</>
					)}
					{tab === "transfers" && (
						<>
							{profile.can_manage && (
								<form className="my-4 flex flex-col gap-3" onSubmit={transfer}>
									<h3 className="text-xl font-bold">{t.requestTransfer}</h3>
									<p>{t.transferHelp}</p>
									<Field name="recipient" label={t.recipient}>
										<Select name="recipient" required>
											<option value="">—</option>
											{state.data.members
												.filter((m) => m.active && m.eligible && !m.is_owner)
												.map((m) => (
													<option key={m.id} value={m.id}>
														{m.name}
													</option>
												))}
										</Select>
									</Field>
									<BundlePicker locale={locale} name="retained_bundles" />
									<Button type="submit" disabled={state.busy}>
										{t.requestTransfer}
									</Button>
								</form>
							)}
							<ul className="list-none p-0 flex flex-col gap-4">
								{state.data.transfers.map((item) => (
									<li
										key={item.id}
										className="rounded-card border border-border p-4"
									>
										<h4 className="break-words font-bold">
											{item.recipient_name}
										</h4>
										<p>{label(t, item.status)}</p>
										<p>
											{t.retained}:{" "}
											{item.retained_bundles
												.map((b) => label(t, b))
												.join(" · ") || "—"}
										</p>
										{item.reason && <p>{item.reason}</p>}
										{item.status === "pending" &&
											state.data?.members.some(
												(m) =>
													m.id === item.recipient_id &&
													m.id === profile.my_membership_id,
											) && (
												<Button
													disabled={state.busy}
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
													disabled={state.busy}
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
									</li>
								))}
							</ul>
							{!state.data.transfers.length && <p>{t.empty}</p>}
						</>
					)}
				</>
			)}
		</section>
	);
}
