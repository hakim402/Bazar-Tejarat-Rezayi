"use client";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type FormEvent,
} from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { paymentCopy } from "../../payments/copy";
import { aftercareCopy } from "../../aftercare/copy";
import { notification, type Preference } from "../api";
import type { Context } from "../../messaging/api";
import { communicationCopy } from "../../messaging/copy";
import { Failure } from "../../messaging/components/controls";
import { accessLost, useCommunicationSession } from "../../messaging/hooks";
import { BusinessSection } from "../../../components/accounts/seller-settings-ui";
import { sellerSettingsCopy } from "../../../lib/i18n/seller-settings";
import { sellerAccountSettingsCopy } from "../../../lib/i18n/seller-account-settings";
import { authCopy } from "../../../lib/i18n/auth";
import toast from "react-hot-toast";
import { Label } from "../../../components/shadcn/label";
import { Button as ShadcnButton } from "../../../components/shadcn/button";
import { Card } from "../../../components/shadcn/card";
import { Icon } from "../../../components/ui/icon";
import { Switch } from "../../../components/shadcn/switch";
import { accountSettingsCopy } from "../../../lib/i18n/account-settings";
import { salesTableCard } from "../../sales/components/seller-sales-ui";
type PreferenceProps = {
	locale: Locale;
	context: Context;
	sellerSettings?: boolean;
	onDirtyChange?: (dirty: boolean) => void;
	onNavigate?: (next: () => void) => void;
};
function PreferenceEditor({
	locale,
	context,
	sellerSettings = false,
	onDirtyChange,
	onNavigate,
}: PreferenceProps) {
	const sellerMode = sellerSettings && context === "seller";
	const s = sellerSettingsCopy[locale],
		copy = sellerAccountSettingsCopy[locale];
	const [reading, setReading] = useState(true),
		[reloadCount, setReloadCount] = useState(0);
	const dirtyCallback = useRef(onDirtyChange);
	dirtyCallback.current = onDirtyChange;
	const t = communicationCopy[locale],
		[pref, setPref] = useState<Preference | null>(null),
		[enabled, setEnabled] = useState(true),
		[paymentEnabled, setPaymentEnabled] = useState(true),
		[aftercareEnabled, setAftercareEnabled] = useState(true),
		[error, setError] = useState<unknown>(null),
		[notice, setNotice] = useState(""),
		[busy, setBusy] = useState(false),
		[denied, setDenied] = useState(false);
	const live = useRef<object | null>({}),
		write = useRef<object | null>(null);
	const dirty =
		!!pref &&
		(enabled !== pref.message_email ||
			paymentEnabled !== pref.payment_email ||
			aftercareEnabled !== pref.aftercare_email);
	useEffect(() => {
		onDirtyChange?.(dirty);
	}, [dirty, onDirtyChange]);
	useEffect(() => () => dirtyCallback.current?.(false), []);
	const accept = (value: Preference) => {
		setPref(value);
		setEnabled(value.message_email);
		setPaymentEnabled(value.payment_email);
		setAftercareEnabled(value.aftercare_email);
		setDenied(false);
	};
	const loseAccess = useCallback(() => {
		setPref(null);
		setEnabled(true);
		setPaymentEnabled(true);
		setAftercareEnabled(true);
		setNotice("");
		setDenied(true);
		dirtyCallback.current?.(false);
	}, []);
	useEffect(() => {
		void reloadCount;
		live.current = {};
		setReading(true);
		setError(null);
		setNotice("");
		const mine = live.current,
			controller = new AbortController();
		void notification<Preference>(context, "preferences/", undefined, "GET", {
			signal: controller.signal,
		})
			.then((value) => {
				if (mine && live.current === mine) {
					setPref(value);
					setEnabled(value.message_email);
					setPaymentEnabled(value.payment_email);
					setAftercareEnabled(value.aftercare_email);
					setDenied(false);
				}
			})
			.catch((error) => {
				if (mine && live.current === mine) {
					if (accessLost(error)) loseAccess();
					else setError(error);
				}
			})
			.finally(() => {
				if (mine && live.current === mine) setReading(false);
			});
		return () => {
			live.current = null;
			write.current = null;
			controller.abort();
		};
	}, [context, reloadCount, loseAccess]);
	const reload = () => {
		if (busy || reading || write.current) return;
		const mine = live.current;
		const next = () => {
			if (mine && live.current === mine) setReloadCount((value) => value + 1);
		};
		if (onNavigate) onNavigate(next);
		else next();
	};
	const save = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (write.current || reading || denied || !pref || !live.current) return;
		const owner = {},
			mine = live.current;
		write.current = owner;
		setBusy(true);
		setNotice("");
		setError(null);
		const owns = () => live.current === mine && write.current === owner;
		void notification<Preference>(
			context,
			"preferences/",
			{
				message_email: enabled,
				payment_email: paymentEnabled,
				aftercare_email: aftercareEnabled,
				locale,
				version: pref.version,
			},
			"PATCH",
		)
			.then((value) => {
				if (owns()) {
					if (sellerMode) accept(value);
					else setPref(value);
					toast.success(t.preferenceSaved);
					dirtyCallback.current?.(false);
					setNotice(t.preferenceSaved);
				}
			})
			.catch((failure) => {
				if (owns()) {
					if (accessLost(failure)) loseAccess();
					setError(failure);
					toast.error(t.preferenceFailed);
				}
			})
			.finally(() => {
				if (owns()) {
					write.current = null;
					setBusy(false);
				}
			});
	};
	if (sellerMode)
		return (
			<BusinessSection
				id="email-notifications"
				title={s.notifications}
				description={copy.emailScope}
				icon="mail"
			>
				<div className="space-y-4" data-testid="message-email-preference">
					{!!error && <Failure locale={locale} error={error} />}
					{denied && (
						<p role="alert" className="text-sm text-danger">
							{authCopy[locale].denied}
						</p>
					)}
					{reading && <p role="status">{t.loading}</p>}
					{pref && !denied && (
						<form
							onSubmit={save}
							className="space-y-4"
							aria-busy={busy || reading}
						>
							<div className="divide-y divide-border">
								{[
									{
										key: "message",
										icon: "inbox" as const,
										label: t.emailEnabled,
										help: copy.messageHelp,
										checked: enabled,
										update: setEnabled,
									},
									{
										key: "payment",
										icon: "wallet" as const,
										label: paymentCopy[locale].email,
										help: paymentCopy[locale].emailNote,
										checked: paymentEnabled,
										update: setPaymentEnabled,
									},
									{
										key: "aftercare",
										icon: "headset" as const,
										label: aftercareCopy[locale].email,
										help: aftercareCopy[locale].emailNote,
										checked: aftercareEnabled,
										update: setAftercareEnabled,
									},
								].map((row) => (
									<div
										key={row.key}
										className="flex min-w-0 items-start gap-3 py-4 first:pt-0 last:pb-0"
									>
										<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-page text-muted">
											<Icon name={row.icon} className="size-4" />
										</span>
										<div className="min-w-0 flex-1">
											<Label
												htmlFor={`seller-email-${row.key}`}
												className="m-0 block cursor-pointer text-sm font-medium leading-6"
											>
												{row.label}
											</Label>
											<p
												id={`seller-email-${row.key}-help`}
												className="m-0 text-xs text-muted"
											>
												{row.help}
											</p>
										</div>
										<span className="flex shrink-0 items-center pt-1">
											<Switch
												id={`seller-email-${row.key}`}
												name={`${row.key}_email`}
												aria-describedby={`seller-email-${row.key}-help`}
												checked={row.checked}
												disabled={busy || reading}
												onCheckedChange={(checked) => {
													row.update(checked === true);
													setNotice("");
												}}
											/>
										</span>
									</div>
								))}
							</div>
							<p className="m-0 text-xs text-muted">{s.securityEmail}</p>
							<div className="flex flex-wrap items-center justify-between gap-4 border-0 border-t border-solid border-border pt-4">
								<span className="text-sm text-muted">
									{dirty ? s.unsaved : ""}
								</span>
								<div className="flex flex-wrap items-center gap-2">
									<ShadcnButton
										type="button"
										variant="outline"
										size="sm"
										onClick={reload}
										disabled={busy || reading}
									>
										{s.reload}
									</ShadcnButton>
									<ShadcnButton
										type="submit"
										size="sm"
										disabled={busy || reading || !dirty}
									>
										{busy ? t.sending : t.savePreference}
									</ShadcnButton>
								</div>
							</div>
						</form>
					)}
					{!pref && !reading && (
						<ShadcnButton
							type="button"
							variant="outline"
							size="sm"
							onClick={reload}
						>
							{authCopy[locale].retry}
						</ShadcnButton>
					)}
					{notice && <p role="status">{notice}</p>}
				</div>
			</BusinessSection>
		);
	if (denied) return null;
	const account = accountSettingsCopy[locale];
	const rows = [
		{
			key: "message",
			icon: "inbox",
			label: t.emailEnabled,
			help: copy.messageHelp,
			checked: enabled,
			update: setEnabled,
		},
		{
			key: "payment",
			icon: "wallet",
			label: paymentCopy[locale].email,
			help: paymentCopy[locale].emailNote,
			checked: paymentEnabled,
			update: setPaymentEnabled,
		},
		{
			key: "aftercare",
			icon: "headset",
			label: aftercareCopy[locale].email,
			help: aftercareCopy[locale].emailNote,
			checked: aftercareEnabled,
			update: setAftercareEnabled,
		},
	] as const;
	return (
		<Card
			className={salesTableCard}
			role="region"
			aria-labelledby="buyer-email-preferences-heading"
			data-testid="message-email-preference"
		>
			<div className="border-0 border-b border-solid border-border px-4 py-4 sm:px-5">
				<h2
					id="buyer-email-preferences-heading"
					className="m-0 text-base font-semibold"
				>
					{account.emailTitle}
				</h2>
				<p className="m-0 text-xs text-muted">{account.emailHelp}</p>
			</div>
			<div className="space-y-4 px-4 py-4 sm:px-5">
				{!!error && <Failure locale={locale} error={error} />}
				{reading && !pref && (
					<p role="status" className="m-0 text-sm text-muted">
						{t.loading}
					</p>
				)}
				{pref && (
					<form
						onSubmit={save}
						aria-busy={busy || reading}
						className="space-y-4"
					>
						<div className="divide-y divide-border">
							{rows.map((row) => (
								<div
									key={row.key}
									className="flex items-start gap-3 py-4 first:pt-0 last:pb-0"
								>
									<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-page text-muted">
										<Icon name={row.icon} className="size-4" />
									</span>
									<div className="min-w-0 flex-1">
										<label
											htmlFor={`buyer-email-${row.key}`}
											className="m-0 block cursor-pointer text-sm font-medium leading-6"
										>
											{row.label}
										</label>
										<p
											id={`buyer-email-${row.key}-help`}
											className="m-0 text-xs text-muted"
										>
											{row.help}
										</p>
									</div>
									<Switch
										id={`buyer-email-${row.key}`}
										name={`${row.key}_email`}
										aria-describedby={`buyer-email-${row.key}-help`}
										checked={row.checked}
										disabled={busy || reading}
										onCheckedChange={(checked) => {
											row.update(checked === true);
											setNotice("");
										}}
									/>
								</div>
							))}
						</div>
						<p className="m-0 text-xs text-muted">{s.securityEmail}</p>
						<div className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-border pt-4">
							<p role="status" className="m-0 min-h-5 text-sm text-success">
								{notice}
							</p>
							<div className="flex flex-wrap items-center gap-2">
								<ShadcnButton
									type="button"
									variant="outline"
									size="sm"
									onClick={reload}
									disabled={busy || reading}
								>
									{account.reload}
								</ShadcnButton>
								<ShadcnButton
									type="submit"
									size="sm"
									disabled={busy || reading || !dirty}
								>
									{busy ? t.sending : t.savePreference}
								</ShadcnButton>
							</div>
						</div>
					</form>
				)}
				{!pref && !reading && (
					<ShadcnButton
						type="button"
						variant="outline"
						size="sm"
						onClick={reload}
					>
						{authCopy[locale].retry}
					</ShadcnButton>
				)}
			</div>
		</Card>
	);
}

export function EmailPreference(props: PreferenceProps) {
	const [attempt, setAttempt] = useState(0);
	const dirtyCallback = useRef(props.onDirtyChange);
	dirtyCallback.current = props.onDirtyChange;
	useEffect(() => {
		dirtyCallback.current?.(false);
		return () => dirtyCallback.current?.(false);
	}, []);
	return (
		<SessionPreference
			key={attempt}
			{...props}
			onRetry={() => setAttempt((value) => value + 1)}
		/>
	);
}
function SessionPreference({
	locale,
	context,
	onRetry,
	...props
}: PreferenceProps & { onRetry: () => void }) {
	const session = useCommunicationSession(context);
	if (session.loading)
		return <p role="status">{communicationCopy[locale].loading}</p>;
	if (!session.session) {
		if (props.sellerSettings && context === "seller")
			return (
				<BusinessSection
					title={sellerSettingsCopy[locale].notifications}
					description={sellerAccountSettingsCopy[locale].emailScope}
					icon="mail"
				>
					<p role="alert" className="text-sm text-danger">
						{accessLost(session.error)
							? authCopy[locale].denied
							: authCopy[locale].unavailable}
					</p>
					<ShadcnButton
						type="button"
						variant="outline"
						size="sm"
						onClick={onRetry}
					>
						{authCopy[locale].retry}
					</ShadcnButton>
				</BusinessSection>
			);
		return accessLost(session.error) ? null : (
			<Failure locale={locale} error={session.error} />
		);
	}
	return (
		<PreferenceEditor
			key={`${locale}:${context}:${session.session.identity.id}:${session.session.accounts[0].id}`}
			locale={locale}
			context={context}
			{...props}
		/>
	);
}
