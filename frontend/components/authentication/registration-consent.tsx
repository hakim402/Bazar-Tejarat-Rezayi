"use client";
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { privateCall } from "@/lib/api/private-client";
import { authFeedback } from "@/lib/i18n/auth-feedback";
import { authCopy } from "@/lib/i18n/auth";
import type { Locale } from "@/lib/i18n/locales";
import { Checkbox } from "../shadcn/checkbox";
import { Button } from "../shadcn/button";

type Configuration =
	import("@/lib/api/schema.d").components["schemas"]["AuthConfiguration"];
export function RegistrationConsent({
	locale,
	disabled,
	error,
}: {
	locale: Locale;
	disabled?: boolean;
	error?: string;
}) {
	const id = useId(),
		t = authFeedback[locale];
	const [configuration, setConfiguration] = useState<Configuration>();
	const [failed, setFailed] = useState(false),
		[attempt, setAttempt] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly reloads the configuration.
	useEffect(() => {
		const controller = new AbortController();
		setFailed(false);
		void privateCall<Configuration>(
			`configuration/?locale=${locale}`,
			"GET",
			undefined,
			null,
			"auth/",
			{ signal: controller.signal },
		)
			.then(setConfiguration)
			.catch(() => {
				if (!controller.signal.aborted) setFailed(true);
			});
		return () => controller.abort();
	}, [locale, attempt]);
	return (
		<div className="space-y-3 text-xs leading-relaxed">
			<div className="flex items-start gap-2">
				<Checkbox
					id={id}
					name="consent"
					required
					disabled={disabled}
					aria-invalid={!!error}
					aria-describedby={error ? `${id}-error` : undefined}
					className="mt-0.5"
				/>
				<label htmlFor={id}>
					{configuration?.development ? authCopy[locale].consent : t.terms}
				</label>
			</div>
			{error && (
				<p id={`${id}-error`} className="m-0 text-danger" role="alert">
					{error}
				</p>
			)}
			{configuration?.development && (
				<p className="m-0 text-muted">{authCopy[locale].policy}</p>
			)}
			{!!configuration?.policies.length && (
				<nav aria-label={t.legal} className="flex flex-wrap gap-x-4 gap-y-2">
					{configuration.policies
						.filter(
							(p) => /^\/[a-z0-9/-]*$/.test(p.path) && !p.path.startsWith("//"),
						)
						.map((p) => (
							<Link
								key={p.path}
								href={`/${locale}${p.path}`}
								target="_blank"
								rel="noopener noreferrer"
							>
								<bdi dir="auto">{p.title}</bdi>
							</Link>
						))}
				</nav>
			)}
			{(failed ||
				(configuration &&
					!configuration.development &&
					!configuration.policies.length)) && (
				<p className="m-0 text-muted">
					{t.policiesUnavailable}{" "}
					{failed && (
						<Button
							type="button"
							variant="link"
							size="sm"
							onClick={() => setAttempt((v) => v + 1)}
						>
							{authCopy[locale].retry}
						</Button>
					)}
				</p>
			)}
			{configuration && !configuration.signup_enabled && (
				<p role="status" className="m-0 text-muted">
					{authCopy[locale].registrationClosed}
				</p>
			)}
		</div>
	);
}
