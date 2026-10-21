"use client";
import Link from "next/link";
import { useState } from "react";
import { organizationCopy, label } from "../../../lib/i18n/organizations";
import type { Locale } from "../../../lib/i18n/locales";
import { Button } from "../../../components/ui/button";
import { Field, Select, inputClass } from "../../../components/ui/form-field";
import type {
	TransferQueue,
	Transfer,
} from "../../organizations/api/organizations";
import { BundlePicker } from "../../organizations/components/team-panel";
import {
	useWorkflow,
	WorkflowState,
} from "../../organizations/components/workflow-state";

export function TransferDetail({ locale, id }: { locale: Locale; id: string }) {
	const path = `verification/transfers/${id}/`;
	const state = useWorkflow<Transfer>(path, locale);
	const t = organizationCopy[locale];
	return (
		<>
			<WorkflowState state={state} locale={locale} />
			{state.data && (
				<>
					<h2 className="break-words text-2xl font-bold">
						{state.data.company_name}
					</h2>
					<p className="my-3">
						{t.recipient}: {state.data.recipient_name}
					</p>
					<p>{label(t, state.data.status)}</p>
					<p className="my-3">{t.transferHelp}</p>
					<p>
						{t.revision}: {state.data.company_revision}
					</p>
					<dl className="my-4">
						{Object.entries(state.data.company_identity ?? {}).map(
							([key, value]) => (
								<div key={key}>
									<dt className="font-bold">
										{t[key as keyof typeof t] ?? t.profile}
									</dt>
									<dd className="break-words">{value}</dd>
								</div>
							),
						)}
					</dl>
					<BundlePicker
						locale={locale}
						name="retained_bundles"
						defaults={state.data.retained_bundles}
						disabled
					/>
					{state.data.reason && <p>{state.data.reason}</p>}
					{state.data.status === "accepted" && (
						<form
							className="flex flex-col gap-3"
							onSubmit={(e) => {
								e.preventDefault();
								if (!window.confirm(t.decisionConfirm)) return;
								const data = new FormData(e.currentTarget);
								void state.mutate(path, {
									version: state.data?.version,
									action: data.get("action"),
									reason: data.get("reason"),
								});
							}}
						>
							<Field name="action" label={t.decision}>
								<Select name="action">
									<option value="approve">{t.approve}</option>
									<option value="reject">{t.reject}</option>
								</Select>
							</Field>
							<Field name="reason" label={t.reason}>
								<textarea
									name="reason"
									id="field-reason"
									className={inputClass}
									required
									maxLength={1000}
								/>
							</Field>
							<Button type="submit" disabled={state.busy}>
								{t.decision}
							</Button>
						</form>
					)}
				</>
			)}
		</>
	);
}
export function Transfers({ locale }: { locale: Locale }) {
	const [page, setPage] = useState(1);
	const [filter, setFilter] = useState("accepted");
	const state = useWorkflow<TransferQueue>(
		`verification/transfers/?page=${page}&status=${filter}`,
		locale,
	);
	const t = organizationCopy[locale];
	return (
		<>
			<Field name="filter" label={t.filter}>
				<Select
					name="filter"
					value={filter}
					onChange={(e) => {
						setFilter(e.target.value);
						setPage(1);
					}}
				>
					<option value="">{t.all}</option>
					{["pending", "accepted", "approved", "rejected", "cancelled"].map(
						(key) => (
							<option key={key} value={key}>
								{label(t, key)}
							</option>
						),
					)}
				</Select>
			</Field>
			<WorkflowState state={state} locale={locale} />
			{state.data && (
				<>
					<p>
						{t.count}: {state.data.count}
					</p>
					<ul className="list-none p-0 my-4 flex flex-col gap-4">
						{state.data.results.map((item) => (
							<li
								key={item.id}
								className="rounded-card border border-border p-4"
							>
								<Link
									className="break-words text-xl font-bold text-action"
									href={`/${locale}/account/staff/transfers/${item.id}`}
								>
									{item.company_name}
								</Link>
								<p>
									{t.recipient}: {item.recipient_name}
								</p>
								<p>{label(t, item.status)}</p>
							</li>
						))}
					</ul>
					{!state.data.results.length && <p>{t.empty}</p>}
					<div className="flex flex-wrap gap-3">
						<Button
							variant="secondary"
							disabled={page === 1}
							onClick={() => setPage(page - 1)}
						>
							{t.previous}
						</Button>
						<Button
							variant="secondary"
							disabled={page * 20 >= state.data.count}
							onClick={() => setPage(page + 1)}
						>
							{t.next}
						</Button>
					</div>
				</>
			)}
		</>
	);
}
