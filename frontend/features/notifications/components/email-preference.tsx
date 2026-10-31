"use client";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { notification, type Preference } from "../api";
import type { Context } from "../../messaging/api";
import { communicationCopy } from "../../messaging/copy";
import { action, Failure } from "../../messaging/components/controls";
import { accessLost, useCommunicationSession } from "../../messaging/hooks";
function PreferenceEditor({
	locale,
	context,
}: {
	locale: Locale;
	context: Context;
}) {
	const t = communicationCopy[locale],
		[pref, setPref] = useState<Preference | null>(null),
		[enabled, setEnabled] = useState(true),
		[error, setError] = useState<unknown>(null),
		[notice, setNotice] = useState(""),
		[busy, setBusy] = useState(false),
		[denied, setDenied] = useState(false);
	const live = useRef<object | null>({}),
		write = useRef<object | null>(null);
	useEffect(() => {
		live.current = {};
		const mine = live.current,
			controller = new AbortController();
		void notification<Preference>(context, "preferences/", undefined, "GET", {
			signal: controller.signal,
		})
			.then((value) => {
				if (mine && live.current === mine) {
					setPref(value);
					setEnabled(value.message_email);
				}
			})
			.catch((error) => {
				if (mine && live.current === mine) {
					if (accessLost(error)) setDenied(true);
					else setError(error);
				}
			});
		return () => {
			live.current = null;
			write.current = null;
			controller.abort();
		};
	}, [context]);
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
					<form
						className="space-y-3"
						onSubmit={(event) => {
							event.preventDefault();
							if (write.current) return;
							const owner = {};
							write.current = owner;
							const mine = live.current;
							setBusy(true);
							setNotice("");
							setError(null);
							void notification<Preference>(
								context,
								"preferences/",
								{ message_email: enabled, locale, version: pref.version },
								"PATCH",
							)
								.then((value) => {
									if (
										mine &&
										live.current === mine &&
										write.current === owner
									) {
										setPref(value);
										setNotice(t.preferenceSaved);
									}
								})
								.catch((error) => {
									if (
										mine &&
										live.current === mine &&
										write.current === owner
									) {
										if (accessLost(error)) {
											setPref(null);
											setDenied(true);
										}
										setError(error);
									}
								})
								.finally(() => {
									if (
										mine &&
										live.current === mine &&
										write.current === owner
									) {
										write.current = null;
										setBusy(false);
									}
								});
						}}
					>
						<label className="flex min-h-11 items-center gap-3">
							<input
								type="checkbox"
								checked={enabled}
								disabled={busy}
								onChange={(e) => setEnabled(e.target.checked)}
							/>
							{t.emailEnabled}
						</label>
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

export function EmailPreference({
	locale,
	context,
}: {
	locale: Locale;
	context: Context;
}) {
	const session = useCommunicationSession(context);
	if (session.loading)
		return <p role="status">{communicationCopy[locale].loading}</p>;
	if (!session.session)
		return accessLost(session.error) ? null : (
			<Failure locale={locale} error={session.error} />
		);
	return (
		<PreferenceEditor
			key={`${locale}:${context}:${session.session.identity.id}:${session.session.accounts[0].id}`}
			locale={locale}
			context={context}
		/>
	);
}
