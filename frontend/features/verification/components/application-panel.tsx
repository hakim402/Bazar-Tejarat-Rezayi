"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SellerBusinessOptions } from "../../organizations/components/seller-business-ui";
import { useSellerWorkflow } from "../../organizations/components/workflow-state";
import { apiOrigin } from "../../../lib/api/client";
import { BusinessDialog } from "../../../components/accounts/seller-settings-ui";
import { Button } from "../../../components/shadcn/button";
import { Input } from "../../../components/shadcn/input";
import { Label } from "../../../components/shadcn/label";
import {
	NativeSelect,
	NativeSelectOption,
} from "../../../components/shadcn/native-select";
import { Textarea } from "../../../components/shadcn/textarea";
import {
	DashboardCard,
	cardClass,
} from "../../../components/ui/dashboard-card";
import { Icon } from "../../../components/ui/icon";
import {
	StatusBadge,
	statusVariant,
} from "../../../components/ui/status-badge";
import { organizationCopy, label } from "../../../lib/i18n/organizations";
import { sellerSettingsCopy } from "../../../lib/i18n/seller-settings";
import type { Locale } from "../../../lib/i18n/locales";
import type {
	Application,
	ReviewCase,
} from "../../organizations/api/organizations";
import { WorkflowState } from "../../organizations/components/workflow-state";
import { ConfirmDialog } from "../../orders/components/detail-dialog";

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
						{label(t, file.category)} · <bdi>{Math.ceil(file.size / 1024)}</bdi>{" "}
						{t.kib}
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
function historyAction(t: (typeof organizationCopy)[Locale], action: string) {
	return action.includes("internal")
		? t.internal
		: action.includes("assign")
			? t.assign
			: action.endsWith("approved")
				? t.approved
				: action.endsWith("rejected")
					? t.rejected
					: action.endsWith("needs_information")
						? t.needs_information
						: action.includes("upload")
							? t.upload
							: t.application;
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
						<p>{historyAction(t, event.action)}</p>
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
	) : null;
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
	const [pendingAction, setPendingAction] = useState<
		null | "submit" | "revise"
	>(null);
	const [uploadOpen, setUploadOpen] = useState(false);
	const [alternativesOpen, setAlternativesOpen] = useState(false);
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
	const evidenceDirty =
		hasFile ||
		!!replaceId ||
		(!!category && category !== current?.categories[0]);
	const dirty = alternativesDirty || evidenceDirty || state.busy;
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
		setUploadOpen(false);
		setAlternativesOpen(false);
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
		setUploadOpen(false);
		setAlternativesOpen(false);
		evidenceForm.current?.reset();
	}, [current]);
	const disabled = state.busy || state.blocked || state.loading;
	async function action(type: string) {
		if (!current || disabled) return false;
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
		return !!result;
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
			setUploadOpen(false);
		}
	}
	function closeUpload() {
		setUploadOpen(false);
		setHasFile(false);
		setReplaceId("");
		setCategory("");
		evidenceForm.current?.reset();
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
							setUploadOpen(false);
							setAlternativesOpen(false);
							evidenceForm.current?.reset();
							void state.refresh();
						}),
				}}
			/>
			{current && (
				<>
					<DashboardCard
						title={t.application}
						icon="shield"
						action={
							<BusinessDialog
								locale={locale}
								title={t.history}
								trigger={
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="min-h-11 sm:min-h-8"
									>
										<Icon name="history" className="size-4" />
										{t.history}
									</Button>
								}
							>
								<div className="space-y-5">
									{state.data?.revisions.map((item) => (
										<div key={item.id} className="min-w-0">
											<h3 className="m-0 text-sm font-semibold">
												{t.revision} <bdi>{item.revision}</bdi>
											</h3>
											<ul className="m-0 mt-3 list-none space-y-4 p-0">
												{item.history.map((event) => (
													<li
														key={event.id}
														className="border-s-2 border-border ps-3"
													>
														<time
															dir="ltr"
															className="block text-xs text-muted"
														>
															{new Date(event.created_at).toLocaleString(
																locale,
															)}
														</time>
														<p className="m-0 mt-0.5 text-sm font-medium">
															{historyAction(t, event.action)}
														</p>
														{event.reason && (
															<p className="m-0 mt-1 text-sm whitespace-pre-wrap break-words text-muted">
																{event.reason}
															</p>
														)}
													</li>
												))}
											</ul>
										</div>
									))}
									{!state.data?.revisions.length && (
										<p className="m-0 text-sm text-muted">{t.empty}</p>
									)}
								</div>
							</BusinessDialog>
						}
					>
						<p
							className="m-0 flex flex-wrap items-center gap-2"
							data-testid="case-status"
						>
							<StatusBadge variant={statusVariant(current.status)}>
								{label(t, current.status)}
							</StatusBadge>
							<span className="text-sm text-muted">
								{t.revision} <bdi>{current.revision}</bdi>
							</span>
						</p>
						{current.reason && (
							<p className="m-0 mt-3 rounded-xl bg-info p-4 text-sm leading-relaxed whitespace-pre-wrap break-words">
								{current.reason}
							</p>
						)}
					</DashboardCard>
					<DashboardCard title={t.checklist} icon="check-circle">
						<ul className="m-0 list-none divide-y divide-border p-0">
							{current.categories.map((key) => {
								const provided =
									current.evidence.some((file) => file.category === key) ||
									Boolean(current.accepted_alternatives[key]);
								return (
									<li
										key={key}
										className="flex min-w-0 items-center gap-3 py-2.5"
									>
										<span
											className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
												provided
													? "bg-success/10 text-success"
													: "bg-warning/10 text-warning"
											}`}
											aria-hidden="true"
										>
											<Icon
												name={provided ? "check-circle" : "alert-triangle"}
												className="size-4"
											/>
										</span>
										<span className="min-w-0 flex-1 text-sm font-medium">
											{label(t, key)}
										</span>
										<StatusBadge
											size="sm"
											variant={provided ? "success" : "warning"}
											className="shrink-0"
										>
											{provided ? t.present : t.missing}
										</StatusBadge>
									</li>
								);
							})}
						</ul>
					</DashboardCard>
					<DashboardCard
						title={t.evidence}
						description={t.fileHelp}
						icon="file"
						action={
							current.status === "draft" ? (
								<BusinessDialog
									locale={locale}
									title={t.upload}
									open={uploadOpen}
									busy={state.busy}
									onOpenChange={(open) => {
										if (open) setUploadOpen(true);
										else if (evidenceDirty) sellerBusiness.choose(closeUpload);
										else closeUpload();
									}}
									trigger={
										<Button
											type="button"
											variant="outline"
											size="sm"
											className="min-h-11 sm:min-h-8"
										>
											<Icon name="plus" className="size-4" />
											{t.upload}
										</Button>
									}
								>
									<form
										ref={evidenceForm}
										onSubmit={upload}
										aria-busy={state.busy}
									>
										<fieldset disabled={disabled} className="min-w-0 space-y-4">
											<div className="grid min-w-0 gap-4 sm:grid-cols-2">
												<div className="grid min-w-0 gap-2">
													<Label htmlFor="field-category" className="font-bold">
														{t.category}
													</Label>
													<NativeSelect
														id="field-category"
														name="category"
														value={category || current.categories[0] || ""}
														onChange={(event) =>
															setCategory(event.target.value)
														}
													>
														{current.categories.map((key) => (
															<NativeSelectOption key={key} value={key}>
																{label(t, key)}
															</NativeSelectOption>
														))}
													</NativeSelect>
												</div>
												<div className="grid min-w-0 gap-2">
													<Label
														htmlFor="field-replace_id"
														className="font-bold"
													>
														{t.replace}
													</Label>
													<NativeSelect
														id="field-replace_id"
														name="replace_id"
														value={replaceId}
														onChange={(event) =>
															setReplaceId(event.target.value)
														}
													>
														<NativeSelectOption value="">
															{t.newFile}
														</NativeSelectOption>
														{current.evidence.map((file, index) => (
															<NativeSelectOption key={file.id} value={file.id}>
																{label(t, file.category)} · {index + 1}
															</NativeSelectOption>
														))}
													</NativeSelect>
												</div>
											</div>
											<div className="grid min-w-0 gap-2">
												<Label htmlFor="field-file" className="font-bold">
													{t.file}
												</Label>
												<Input
													id="field-file"
													name="file"
													type="file"
													accept="application/pdf,image/jpeg,image/png"
													required
													onChange={(event) =>
														setHasFile(!!event.target.files?.length)
													}
												/>
											</div>
											<Button
												type="submit"
												disabled={disabled}
												className="min-h-11"
											>
												{t.upload}
											</Button>
										</fieldset>
									</form>
								</BusinessDialog>
							) : undefined
						}
					>
						{current.evidence.length ? (
							<ul className="m-0 list-none divide-y divide-border p-0">
								{current.evidence.map((file) => (
									<li
										key={file.id}
										className="flex min-w-0 flex-wrap items-center gap-3 py-2.5"
									>
										<span
											className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-info text-action"
											aria-hidden="true"
										>
											<Icon name="file" className="size-4" />
										</span>
										<span className="min-w-0 flex-1 text-sm">
											<span className="block font-medium">
												{label(t, file.category)}
											</span>
											<span className="text-muted">
												<bdi>{Math.ceil(file.size / 1024)}</bdi> {t.kib}
											</span>
										</span>
										<a
											className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-sm font-medium text-action no-underline hover:underline"
											href={`${apiOrigin(process.env.NEXT_PUBLIC_API_URL)}/api/v1/verification/evidence/${context}/${file.id}/`}
											referrerPolicy="no-referrer"
										>
											<Icon name="arrow-down" className="size-4" />
											{t.download}
										</a>
									</li>
								))}
							</ul>
						) : (
							<p className="m-0 text-sm text-muted">{t.empty}</p>
						)}
						{evidenceDirty && (
							<p className="m-0 mt-3 text-sm font-medium text-warning">
								{sellerSettingsCopy[locale].unsaved}
							</p>
						)}
					</DashboardCard>
					{current.status === "draft" ? (
						<>
							<DashboardCard
								title={t.alternative}
								description={t.alternativeHelp}
								icon="help"
								action={
									<BusinessDialog
										locale={locale}
										title={t.alternative}
										open={alternativesOpen}
										busy={state.busy}
										onOpenChange={(open) => {
											if (open) setAlternativesOpen(true);
											else if (alternativesDirty)
												sellerBusiness.choose(() => {
													setAlternatives({});
													alternativeBaseline.current = null;
													setAlternativesOpen(false);
												});
											else setAlternativesOpen(false);
										}}
										trigger={
											<Button
												type="button"
												variant="outline"
												size="sm"
												className="min-h-11 sm:min-h-8"
											>
												<Icon name="file" className="size-4" />
												{t.alternative}
											</Button>
										}
									>
										<p className="m-0 text-sm leading-relaxed text-muted">
											{t.alternativeHint}
										</p>
										<fieldset
											disabled={disabled}
											className="mt-4 min-w-0 space-y-4"
										>
											{current.categories.map((key) => (
												<div key={key} className="grid min-w-0 gap-2">
													<Label
														htmlFor={`field-alternative-${key}`}
														className="font-bold"
													>
														{label(t, key)}
													</Label>
													<Textarea
														id={`field-alternative-${key}`}
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
												</div>
											))}
											<Button
												type="button"
												disabled={disabled}
												className="min-h-11"
												onClick={async () => {
													if (await action("save")) setAlternativesOpen(false);
												}}
											>
												{t.save}
											</Button>
										</fieldset>
									</BusinessDialog>
								}
							>
								<ul className="m-0 list-none divide-y divide-border p-0">
									{current.categories.map((key) => {
										const value =
											alternatives[key] ??
											current.alternative_requests[key] ??
											"";
										const saved = Boolean(
											current.alternative_requests[key]?.trim(),
										);
										return (
											<li
												key={key}
												className="flex min-w-0 items-start gap-3 py-2.5"
											>
												<span className="min-w-0 flex-1">
													<span className="block text-sm font-medium">
														{label(t, key)}
													</span>
													<span className="mt-0.5 line-clamp-2 block text-sm break-words text-muted">
														{value || "—"}
													</span>
												</span>
												{saved && (
													<StatusBadge
														size="sm"
														variant="info"
														className="shrink-0"
													>
														{t.requested}
													</StatusBadge>
												)}
											</li>
										);
									})}
								</ul>
								{alternativesDirty && (
									<p className="m-0 mt-3 text-sm font-medium text-warning">
										{sellerSettingsCopy[locale].unsaved}
									</p>
								)}
							</DashboardCard>
							<div
								className={`${cardClass} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}
							>
								<p className="m-0 text-sm leading-relaxed text-muted">
									{t.submitConfirm}
								</p>
								<Button
									disabled={disabled}
									className="min-h-11 shrink-0"
									onClick={() => setPendingAction("submit")}
								>
									<Icon name="send" className="size-4" />
									{t.submit}
								</Button>
							</div>
						</>
					) : (
						<DashboardCard
							title={t.revise}
							description={t.reviseHelp}
							icon="history"
						>
							<Button
								variant="secondary"
								disabled={disabled}
								className="min-h-11"
								onClick={() => setPendingAction("revise")}
							>
								<Icon name="plus" className="size-4" />
								{t.revise}
							</Button>
						</DashboardCard>
					)}
				</>
			)}
			<ConfirmDialog
				locale={locale}
				open={!!pendingAction}
				title={pendingAction === "submit" ? t.submit : t.revise}
				body={pendingAction === "submit" ? t.submitConfirm : t.reviseHelp}
				confirmLabel={pendingAction === "submit" ? t.submit : t.revise}
				busy={disabled}
				onCancel={() => setPendingAction(null)}
				onConfirm={() => {
					const type = pendingAction;
					setPendingAction(null);
					if (type) void action(type);
				}}
			/>
		</section>
	);
}
