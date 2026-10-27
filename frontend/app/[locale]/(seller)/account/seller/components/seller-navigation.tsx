"use client";
import Link from "next/link";
import { accountSettingsCopy } from "../../../../../../lib/i18n/account-settings";
import { useState, useEffect, useRef } from "react";
import {
	inventoryRequest,
	type StockProfiles,
} from "../../../../../../features/inventory/api/inventory";
import { usePathname, useSearchParams } from "next/navigation";
import type { Locale } from "../../../../../../lib/i18n/locales";
import { inventoryCopy } from "../../../../../../lib/i18n/inventory";
import { sellerHref } from "../../../../../../lib/routes/account-routes";
import { Icon, type IconName } from "../../../../../../components/ui/icon";
export function SellerNavigation({ locale }: { locale: Locale }) {
	const details = useRef<HTMLDetailsElement>(null);
	const t = inventoryCopy[locale],
		path = usePathname(),
		seller = useSearchParams().get("seller");
	const [caps, setCaps] = useState<{ read: boolean; write: boolean } | null>(
		null,
	);
	useEffect(() => {
		let current = true;
		setCaps(null);
		const refresh = () => {
			void inventoryRequest<StockProfiles>("seller/profiles/")
				.then((value) => {
					if (!current) return;
					const profile = seller
						? value.profiles.find((p) => p.id === seller)
						: value.profiles[0];
					setCaps(profile?.capabilities ?? null);
				})
				.catch(() => {
					if (current) setCaps(null);
				});
		};
		refresh();
		window.addEventListener("focus", refresh);
		return () => {
			current = false;
			window.removeEventListener("focus", refresh);
		};
	}, [seller]);
	const links: [string, string, IconName][] = [
		["", t.overview, "home"],
		["catalogue", t.products, "box"],
		["inventory", t.inventory, "store"],
		["inventory/movements", t.movements, "file"],
		["organizations", t.organization, "team"],
		["profile", t.profile, "user"],
		["settings", accountSettingsCopy[locale].title, "user"],
		["password", t.password, "lock"],
		["link", t.link, "user"],
	];
	const navigation = (
		<nav aria-label={t.menu} className="space-y-1">
			{links
				.filter(([route]) =>
					route === "catalogue"
						? caps?.write
						: ["inventory", "inventory/movements"].includes(route)
							? caps?.read
							: true,
				)
				.map(([route, label, icon]) => (
					<Link
						key={route}
						onClick={() => {
							if (details.current) details.current.open = false;
						}}
						href={sellerHref(locale, route, seller)}
						aria-current={
							path === sellerHref(locale, route) ||
							(route === "inventory" &&
								path.includes("/inventory/") &&
								!path.endsWith("/movements"))
								? "page"
								: undefined
						}
						className="flex min-h-12 items-center gap-3 rounded-control px-3 py-3 text-sm font-semibold text-foreground no-underline hover:bg-info aria-[current=page]:bg-info aria-[current=page]:text-action"
					>
						<Icon name={icon} />
						{label}
					</Link>
				))}
		</nav>
	);
	return (
		<aside className="min-w-0 self-start rounded-card border border-border bg-surface p-3 desktop:sticky desktop:top-5">
			<div className="hidden desktop:block">{navigation}</div>
			<details
				ref={details}
				className="desktop:hidden"
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						e.preventDefault();
						if (details.current) {
							details.current.open = false;
							details.current.querySelector("summary")?.focus();
						}
					}
				}}
			>
				<summary className="cursor-pointer p-2 font-bold">{t.menu}</summary>
				{navigation}
			</details>
		</aside>
	);
}
