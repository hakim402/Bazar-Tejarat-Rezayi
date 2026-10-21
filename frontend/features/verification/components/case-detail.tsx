"use client";
import type { FormEvent } from "react";
import { organizationCopy, label } from "../../../lib/i18n/organizations";
import type { Locale } from "../../../lib/i18n/locales";
import { Button } from "../../../components/ui/button";
import {
	Field,
	Input,
	Select,
	inputClass,
} from "../../../components/ui/form-field";
import type {
	ReviewCase,
	ReviewOperation,
} from "../../organizations/api/organizations";
import {
	useWorkflow,
	WorkflowState,
} from "../../organizations/components/workflow-state";
import { EvidenceList, ReviewHistory } from "./application-panel";

export function CaseDetail({ locale, id }: { locale: Locale; id: string }) {
	const path = `verification/cases/${id}/`;
	const state = useWorkflow<ReviewCase>(path, locale);
	const t = organizationCopy[locale];
	const item = state.data;
	async function decide(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (!item || !window.confirm(t.decisionConfirm)) return;
		const values = new FormData(e.currentTarget);
		const alternatives: Record<string, string> = {};
		for (const key of item.categories) {
			const value = String(values.get(`alternative-${key}`) ?? "").trim();
			if (value) alternatives[key] = value;
		}
		await state.mutate<ReviewOperation>(path, {
			action: values.get("action"),
			version: item.version,
			reason: values.get("reason"),
			internal_note: values.get("internal_note"),
			accepted_alternatives: alternatives,
		});
	}
	return (
		<>
			<WorkflowState state={state} locale={locale} />
			{item && (
				<>
					<h2 className="break-words text-2xl font-bold">
						{item.display_name}
					</h2>
					<p className="my-4" data-testid="staff-case-status">
						{t.status}: {label(t, item.status)} · {t.revision} {item.revision}
					</p>
					<dl className="my-4 grid gap-3">
						{Object.entries(item.snapshot).map(([key, value]) => (
							<div key={key}>
								<dt className="font-bold">
									{t[key as keyof typeof t] ?? t.profile}
								</dt>
								<dd className="break-words whitespace-pre-wrap">{value}</dd>
							</div>
						))}
					</dl>
					<h3 className="text-xl font-bold">{t.evidence}</h3>
					<EvidenceList item={item} locale={locale} context="staff" />
					<ul className="list-none p-0 my-4">
						{item.categories.map((key) => (
							<li key={key}>
								{label(t, key)}:{" "}
								{item.evidence.some((file) => file.category === key) ||
								item.accepted_alternatives[key]
									? t.present
									: t.missing}
								{item.alternative_requests[key] && (
									<p>
										{t.alternative}: {item.alternative_requests[key]}
									</p>
								)}
							</li>
						))}
					</ul>
					{["submitted", "under_review"].includes(item.status) && (
						<form
							onSubmit={decide}
							className="flex flex-col gap-3"
							aria-busy={state.busy}
						>
							<Field name="action" label={t.decision}>
								<Select name="action">
									<option value="approved">{t.approve}</option>
									<option value="rejected">{t.reject}</option>
									<option value="needs_information">{t.information}</option>
								</Select>
							</Field>
							<Field name="reason" label={t.reason}>
								<textarea
									name="reason"
									id="field-reason"
									className={inputClass}
									maxLength={1000}
									required
								/>
							</Field>
							<Field name="internal_note" label={t.internal}>
								<textarea
									name="internal_note"
									id="field-internal_note"
									className={inputClass}
									maxLength={1000}
								/>
							</Field>
							<p className="text-muted">{t.internalHelp}</p>
							<details>
								<summary className="cursor-pointer py-3 font-bold">
									{t.acceptedAlternative}
								</summary>
								{item.categories.map((key) => (
									<Field
										key={key}
										name={`alternative-${key}`}
										label={label(t, key)}
									>
										<Input name={`alternative-${key}`} maxLength={1000} />
									</Field>
								))}
							</details>
							<Button type="submit" disabled={state.busy}>
								{t.decision}
							</Button>
						</form>
					)}
					<ReviewHistory item={item} locale={locale} />
				</>
			)}
		</>
	);
}
