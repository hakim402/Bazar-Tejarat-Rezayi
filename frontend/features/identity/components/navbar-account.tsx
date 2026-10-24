"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { accessCopy } from "../../../lib/i18n/access";
import {
	accountSession,
	AccountError,
	ACCOUNT_SESSION_CHANGED,
} from "../api/accounts";
import { Icon } from "../../../components/ui/icon";
import { AccessLink } from "./access-provider";
type Role = "buyer" | "seller";
export function NavbarAccount({ locale }: { locale: Locale }) {
	const t = accessCopy[locale],
		path = usePathname();
	const [roles, setRoles] = useState<Role[]>([]),
		[loading, setLoading] = useState(true),
		[unavailable, setUnavailable] = useState(false);
	useEffect(() => {
		let current = true,
			generation = 0;
		async function refresh() {
			const sequence = ++generation,
				contexts = ["buyer", "seller"] as const;
			const results = await Promise.allSettled(contexts.map(accountSession));
			if (!current || sequence !== generation) return;
			setRoles(
				contexts.filter((_, index) => results[index].status === "fulfilled"),
			);
			setUnavailable(
				results.some(
					(result) =>
						result.status === "rejected" &&
						!(
							result.reason instanceof AccountError &&
							[401, 403].includes(result.reason.status ?? 0)
						),
				),
			);
			setLoading(false);
		}
		void refresh();
		const onFocus = () => {
			if (document.visibilityState === "visible") void refresh();
		};
		window.addEventListener("focus", onFocus);
		window.addEventListener(ACCOUNT_SESSION_CHANGED, onFocus);
		return () => {
			current = false;
			window.removeEventListener("focus", onFocus);
			window.removeEventListener(ACCOUNT_SESSION_CHANGED, onFocus);
		};
	}, []);
	if (loading)
		return (
			<span
				role="status"
				className="flex size-10 items-center justify-center text-muted"
			>
				<span className="sr-only">{t.checking}</span>
				<Icon
					name="user"
					className="size-5 animate-pulse motion-reduce:animate-none"
				/>
			</span>
		);
	if (roles.length) {
		const preferred =
			path.includes("/account/seller") || path.endsWith("/sell")
				? "seller"
				: "buyer";
		const role = roles.includes(preferred) ? preferred : roles[0];
		return (
			<Link
				href={`/${locale}/account/${role}`}
				aria-label={t.account}
				className="flex size-10 shrink-0 items-center justify-center rounded-full text-action no-underline hover:bg-info"
			>
				<Icon name="user" className="size-5" />
			</Link>
		);
	}
	return (
		<>
			<AccessLink
				locale={locale}
				screen="buyer-sign-in"
				className="inline-flex min-h-10 shrink-0 items-center rounded-control px-3 text-sm font-semibold text-action no-underline hover:bg-info"
			>
				{t.login}
			</AccessLink>
			{unavailable && (
				<span role="status" className="sr-only">
					{t.unknown}
				</span>
			)}
		</>
	);
}
