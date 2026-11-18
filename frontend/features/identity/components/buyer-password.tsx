"use client";
import Link from "next/link";
import {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	type FormEvent,
	type ReactNode,
} from "react";
import toast from "react-hot-toast";
import { Button } from "../../../components/shadcn/button";
import { Card } from "../../../components/shadcn/card";
import { Input } from "../../../components/shadcn/input";
import { Icon } from "../../../components/ui/icon";
import { salesTableCard } from "../../sales/components/seller-sales-ui";
import { DetailDialog } from "../../orders/components/detail-dialog";
import { FormActions, FormField } from "../../../components/ui/dialog-form";
import { buyerPasswordCopy } from "../../../lib/i18n/buyer-password";
import { authCopy } from "../../../lib/i18n/auth";
import type { Locale } from "../../../lib/i18n/locales";
import { AccountError, accountSession, authMutation } from "../api/accounts";

function PasswordField({
	id,
	label,
	value,
	autoComplete,
	minLength,
	help,
	error,
	disabled,
	showLabel,
	hideLabel,
	onChange,
}: {
	id: string;
	label: string;
	value: string;
	autoComplete: string;
	minLength?: number;
	help?: string;
	error?: string;
	disabled: boolean;
	showLabel: string;
	hideLabel: string;
	onChange: (value: string) => void;
}) {
	const [revealed, setRevealed] = useState(false);
	useEffect(() => {
		if (!value) setRevealed(false);
	}, [value]);
	return (
		<FormField
			id={id}
			label={label}
			required
			help={help}
			error={error}
			valid={value.length >= (minLength ?? 1)}
			trailing={
				<Button
					type="button"
					variant="ghost"
					size="icon"
					disabled={disabled}
					aria-label={revealed ? hideLabel : showLabel}
					title={revealed ? hideLabel : showLabel}
					aria-pressed={revealed}
					onClick={() => setRevealed((current) => !current)}
					className="size-7"
				>
					<Icon
						name="eye"
						className={revealed ? "size-4" : "size-4 text-muted"}
					/>
				</Button>
			}
		>
			<Input
				id={id}
				type={revealed ? "text" : "password"}
				dir="ltr"
				value={value}
				required
				minLength={minLength}
				maxLength={128}
				autoComplete={autoComplete}
				disabled={disabled}
				aria-invalid={!!error}
				aria-describedby={
					error ? `${id}-error` : help ? `${id}-help` : undefined
				}
				onChange={(event) => onChange(event.target.value)}
			/>
		</FormField>
	);
}

function usePasswordChange(locale: Locale) {
	const t = buyerPasswordCopy[locale],
		a = authCopy[locale];
	const mounted = useRef(true),
		doneRef = useRef(false);
	const [ready, setReady] = useState(false),
		[loading, setLoading] = useState(true),
		[loadError, setLoadError] = useState(""),
		[done, setDone] = useState(false),
		[busy, setBusy] = useState(false),
		[formError, setFormError] = useState(""),
		[fieldErrors, setFieldErrors] = useState<{
			current?: string;
			next?: string;
			repeat?: string;
		}>({}),
		[draft, setDraft] = useState({ current: "", next: "", repeat: "" });

	const refresh = useCallback(async () => {
		if (doneRef.current) return;
		try {
			await accountSession("buyer");
			if (!mounted.current || doneRef.current) return;
			setReady(true);
			setLoadError("");
		} catch (err) {
			if (!mounted.current || doneRef.current) return;
			setReady(false);
			setLoadError(
				err instanceof AccountError &&
					(err.status === 401 || err.status === 403)
					? a.anonymous
					: a.unavailable,
			);
		} finally {
			if (mounted.current) setLoading(false);
		}
	}, [a]);

	useEffect(() => {
		mounted.current = true;
		const load = () => {
			if (mounted.current) void refresh();
		};
		load();
		window.addEventListener("focus", load);
		return () => {
			mounted.current = false;
			window.removeEventListener("focus", load);
		};
	}, [refresh]);

	const set = (key: "current" | "next" | "repeat", value: string) => {
		setDraft((current) => ({ ...current, [key]: value }));
		setFieldErrors((current) => ({ ...current, [key]: undefined }));
	};

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy) return;
		if (draft.next !== draft.repeat) {
			setFieldErrors((current) => ({ ...current, repeat: a.mismatch }));
			return;
		}
		setBusy(true);
		setFormError("");
		setFieldErrors({});
		try {
			await authMutation("buyer/password/", {
				current_password: draft.current,
				password: draft.next,
			});
			doneRef.current = true;
			setDone(true);
			toast.success(t.toast);
		} catch (err) {
			let message = a.unavailable;
			let inline = false;
			if (err instanceof AccountError) {
				if (err.status === 429) message = a.limited;
				else if (err.code === "csrf_failed") message = a.stale;
				else if (err.status === 403) {
					message = t.currentDenied;
					setFieldErrors({ current: message });
					inline = true;
				} else if (err.status === 400) {
					if (err.fields.includes("password")) {
						message = t.weakPassword;
						setFieldErrors({ next: message });
						inline = true;
					} else message = a.invalid;
				}
			}
			if (!inline) setFormError(message);
			toast.error(message);
		} finally {
			if (mounted.current) setBusy(false);
		}
	}

	return {
		ready,
		loading,
		loadError,
		done,
		busy,
		formError,
		fieldErrors,
		draft,
		set,
		submit,
		refresh,
	};
}

export function BuyerPassword({ locale }: { locale: Locale }) {
	const t = buyerPasswordCopy[locale],
		a = authCopy[locale];
	const base = useId();
	const {
		ready,
		loading,
		loadError,
		done,
		busy,
		formError,
		fieldErrors,
		draft,
		set,
		submit,
		refresh,
	} = usePasswordChange(locale);
	return (
		<div className="min-w-0 space-y-6">
			<header className="space-y-1">
				<h1 className="m-0 text-xl font-semibold tracking-tight">
					{a.passwordChange}
				</h1>
				<p className="m-0 text-sm text-muted">{t.subtitle}</p>
			</header>

			{loading && (
				<p role="status" className="text-sm text-muted">
					{a.loading}
				</p>
			)}
			{loadError && (
				<div
					role="alert"
					className="rounded-xl border border-danger bg-danger-surface px-4 py-3 text-sm text-danger"
				>
					{loadError}
				</div>
			)}

			{done && (
				<Card className={salesTableCard}>
					<div className="flex flex-col items-start gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
						<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success-surface text-success">
							<Icon name="check-circle" className="size-5" />
						</span>
						<div className="min-w-0 flex-1 space-y-1">
							<h2 className="m-0 text-base font-semibold">{t.successTitle}</h2>
							<p className="m-0 text-sm text-muted">{a.passwordUpdated}</p>
						</div>
						<Button asChild>
							<Link href={`/${locale}/auth/buyer-sign-in`}>{a.backSignin}</Link>
						</Button>
					</div>
				</Card>
			)}

			{ready && !done && (
				<>
					<Card className={salesTableCard}>
						<div className="border-0 border-b border-solid border-border px-4 py-4 sm:px-5">
							<h2 className="m-0 text-base font-semibold">{t.formTitle}</h2>
							<p className="m-0 text-xs text-muted">{t.formHelp}</p>
						</div>
						<form
							onSubmit={submit}
							aria-busy={busy}
							className="max-w-md space-y-4 px-4 py-4 sm:px-5"
						>
							{formError && (
								<p
									role="alert"
									className="rounded-lg border border-danger bg-danger-surface px-3 py-2 text-sm text-danger"
								>
									{formError}
								</p>
							)}
							<PasswordField
								id={`${base}-current`}
								label={a.currentPassword}
								value={draft.current}
								autoComplete="current-password"
								error={fieldErrors.current}
								disabled={busy}
								showLabel={t.show}
								hideLabel={t.hide}
								onChange={(value) => set("current", value)}
							/>
							<PasswordField
								id={`${base}-next`}
								label={a.newPassword}
								value={draft.next}
								autoComplete="new-password"
								minLength={12}
								help={a.passwordHelp}
								error={fieldErrors.next}
								disabled={busy}
								showLabel={t.show}
								hideLabel={t.hide}
								onChange={(value) => set("next", value)}
							/>
							<PasswordField
								id={`${base}-repeat`}
								label={a.repeat}
								value={draft.repeat}
								autoComplete="new-password"
								minLength={12}
								error={fieldErrors.repeat}
								disabled={busy}
								showLabel={t.show}
								hideLabel={t.hide}
								onChange={(value) => set("repeat", value)}
							/>
							<FormActions>
								<Button type="submit" disabled={busy}>
									{busy ? a.saving : t.changeAction}
								</Button>
							</FormActions>
						</form>
						<div className="flex items-start gap-2 border-0 border-t border-solid border-border px-4 py-3 sm:px-5">
							<Icon
								name="shield"
								className="mt-0.5 size-4 shrink-0 text-muted"
							/>
							<p className="m-0 text-xs leading-5 text-muted">{a.shared}</p>
						</div>
					</Card>

					<Card className={salesTableCard}>
						<div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
							<div className="flex min-w-0 flex-1 items-center gap-3">
								<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-page text-muted">
									<Icon name="help" className="size-4" />
								</span>
								<div className="min-w-0">
									<p className="m-0 text-sm font-medium">{t.recoveryTitle}</p>
									<p className="m-0 text-xs text-muted">{t.recoveryHelp}</p>
								</div>
							</div>
							<Button
								asChild
								variant="outline"
								size="sm"
								className="ms-12 shrink-0 sm:ms-0"
							>
								<Link href={`/${locale}/auth/forgot-password`}>
									{t.recoveryAction}
								</Link>
							</Button>
						</div>
					</Card>
				</>
			)}

			{!loading && !ready && !done && (
				<div className="flex flex-wrap gap-3">
					<Button asChild variant="secondary">
						<Link href={`/${locale}/auth/buyer-sign-in`}>{a.backSignin}</Link>
					</Button>
					<Button
						type="button"
						variant="outline"
						onClick={() => void refresh()}
					>
						{a.retry}
					</Button>
				</div>
			)}
		</div>
	);
}

export function PasswordDialog({
	locale,
	open,
	onOpenChange,
	trigger,
}: {
	locale: Locale;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	trigger?: ReactNode;
}) {
	const t = buyerPasswordCopy[locale],
		a = authCopy[locale];
	const base = useId();
	const {
		ready,
		loading,
		loadError,
		done,
		busy,
		formError,
		fieldErrors,
		draft,
		set,
		submit,
		refresh,
	} = usePasswordChange(locale);
	return (
		<DetailDialog
			locale={locale}
			title={a.passwordChange}
			icon="shield-lock"
			label={t.changeAction}
			description={t.subtitle}
			open={open}
			onOpenChange={onOpenChange}
			trigger={trigger}
		>
			{loading && (
				<p role="status" className="m-0 text-sm text-muted">
					{a.loading}
				</p>
			)}
			{loadError && (
				<div
					role="alert"
					className="rounded-xl border border-danger bg-danger-surface px-4 py-3 text-sm text-danger"
				>
					{loadError}
				</div>
			)}
			{done && (
				<div className="flex flex-col items-center gap-3 py-2 text-center">
					<span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-success-surface text-success">
						<Icon name="check-circle" className="size-6" />
					</span>
					<div className="space-y-1">
						<h2 className="m-0 text-base font-semibold">{t.successTitle}</h2>
						<p className="m-0 text-sm text-muted">{a.passwordUpdated}</p>
					</div>
					<Button asChild variant="outline" size="sm">
						<Link href={`/${locale}/auth/buyer-sign-in`}>{a.backSignin}</Link>
					</Button>
				</div>
			)}
			{ready && !done && (
				<form onSubmit={submit} aria-busy={busy} className="space-y-4">
					{formError && (
						<p
							role="alert"
							className="rounded-lg border border-danger bg-danger-surface px-3 py-2 text-sm text-danger"
						>
							{formError}
						</p>
					)}
					<PasswordField
						id={`${base}-current`}
						label={a.currentPassword}
						value={draft.current}
						autoComplete="current-password"
						error={fieldErrors.current}
						disabled={busy}
						showLabel={t.show}
						hideLabel={t.hide}
						onChange={(value) => set("current", value)}
					/>
					<div className="grid gap-4 sm:grid-cols-2">
						<PasswordField
							id={`${base}-next`}
							label={a.newPassword}
							value={draft.next}
							autoComplete="new-password"
							minLength={12}
							help={a.passwordHelp}
							error={fieldErrors.next}
							disabled={busy}
							showLabel={t.show}
							hideLabel={t.hide}
							onChange={(value) => set("next", value)}
						/>
						<PasswordField
							id={`${base}-repeat`}
							label={a.repeat}
							value={draft.repeat}
							autoComplete="new-password"
							minLength={12}
							error={fieldErrors.repeat}
							disabled={busy}
							showLabel={t.show}
							hideLabel={t.hide}
							onChange={(value) => set("repeat", value)}
						/>
					</div>
					<FormActions>
						<Button type="submit" disabled={busy}>
							{busy ? a.saving : t.changeAction}
						</Button>
					</FormActions>
					<div className="flex items-start gap-2">
						<Icon name="shield" className="mt-0.5 size-4 shrink-0 text-muted" />
						<p className="m-0 text-xs leading-5 text-muted">{a.shared}</p>
					</div>
					<div className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-border pt-4">
						<div className="flex min-w-0 items-center gap-3">
							<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-page text-muted">
								<Icon name="help" className="size-4" />
							</span>
							<div className="min-w-0">
								<p className="m-0 text-sm font-medium">{t.recoveryTitle}</p>
								<p className="m-0 text-xs text-muted">{t.recoveryHelp}</p>
							</div>
						</div>
						<Button asChild variant="outline" size="sm">
							<Link href={`/${locale}/auth/forgot-password`}>
								{t.recoveryAction}
							</Link>
						</Button>
					</div>
				</form>
			)}
			{!loading && !ready && !done && (
				<div className="flex flex-wrap gap-3">
					<Button asChild variant="secondary">
						<Link href={`/${locale}/auth/buyer-sign-in`}>{a.backSignin}</Link>
					</Button>
					<Button
						type="button"
						variant="outline"
						onClick={() => void refresh()}
					>
						{a.retry}
					</Button>
				</div>
			)}
		</DetailDialog>
	);
}
