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
import { action, Failure } from "../../messaging/components/controls";
import { accessLost, useCommunicationSession } from "../../messaging/hooks";
import {
	SettingsSection,
	SettingsActions,
} from "../../../components/accounts/seller-settings-ui";
import { sellerSettingsCopy } from "../../../lib/i18n/seller-settings";
import { sellerAccountSettingsCopy } from "../../../lib/i18n/seller-account-settings";
import { authCopy } from "../../../lib/i18n/auth";
import { Button } from "../../../components/ui/button";
import { toggleClass } from "../../../components/ui/form-field";
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
					dirtyCallback.current?.(false);
					setNotice(t.preferenceSaved);
				}
			})
			.catch((failure) => {
				if (owns()) {
					if (accessLost(failure)) loseAccess();
					setError(failure);
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
			<SettingsSection
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
							className="space-y-5"
							aria-busy={busy || reading}
						>
							<div className="divide-y divide-border">
								{[
									{
										key: "message",
										label: t.emailEnabled,
										help: copy.messageHelp,
										checked: enabled,
										update: setEnabled,
									},
									{
										key: "payment",
										label: paymentCopy[locale].email,
										help: paymentCopy[locale].emailNote,
										checked: paymentEnabled,
										update: setPaymentEnabled,
									},
									{
										key: "aftercare",
										label: aftercareCopy[locale].email,
										help: aftercareCopy[locale].emailNote,
										checked: aftercareEnabled,
										update: setAftercareEnabled,
									},
								].map((row) => (
									<div
										key={row.key}
										className="flex min-w-0 items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
									>
										<div className="min-w-0">
											<label
												htmlFor={`seller-email-${row.key}`}
												className="flex min-h-11 items-center text-base font-semibold"
											>
												{row.label}
											</label>
											<p
												id={`seller-email-${row.key}-help`}
												className="text-sm leading-relaxed text-muted"
											>
												{row.help}
											</p>
										</div>
										<span className="flex min-h-11 shrink-0 items-center">
											<input
												id={`seller-email-${row.key}`}
												name={`${row.key}_email`}
												type="checkbox"
												role="switch"
												aria-checked={row.checked}
												aria-describedby={`seller-email-${row.key}-help`}
												className={toggleClass}
												checked={row.checked}
												disabled={busy || reading}
												onChange={(event) => {
													row.update(event.target.checked);
													setNotice("");
												}}
											/>
										</span>
									</div>
								))}
							</div>
							<p className="text-sm leading-relaxed text-muted">
								{s.securityEmail}
							</p>
							<SettingsActions locale={locale} dirty={dirty}>
								<Button
									type="button"
									variant="secondary"
									onClick={reload}
									disabled={busy || reading}
								>
									{s.reload}
								</Button>
								<Button type="submit" disabled={busy || reading || !dirty}>
									{busy ? t.sending : t.savePreference}
								</Button>
							</SettingsActions>
						</form>
					)}
					{!pref && !reading && (
						<Button type="button" variant="secondary" onClick={reload}>
							{authCopy[locale].retry}
						</Button>
					)}
					{notice && <p role="status">{notice}</p>}
				</div>
			</SettingsSection>
		);
	if (denied) return null;
	return (
		<section
			className="space-y-3 rounded-card border border-border bg-surface p-5"
			aria-label={t.optionalEmail}
			data-testid="message-email-preference"
		>
			<h2 className="text-xl font-bold">{t.optionalEmail}</h2>
			<p className="text-sm text-muted">{t.emailHelp}</p>
			{!!error && <Failure locale={locale} error={error} />}{" "}
			{!pref && !error ? (
				<p role="status">{t.loading}</p>
			) : (
				pref && (
					<form className="space-y-3" onSubmit={save}>
						<label className="flex min-h-11 items-center gap-3">
							<input
								type="checkbox"
								className={
									context === "seller"
										? "relative h-6 w-11 shrink-0 appearance-none rounded-full border border-control bg-control before:absolute before:start-0.5 before:top-0.5 before:size-4.5 before:rounded-full before:bg-surface before:content-[''] checked:border-primary checked:bg-primary checked:before:start-5.5 disabled:cursor-not-allowed disabled:opacity-50 transition-colors duration-150 motion-reduce:transition-none"
										: undefined
								}
								checked={enabled}
								disabled={busy}
								onChange={(e) => setEnabled(e.target.checked)}
							/>
							{t.emailEnabled}
						</label>
						<label className="flex min-h-11 items-center gap-3">
							<input
								type="checkbox"
								className={
									context === "seller"
										? "relative h-6 w-11 shrink-0 appearance-none rounded-full border border-control bg-control before:absolute before:start-0.5 before:top-0.5 before:size-4.5 before:rounded-full before:bg-surface before:content-[''] checked:border-primary checked:bg-primary checked:before:start-5.5 disabled:cursor-not-allowed disabled:opacity-50 transition-colors duration-150 motion-reduce:transition-none"
										: undefined
								}
								checked={paymentEnabled}
								disabled={busy}
								onChange={(e) => setPaymentEnabled(e.target.checked)}
							/>
							{paymentCopy[locale].email}
						</label>
						<p className="text-sm text-muted">
							{paymentCopy[locale].emailNote}
						</p>
						<label className="flex min-h-11 items-center gap-3">
							<input
								type="checkbox"
								className={
									context === "seller"
										? "relative h-6 w-11 shrink-0 appearance-none rounded-full border border-control bg-control before:absolute before:start-0.5 before:top-0.5 before:size-4.5 before:rounded-full before:bg-surface before:content-[''] checked:border-primary checked:bg-primary checked:before:start-5.5 disabled:cursor-not-allowed disabled:opacity-50 transition-colors duration-150 motion-reduce:transition-none"
										: undefined
								}
								checked={aftercareEnabled}
								disabled={busy}
								onChange={(e) => setAftercareEnabled(e.target.checked)}
							/>
							{aftercareCopy[locale].email}
						</label>
						<p className="text-sm text-muted">
							{aftercareCopy[locale].emailNote}
						</p>
						<button type="submit" className={action} disabled={busy}>
							{busy ? t.sending : t.savePreference}
						</button>
					</form>
				)
			)}
			{notice && <p role="status">{notice}</p>}
		</section>
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
				<SettingsSection
					title={sellerSettingsCopy[locale].notifications}
					description={sellerAccountSettingsCopy[locale].emailScope}
					icon="mail"
				>
					<p role="alert" className="text-sm text-danger">
						{accessLost(session.error)
							? authCopy[locale].denied
							: authCopy[locale].unavailable}
					</p>
					<Button type="button" variant="secondary" onClick={onRetry}>
						{authCopy[locale].retry}
					</Button>
				</SettingsSection>
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
