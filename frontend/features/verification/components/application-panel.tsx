"use client";
import { useState, type FormEvent } from "react";
import { apiOrigin } from "../../../lib/api/client";
import { Button } from "../../../components/ui/button";
import {
	Field,
	Input,
	Select,
	inputClass,
} from "../../../components/ui/form-field";
import { organizationCopy, label } from "../../../lib/i18n/organizations";
import type { Locale } from "../../../lib/i18n/locales";
import type {
	Application,
	ReviewCase,
} from "../../organizations/api/organizations";
import {
	useWorkflow,
	WorkflowState,
} from "../../organizations/components/workflow-state";

export function EvidenceList({
	item,
	locale,
	context,
}: {
	item: ReviewCase;
	locale: Locale;
	context: string;
}) {
	const t = organizationCopy[locale];
	return (
		<ul className="list-none p-0 my-4 flex flex-col gap-3">
			{item.evidence.map((file) => (
				<li
					key={file.id}
					className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border p-3"
				>
					<span>
						{label(t, file.category)} · {Math.ceil(file.size / 1024)} KiB
					</span>
					<a
						className="text-action underline"
						href={`${apiOrigin(process.env.NEXT_PUBLIC_API_URL)}/api/v1/verification/evidence/${context}/${file.id}/`}
						referrerPolicy="no-referrer"
					>
						{t.download}
					</a>
				</li>
			))}
		</ul>
	);
}
export function ReviewHistory({
	item,
	locale,
}: {
	item: ReviewCase;
	locale: Locale;
}) {
	const t = organizationCopy[locale];
	return (
		<details className="my-4">
			<summary className="cursor-pointer py-3 font-bold">
				{t.history} · {t.revision} {item.revision}
			</summary>
			<ul className="list-none p-0 flex flex-col gap-3">
				{item.history.map((event) => (
					<li key={event.id} className="border-s-2 border-border ps-3">
						<time dir="ltr" className="text-sm text-muted">
							{new Date(event.created_at).toLocaleString(locale)}
						</time>
						<p>
							{event.action.includes("internal")
								? t.internal
								: event.action.includes("assign")
									? t.assign
									: event.action.endsWith("approved")
										? t.approved
										: event.action.endsWith("rejected")
											? t.rejected
											: event.action.endsWith("needs_information")
												? t.needs_information
												: event.action.includes("upload")
													? t.upload
													: t.application}
						</p>
						{event.reason && (
							<p className="whitespace-pre-wrap break-words">{event.reason}</p>
						)}
					</li>
				))}
			</ul>
		</details>
	);
}
export function ApplicationPanel({
	locale,
	context,
	profileId,
	onChanged,
}: {
	locale: Locale;
	context: string;
	profileId: string;
	onChanged: () => void;
}) {
	const path = `verification/${context}/profiles/${profileId}/application/`;
	const state = useWorkflow<Application>(path, locale);
	const t = organizationCopy[locale];
	const [alternatives, setAlternatives] = useState<Record<string, string>>({});
	const [replaceId, setReplaceId] = useState("");
	const current = state.data?.current;
	async function action(type: string) {
		if (!current) return;
		if (type === "submit" && !window.confirm(t.submitConfirm)) return;
		if (type === "revise" && !window.confirm(t.reviseHelp)) return;
		if (
			await state.mutate(path, {
				action: type,
				version: current.version,
				alternative_requests: Object.fromEntries(
					Object.entries({
						...current.alternative_requests,
						...alternatives,
					}).filter(([, value]) => value.trim()),
				),
			})
		)
			onChanged();
	}
	async function upload(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (!current) return;
		const form = e.currentTarget;
		const data = new FormData(form);
		data.set("version", String(current.version));
		if (!replaceId) data.delete("replace_id");
		if (
			await state.mutate(
				`verification/${context}/profiles/${profileId}/evidence/`,
				data,
			)
		) {
			form.reset();
			setReplaceId("");
		}
	}
	return (
		<section aria-label={t.application} className="mt-6">
			<h2 className="text-2xl font-bold">{t.application}</h2>
			<WorkflowState state={state} locale={locale} />
			{current && (
				<>
					<p className="my-4 font-bold" data-testid="case-status">
						{t.status}: {label(t, current.status)} · {t.revision}{" "}
						{current.revision}
					</p>
					{current.reason && (
						<p className="rounded-control bg-info p-4 whitespace-pre-wrap">
							{current.reason}
						</p>
					)}
					<h3 className="font-bold">{t.checklist}</h3>
					<ul className="list-none p-0 my-3">
						{current.categories.map((key) => (
							<li key={key}>
								{label(t, key)}:{" "}
								{current.evidence.some((e) => e.category === key) ||
								current.accepted_alternatives[key]
									? t.present
									: t.missing}
							</li>
						))}
					</ul>
					<EvidenceList item={current} locale={locale} context={context} />
					{current.status === "draft" ? (
						<>
							<form
								onSubmit={upload}
								className="my-5 flex flex-col gap-3"
								aria-busy={state.busy}
							>
								<p className="text-muted">{t.fileHelp}</p>
								<Field name="category" label={t.category}>
									<Select name="category">
										{current.categories.map((key) => (
											<option key={key} value={key}>
												{label(t, key)}
											</option>
										))}
									</Select>
								</Field>
								<Field name="replace_id" label={t.replace}>
									<Select
										name="replace_id"
										value={replaceId}
										onChange={(e) => setReplaceId(e.target.value)}
									>
										<option value="">{t.newFile}</option>
										{current.evidence.map((file, index) => (
											<option key={file.id} value={file.id}>
												{label(t, file.category)} · {index + 1}
											</option>
										))}
									</Select>
								</Field>
								<Field name="file" label={t.file}>
									<Input
										name="file"
										type="file"
										accept="application/pdf,image/jpeg,image/png"
										required
									/>
								</Field>
								<Button type="submit" disabled={state.busy}>
									{t.upload}
								</Button>
							</form>
							<details className="my-4">
								<summary className="cursor-pointer py-3 font-bold">
									{t.alternative}
								</summary>
								<p>{t.alternativeHelp}</p>
								{current.categories.map((key) => (
									<Field
										key={key}
										name={`alternative-${key}`}
										label={label(t, key)}
									>
										<textarea
											id={`field-alternative-${key}`}
											className={inputClass}
											maxLength={1000}
											defaultValue={current.alternative_requests[key] ?? ""}
											onChange={(e) =>
												setAlternatives({
													...current.alternative_requests,
													...alternatives,
													[key]: e.target.value,
												})
											}
										/>
									</Field>
								))}
								<Button
									disabled={state.busy}
									variant="secondary"
									onClick={() => action("save")}
								>
									{t.save}
								</Button>
							</details>
							<Button disabled={state.busy} onClick={() => action("submit")}>
								{t.submit}
							</Button>
						</>
					) : (
						<>
							<p className="my-3 text-muted">{t.reviseHelp}</p>
							<Button
								variant="secondary"
								disabled={state.busy}
								onClick={() => action("revise")}
							>
								{t.revise}
							</Button>
						</>
					)}
					{state.data?.revisions.map((item) => (
						<ReviewHistory key={item.id} item={item} locale={locale} />
					))}
				</>
			)}
		</section>
	);
}
