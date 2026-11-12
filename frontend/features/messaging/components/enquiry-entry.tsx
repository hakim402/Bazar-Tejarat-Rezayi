"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { accountSession } from "../../identity/api/accounts";
import { AccountError } from "../../../lib/api/private-client";
import type { Locale } from "../../../lib/i18n/locales";
import { communicationCopy } from "../copy";
import { action, Failure } from "./controls";
import { Icon } from "../../../components/ui/icon";
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
				className={`${action} w-full gap-2`}
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
				<Icon name="mail" className="size-4" />
				{busy ? t.loading : t.enquire}
			</button>
			<p className="text-xs text-muted">{t.enquiryNote}</p>
			{!!error && <Failure locale={locale} error={error} />}
		</div>
	);
}
