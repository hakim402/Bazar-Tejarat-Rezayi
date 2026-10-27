"use client";
import Link from "next/link";
import { Button } from "../../../../../../components/ui/button";
import { useState, useEffect } from "react";
import type { Locale } from "../../../../../../lib/i18n/locales";
import { accessCopy } from "../../../../../../lib/i18n/access";
import { inventoryCopy } from "../../../../../../lib/i18n/inventory";
import {
	authMutation,
	accountSession,
	ACCOUNT_SESSION_CHANGED,
} from "../../../../../../features/identity/api/accounts";
import { useNavigation } from "../../../../../../components/layout/navigation-guard";
export function SellerAccount({ locale }: { locale: Locale }) {
	const [active, setActive] = useState(false);
	useEffect(() => {
		let current = true;
		const refresh = () => {
			void accountSession("seller")
				.then(() => {
					if (current) setActive(true);
				})
				.catch(() => {
					if (current) setActive(false);
				});
		};
		refresh();
		window.addEventListener("focus", refresh);
		window.addEventListener(ACCOUNT_SESSION_CHANGED, refresh);
		return () => {
			current = false;
			window.removeEventListener("focus", refresh);
			window.removeEventListener(ACCOUNT_SESSION_CHANGED, refresh);
		};
	}, []);
	const t = inventoryCopy[locale],
		navigate = useNavigation(),
		[busy, setBusy] = useState(false),
		[error, setError] = useState(false);
	return (
		<div className="flex flex-wrap items-center gap-3 text-sm">
			{active ? (
				<Link href={`/${locale}/account/seller/profile`}>{t.profile}</Link>
			) : (
				<Link href={`/${locale}/auth/seller-sign-in`}>
					{accessCopy[locale].login}
				</Link>
			)}
			{active && (
				<Button
					variant="secondary"
					compact
					type="button"
					disabled={busy}
					className="mt-0"
					onClick={() =>
						navigate(() => {
							setBusy(true);
							void authMutation("seller/logout/")
								.then(() => location.assign(`/${locale}`))
								.catch(() => {
									setError(true);
									setBusy(false);
								});
						})
					}
				>
					{t.logout}
				</Button>
			)}
			{error && <span role="alert">{t.unavailable}</span>}
		</div>
	);
}
