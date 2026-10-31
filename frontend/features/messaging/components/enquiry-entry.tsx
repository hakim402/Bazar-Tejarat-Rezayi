"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { accountSession } from "../../identity/api/accounts";
import { AccountError } from "../../../lib/api/private-client";
import type { Locale } from "../../../lib/i18n/locales";
import { communicationCopy } from "../copy";
import { primaryAction, Failure } from "./controls";
export function EnquiryEntry({
	locale,
	product,
}: {
	locale: Locale;
	product: string;
}) {
	const router = useRouter(),
		lock = useRef(false),
		alive = useRef(true),
		[busy, setBusy] = useState(false),
		[error, setError] = useState<unknown>(null),
		t = communicationCopy[locale];
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	return (
		<div className="space-y-3">
			<button
				type="button"
				className={`${primaryAction} w-full`}
				disabled={busy}
				onClick={() => {
					if (lock.current) return;
					lock.current = true;
					setBusy(true);
					const target = `/${locale}/account/buyer/messages?product=${product}`;
					void accountSession("buyer")
						.then(() => {
							if (alive.current) router.push(target);
						})
						.catch((error) => {
							if (!alive.current) return;
							if (
								error instanceof AccountError &&
								[401, 403].includes(error.status ?? 0)
							) {
								const url = new URL(location.href);
								url.searchParams.set("auth", "buyer-sign-in");
								url.searchParams.set("return", target);
								router.push(url.pathname + url.search);
							} else setError(error);
						})
						.finally(() => {
							if (!alive.current) return;
							lock.current = false;
							setBusy(false);
						});
				}}
			>
				{busy ? t.loading : t.enquire}
			</button>
			<p className="text-sm text-muted">{t.enquiryNote}</p>
			{!!error && <Failure locale={locale} error={error} />}
		</div>
	);
}
