"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { SettingsSection } from "../../../components/accounts/seller-settings-ui";
import type { SellerBusinessOptions } from "../../organizations/components/seller-business-ui";
import { useSellerWorkflow } from "../../organizations/components/workflow-state";
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
type ApplicationPanelProps = {
	locale: Locale;
	context: string;
	profileId: string;
	onChanged: () => void;
	sellerBusiness?: SellerBusinessOptions;
};
export function ApplicationPanel(props: ApplicationPanelProps) {
	return props.sellerBusiness && props.context === "seller" ? (
		<SellerApplicationPanel {...props} sellerBusiness={props.sellerBusiness} />
	) : (
		<DefaultApplicationPanel {...props} />
	);
}
function DefaultApplicationPanel({
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

function SellerApplicationPanel({
	locale,
	context,
	profileId,
	sellerBusiness,
}: ApplicationPanelProps & { sellerBusiness: SellerBusinessOptions }) {
	const path = `verification/${context}/profiles/${profileId}/application/`;
	const state = useSellerWorkflow<Application>(path, locale, sellerBusiness);
	const t = organizationCopy[locale];
	const current = state.data?.current;
	const [alternatives, setAlternatives] = useState<Record<string, string>>({});
	const [replaceId, setReplaceId] = useState("");
	const [category, setCategory] = useState("");
	const [hasFile, setHasFile] = useState(false);
	const [pendingRebase, setPendingRebase] = useState(false);
	const alternativeBaseline = useRef<Record<string, string> | null>(null);
	const appliedCase = useRef("");
	const evidenceForm = useRef<HTMLFormElement>(null);
	const callback = useRef(sellerBusiness.onDirtyChange);
	callback.current = sellerBusiness.onDirtyChange;
	const alternativesDirty = Object.entries(alternatives).some(
		([key, value]) =>
			value !==
			(alternativeBaseline.current?.[key] ??
				current?.alternative_requests[key] ??
				""),
	);
	const dirty =
		alternativesDirty ||
		hasFile ||
		!!replaceId ||
		(!!category && category !== current?.categories[0]) ||
		state.busy;
	useEffect(() => {
		callback.current(dirty);
	}, [dirty]);
	useEffect(() => () => callback.current(false), []);
	useEffect(() => {
		if (!state.denied) return;
		setAlternatives({});
		alternativeBaseline.current = null;
		setReplaceId("");
		setCategory("");
		setHasFile(false);
		setPendingRebase(false);
	}, [state.denied]);
	useEffect(() => {
		// Rebase only an acknowledged alternative/revision command, on fresh GET data.
		if (
			pendingRebase &&
			current &&
			!state.blocked &&
			!state.loading &&
			!state.busy
		) {
			setAlternatives({});
			alternativeBaseline.current = null;
			setPendingRebase(false);
		}
	}, [pendingRebase, current, state.blocked, state.loading, state.busy]);
	useEffect(() => {
		// A clean override is not a draft: drop it once the server copy changes.
		if (!current || state.loading) return;
		const token = `${current.version}:${JSON.stringify(current.alternative_requests)}`;
		if (appliedCase.current === token) return;
		appliedCase.current = token;
		const baseline = alternativeBaseline.current;
		if (!baseline) return;
		alternativeBaseline.current = { ...current.alternative_requests };
		setAlternatives((values) => {
			const kept: Record<string, string> = {};
			for (const [key, value] of Object.entries(values))
				if (value !== (baseline[key] ?? "")) kept[key] = value;
			return kept;
		});
	}, [current, state.loading]);
	useEffect(() => {
		// Evidence inputs exist only while drafting, so a filed case cannot keep them dirty.
		if (!current || current.status === "draft") return;
		setHasFile(false);
		setReplaceId("");
		setCategory("");
		evidenceForm.current?.reset();
	}, [current]);
	const disabled = state.busy || state.blocked || state.loading;
	async function action(type: string) {
		if (!current || disabled) return;
		if (type === "submit" && !window.confirm(t.submitConfirm)) return;
		if (type === "revise" && !window.confirm(t.reviseHelp)) return;
		const result = await state.mutate(path, {
			action: type,
			version: current.version,
			alternative_requests: Object.fromEntries(
				Object.entries({
					...current.alternative_requests,
					...alternatives,
				}).filter(([, value]) => value.trim()),
			),
		});
		if (result) {
			if (result.data) {
				setAlternatives({});
				alternativeBaseline.current = null;
			} else setPendingRebase(true);
		}
	}
	async function upload(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!current || disabled) return;
		const form = event.currentTarget;
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
			setHasFile(false);
			setReplaceId("");
			setCategory("");
		}
	}
	return (
		<section className="min-w-0 space-y-5" aria-label={t.application}>
			<WorkflowState
				locale={locale}
				state={{
					...state,
					refresh: () =>
						sellerBusiness.choose(() => {
							// A confirmed reload discards every draft in this panel.
							setAlternatives({});
							alternativeBaseline.current = null;
							setReplaceId("");
							setCategory("");
							setHasFile(false);
							setPendingRebase(false);
							evidenceForm.current?.reset();
							void state.refresh();
						}),
				}}
			/>
			{current && (
				<>
					<SettingsSection title={t.application}>
						<p className="font-semibold" data-testid="case-status">
							{t.status}: {label(t, current.status)} · {t.revision}{" "}
							{current.revision}
						</p>
						{current.reason && (
							<p className="rounded-xl bg-info p-4 whitespace-pre-wrap break-words">
								{current.reason}
							</p>
						)}
					</SettingsSection>
					<SettingsSection title={t.checklist}>
						<ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
							{current.categories.map((key) => (
								<li
									key={key}
									className="flex flex-wrap justify-between gap-2 rounded-xl border border-border p-4"
								>
									<span>{label(t, key)}</span>
									<strong>
										{current.evidence.some((file) => file.category === key) ||
										current.accepted_alternatives[key]
											? t.present
											: t.missing}
									</strong>
								</li>
							))}
						</ul>
					</SettingsSection>
					<SettingsSection title={t.evidence} description={t.fileHelp}>
						<EvidenceList item={current} locale={locale} context={context} />
						{!current.evidence.length && (
							<p className="text-muted">{t.empty}</p>
						)}
						{current.status === "draft" && (
							<form ref={evidenceForm} onSubmit={upload} aria-busy={state.busy}>
								<fieldset disabled={disabled} className="min-w-0 space-y-4">
									<legend className="font-semibold">{t.upload}</legend>
									<div className="grid min-w-0 gap-4 sm:grid-cols-2">
										<Field name="category" label={t.category}>
											<Select
												name="category"
												value={category || current.categories[0] || ""}
												onChange={(event) => setCategory(event.target.value)}
											>
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
												onChange={(event) => setReplaceId(event.target.value)}
											>
												<option value="">{t.newFile}</option>
												{current.evidence.map((file, index) => (
													<option key={file.id} value={file.id}>
														{label(t, file.category)} · {index + 1}
													</option>
												))}
											</Select>
										</Field>
									</div>
									<Field name="file" label={t.file}>
										<Input
											name="file"
											type="file"
											accept="application/pdf,image/jpeg,image/png"
											required
											onChange={(event) =>
												setHasFile(!!event.target.files?.length)
											}
										/>
									</Field>
									<Button type="submit" disabled={disabled}>
										{t.upload}
									</Button>
								</fieldset>
							</form>
						)}
					</SettingsSection>
					{current.status === "draft" ? (
						<>
							<SettingsSection
								title={t.alternative}
								description={t.alternativeHelp}
							>
								<fieldset disabled={disabled} className="min-w-0 space-y-3">
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
												value={
													alternatives[key] ??
													current.alternative_requests[key] ??
													""
												}
												onChange={(event) => {
													if (!alternativeBaseline.current) {
														alternativeBaseline.current = {
															...current.alternative_requests,
														};
													}
													setAlternatives((values) => ({
														...values,
														[key]: event.target.value,
													}));
												}}
											/>
										</Field>
									))}
									<Button
										disabled={disabled}
										variant="secondary"
										onClick={() => action("save")}
									>
										{t.save}
									</Button>
								</fieldset>
							</SettingsSection>
							<div className="border-t border-border pt-5">
								<Button disabled={disabled} onClick={() => action("submit")}>
									{t.submit}
								</Button>
							</div>
						</>
					) : (
						<SettingsSection title={t.revise} description={t.reviseHelp}>
							<Button
								variant="secondary"
								disabled={disabled}
								onClick={() => action("revise")}
							>
								{t.revise}
							</Button>
						</SettingsSection>
					)}
					<SettingsSection title={t.history}>
						{state.data?.revisions.map((item) => (
							<ReviewHistory key={item.id} item={item} locale={locale} />
						))}
					</SettingsSection>
				</>
			)}
		</section>
	);
}
