"use client";
import Link from "next/link";
import { useState } from "react";
import { organizationCopy, label } from "../../../lib/i18n/organizations";
import type { Locale } from "../../../lib/i18n/locales";
import { Button } from "../../../components/ui/button";
import { Field, Select } from "../../../components/ui/form-field";
import type {
	Queue,
	ReviewOperation,
} from "../../organizations/api/organizations";
import {
	useWorkflow,
	WorkflowState,
} from "../../organizations/components/workflow-state";

export function CaseQueue({ locale }: { locale: Locale }) {
	const [filter, setFilter] = useState("submitted");
	const [page, setPage] = useState(1);
	const state = useWorkflow<Queue>(
		`verification/queue/?status=${filter}&page=${page}`,
		locale,
	);
	const t = organizationCopy[locale];
	async function assign(id: string, version: number, target: string) {
		await state.mutate<ReviewOperation>(`verification/cases/${id}/`, {
			action: "assign",
			version,
			assigned_to: target || state.data?.current_account_id,
			reason: t.assign,
		});
	}
	return (
		<>
			<div className="my-5">
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
						{[
							"submitted",
							"under_review",
							"needs_information",
							"approved",
							"rejected",
						].map((key) => (
							<option key={key} value={key}>
								{label(t, key)}
							</option>
						))}
					</Select>
				</Field>
			</div>
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
								className="rounded-card border border-border bg-page p-5"
							>
								<Link
									href={`/${locale}/account/staff/verification/${item.id}`}
									className="break-words text-xl font-bold text-action"
								>
									{item.display_name}
								</Link>
								<p>
									{label(t, item.status)} · {t.revision} {item.revision}
								</p>
								{state.data?.permissions.includes("assign_review") &&
									["submitted", "under_review"].includes(item.status) && (
										<form
											className="my-3 flex flex-col gap-3"
											onSubmit={(e) => {
												e.preventDefault();
												const data = new FormData(e.currentTarget);
												void assign(
													item.id,
													item.version,
													String(data.get("reviewer") ?? ""),
												);
											}}
										>
											<Field name={`reviewer-${item.id}`} label={t.reviewer}>
												<Select
													id={`field-reviewer-${item.id}`}
													name="reviewer"
													defaultValue={item.assigned_to ?? ""}
												>
													<option value="">{t.take}</option>
													{state.data.reviewers.map((reviewer) => (
														<option key={reviewer.id} value={reviewer.id}>
															{reviewer.name}
														</option>
													))}
												</Select>
											</Field>
											<Button type="submit" disabled={state.busy}>
												{t.assign}
											</Button>
										</form>
									)}
							</li>
						))}
					</ul>
					{!state.data.results.length && <p>{t.empty}</p>}
					<div className="flex flex-wrap gap-3">
						<Button
							variant="secondary"
							disabled={page === 1 || state.loading}
							onClick={() => setPage(page - 1)}
						>
							{t.previous}
						</Button>
						<Button
							variant="secondary"
							disabled={page * 20 >= state.data.count || state.loading}
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
