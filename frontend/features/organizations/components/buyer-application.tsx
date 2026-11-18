"use client";
import { useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import { CloudUpload } from "lucide-react";
import { Button } from "../../../components/shadcn/button";
import { Card } from "../../../components/shadcn/card";
import {
	NativeSelect,
	NativeSelectOption,
} from "../../../components/shadcn/native-select";
import { Textarea } from "../../../components/shadcn/textarea";
import { Alert } from "../../../components/ui/alert";
import { FormActions, FormField } from "../../../components/ui/dialog-form";
import { Icon } from "../../../components/ui/icon";
import { StatusBadge } from "../../../components/ui/status-badge";
import { organizationCopy, label } from "../../../lib/i18n/organizations";
import type { Locale } from "../../../lib/i18n/locales";
import { cn } from "../../../lib/shadcn-utils";
import {
	ConfirmDialog,
	DetailDialog,
} from "../../orders/components/detail-dialog";
import { salesTableCard } from "../../sales/components/seller-sales-ui";
import {
	EvidenceList,
	ReviewHistory,
} from "../../verification/components/application-panel";
import type { Application } from "../api/organizations";
import { useWorkflow, WorkflowState } from "./workflow-state";

// Buyer verification workspace: the case summary stays scannable while
// evidence upload, alternatives and confirmations open as stacked dialogs.
export function BuyerApplicationPanel({
	locale,
	profileId,
	onChanged,
}: {
	locale: Locale;
	profileId: string;
	onChanged: () => void;
}) {
	const path = `verification/buyer/profiles/${profileId}/application/`;
	const state = useWorkflow<Application>(path, locale);
	const t = organizationCopy[locale];
	const current = state.data?.current;
	const [alternatives, setAlternatives] = useState<Record<string, string>>({});
	const [replaceId, setReplaceId] = useState("");
	const [fileName, setFileName] = useState("");
	const [dropping, setDropping] = useState(false);
	const [uploadOpen, setUploadOpen] = useState(false);
	const [altOpen, setAltOpen] = useState(false);
	const [confirm, setConfirm] = useState<"submit" | "revise" | null>(null);
	const disabled = state.busy || state.loading;
	const number = new Intl.NumberFormat(locale);
	const isPresent = (key: string) =>
		!!current &&
		(current.evidence.some((file) => file.category === key) ||
			!!current.accepted_alternatives[key]);
	async function action(type: "submit" | "revise" | "save") {
		if (!current) return;
		const ok = await state.mutate(path, {
			action: type,
			version: current.version,
			alternative_requests: Object.fromEntries(
				Object.entries({
					...current.alternative_requests,
					...alternatives,
				}).filter(([, value]) => value.trim()),
			),
		});
		setConfirm(null);
		if (ok) {
			setAlternatives({});
			if (type === "save") setAltOpen(false);
			toast.success(t.saved);
			onChanged();
		}
	}
	async function upload(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!current) return;
		const form = event.currentTarget;
		const data = new FormData(form);
		data.set("version", String(current.version));
		if (!replaceId) data.delete("replace_id");
		if (
			await state.mutate(
				`verification/buyer/profiles/${profileId}/evidence/`,
				data,
			)
		) {
			form.reset();
			setReplaceId("");
			setFileName("");
			setDropping(false);
			setUploadOpen(false);
			toast.success(t.saved);
			onChanged();
		}
	}
	return (
		<section className="min-w-0 space-y-4" aria-label={t.application}>
			<WorkflowState state={{ ...state, notice: "" }} locale={locale} />
			{current && (
				<>
					<Card className={salesTableCard}>
						<div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-border px-4 py-3 sm:px-5">
							<p
								className="m-0 text-sm font-semibold"
								data-testid="case-status"
							>
								{t.status}: {label(t, current.status)} · {t.revision}{" "}
								{current.revision}
							</p>
							<span className="text-xs text-muted tabular-nums">
								{number.format(current.categories.filter(isPresent).length)}/
								{number.format(current.categories.length)} {t.present}
							</span>
						</div>
						<div className="space-y-3 px-4 py-4 sm:px-5">
							{current.reason && (
								<p className="m-0 rounded-lg bg-info p-3 text-sm break-words whitespace-pre-wrap">
									{current.reason}
								</p>
							)}
							<div className="space-y-2">
								<h3 className="m-0 text-sm font-semibold">{t.checklist}</h3>
								<ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
									{current.categories.map((key) => {
										const present = isPresent(key);
										return (
											<li
												key={key}
												className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-page px-3 py-2 text-sm"
											>
												<span className="flex min-w-0 items-center gap-2">
													<Icon
														name="file"
														className="size-4 shrink-0 text-muted"
													/>
													<span className="min-w-0">{label(t, key)}</span>
												</span>
												<StatusBadge
													size="sm"
													dot={false}
													variant={present ? "success" : "warning"}
												>
													{present ? t.present : t.missing}
												</StatusBadge>
											</li>
										);
									})}
								</ul>
							</div>
						</div>
					</Card>
					<Card className={salesTableCard}>
						<div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-border px-4 py-3 sm:px-5">
							<h3 className="m-0 text-sm font-semibold">{t.evidence}</h3>
							{current.status === "draft" ? (
								<div className="flex flex-wrap gap-2">
									<Button
										type="button"
										variant="secondary"
										size="sm"
										className="gap-2"
										disabled={disabled}
										onClick={() => setUploadOpen(true)}
									>
										<Icon name="plus" className="size-3.5" />
										{t.upload}
									</Button>
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={disabled}
										onClick={() => setAltOpen(true)}
									>
										{t.alternative}
									</Button>
									<Button
										type="button"
										size="sm"
										disabled={disabled}
										onClick={() => setConfirm("submit")}
									>
										{t.submit}
									</Button>
								</div>
							) : (
								<Button
									type="button"
									variant="secondary"
									size="sm"
									disabled={disabled}
									onClick={() => setConfirm("revise")}
								>
									{t.revise}
								</Button>
							)}
						</div>
						<div className="space-y-2 px-4 py-4 sm:px-5">
							<p className="m-0 text-xs text-muted">{t.fileHelp}</p>
							{current.status !== "draft" && (
								<p className="m-0 text-xs text-muted">{t.reviseHelp}</p>
							)}
							{current.evidence.length > 0 && (
								<EvidenceList item={current} locale={locale} context="buyer" />
							)}
							{!current.evidence.length && (
								<div className="flex items-center gap-3 rounded-lg bg-page px-3 py-3">
									<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-muted">
										<Icon name="file" className="size-4" />
									</span>
									<p className="m-0 text-sm text-muted">{t.empty}</p>
								</div>
							)}
						</div>
					</Card>
					{state.data && state.data.revisions.length > 0 && (
						<Card className={salesTableCard}>
							<div className="border-0 border-b border-solid border-border px-4 py-3 sm:px-5">
								<h3 className="m-0 text-sm font-semibold">{t.history}</h3>
							</div>
							<div className="divide-y divide-border px-4 text-sm sm:px-5 [&_details]:my-0 [&_summary]:py-2.5 [&_summary]:font-semibold">
								{state.data.revisions.map((item) => (
									<ReviewHistory key={item.id} item={item} locale={locale} />
								))}
							</div>
						</Card>
					)}
				</>
			)}
			<DetailDialog
				locale={locale}
				title={t.upload}
				icon="file"
				label={t.upload}
				description={t.fileHelp}
				open={uploadOpen}
				onOpenChange={setUploadOpen}
				trigger={<span />}
			>
				{current && (
					<form onSubmit={upload} className="space-y-4" aria-busy={state.busy}>
						{state.error && (
							<Alert role="alert" className="m-0 text-sm">
								{state.error}
							</Alert>
						)}
						<FormField
							id="org-evidence-category"
							label={t.category}
							error={state.fields.includes("category") ? t.fields : undefined}
						>
							<NativeSelect id="org-evidence-category" name="category">
								{current.categories.map((key) => (
									<NativeSelectOption key={key} value={key}>
										{label(t, key)}
									</NativeSelectOption>
								))}
							</NativeSelect>
						</FormField>
						<FormField id="org-evidence-replace" label={t.replace}>
							<NativeSelect
								id="org-evidence-replace"
								name="replace_id"
								value={replaceId}
								onChange={(event) => setReplaceId(event.target.value)}
							>
								<NativeSelectOption value="">{t.newFile}</NativeSelectOption>
								{current.evidence.map((file, index) => (
									<NativeSelectOption key={file.id} value={file.id}>
										{label(t, file.category)} · {index + 1}
									</NativeSelectOption>
								))}
							</NativeSelect>
						</FormField>
						<FormField
							id="org-evidence-file"
							label={t.file}
							required
							error={state.fields.includes("file") ? t.fields : undefined}
						>
							<label
								htmlFor="org-evidence-file"
								onDragOver={(event) => {
									event.preventDefault();
									setDropping(!disabled);
								}}
								onDragLeave={() => setDropping(false)}
								onDrop={(event) => {
									event.preventDefault();
									setDropping(false);
									const file = event.dataTransfer.files?.[0];
									const input =
										event.currentTarget.querySelector<HTMLInputElement>(
											"input[type=file]",
										);
									if (!file || !input || disabled) return;
									const transfer = new DataTransfer();
									transfer.items.add(file);
									input.files = transfer.files;
									setFileName(file.name);
								}}
								className={cn(
									"flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed border-solid px-4 py-6 text-center transition-colors focus-within:ring-2 focus-within:ring-action/40 motion-reduce:transition-none",
									dropping
										? "border-action bg-info"
										: "border-action/25 bg-info/25 hover:border-action/60 hover:bg-info/50",
								)}
							>
								<span className="flex size-10 items-center justify-center rounded-xl bg-surface text-action shadow-xs">
									<CloudUpload className="size-5" aria-hidden="true" />
								</span>
								<span className="max-w-full truncate text-sm font-semibold text-action">
									{fileName || t.upload}
								</span>
								<span className="text-xs text-muted">{t.newFile}</span>
								<input
									id="org-evidence-file"
									name="file"
									type="file"
									accept="application/pdf,image/jpeg,image/png"
									required
									className="sr-only"
									onChange={(event) =>
										setFileName(event.target.files?.[0]?.name ?? "")
									}
								/>
							</label>
						</FormField>
						<FormActions>
							<Button type="submit" disabled={disabled}>
								{t.upload}
							</Button>
						</FormActions>
					</form>
				)}
			</DetailDialog>
			<DetailDialog
				locale={locale}
				title={t.alternative}
				icon="help"
				label={t.alternative}
				description={t.alternativeHelp}
				open={altOpen}
				onOpenChange={setAltOpen}
				footer={
					<>
						<Button
							type="button"
							variant="outline"
							onClick={() => setAltOpen(false)}
						>
							{t.cancel}
						</Button>
						<Button
							type="button"
							disabled={disabled}
							onClick={() => action("save")}
						>
							{t.save}
						</Button>
					</>
				}
				trigger={<span />}
			>
				{current && (
					<div className="space-y-4">
						{state.error && (
							<Alert role="alert" className="m-0 text-sm">
								{state.error}
							</Alert>
						)}
						<div className="space-y-3">
							{current.categories.map((key) => {
								const id = `field-alternative-${key}`;
								const value =
									alternatives[key] ?? current.alternative_requests[key] ?? "";
								const present = isPresent(key);
								return (
									<section
										key={key}
										className="rounded-xl border border-solid border-border p-3 sm:p-4"
									>
										<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
											<label htmlFor={id} className="text-sm font-medium">
												{label(t, key)}
											</label>
											<StatusBadge
												size="sm"
												dot={false}
												variant={
													value.trim()
														? "info"
														: present
															? "success"
															: "warning"
												}
											>
												{value.trim()
													? t.requested
													: present
														? t.present
														: t.missing}
											</StatusBadge>
										</div>
										<Textarea
											id={id}
											maxLength={1000}
											rows={2}
											value={value}
											aria-describedby={`${id}-help`}
											onChange={(event) =>
												setAlternatives((values) => ({
													...values,
													[key]: event.target.value,
												}))
											}
										/>
										<div className="mt-1.5 flex items-start justify-between gap-3 text-xs text-muted">
											<p id={`${id}-help`} className="m-0">
												{t.alternativeHint}
											</p>
											<span className="shrink-0 tabular-nums">
												{number.format(value.length)}/{number.format(1000)}
											</span>
										</div>
									</section>
								);
							})}
						</div>
					</div>
				)}
			</DetailDialog>
			<ConfirmDialog
				locale={locale}
				open={confirm === "submit"}
				title={t.submit}
				body={t.submitConfirm}
				confirmLabel={t.submit}
				busy={state.busy}
				onCancel={() => setConfirm(null)}
				onConfirm={() => action("submit")}
			/>
			<ConfirmDialog
				locale={locale}
				open={confirm === "revise"}
				title={t.revise}
				body={t.reviseHelp}
				confirmLabel={t.revise}
				busy={state.busy}
				onCancel={() => setConfirm(null)}
				onConfirm={() => action("revise")}
			/>
		</section>
	);
}
