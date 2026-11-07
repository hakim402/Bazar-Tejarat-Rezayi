"use client";
import { fulfilment } from "../../../../../../features/fulfilment/api";
import { fulfilmentCopy } from "../../../../../../features/fulfilment/copy";
import { paymentCopy } from "../../../../../../features/payments/copy";
import { aftercareCopy } from "../../../../../../features/aftercare/copy";
import { negotiationCopy } from "../../../../../../features/negotiations/copy";
import Link from "next/link";
import { commerce, type Profile } from "../../../../../../features/orders/api";
import { ACCOUNT_SESSION_CHANGED } from "../../../../../../features/identity/api/accounts";
import { commerceCopy } from "../../../../../../features/orders/copy";
import { communicationCopy } from "../../../../../../features/messaging/copy";
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

interface NavGroup {
	label: string;
	links: [string, string, IconName, boolean?][];
}

export function SellerNavigation({ locale }: { locale: Locale }) {
	const details = useRef<HTMLDetailsElement>(null);
	const t = inventoryCopy[locale],
		path = usePathname(),
		seller = useSearchParams().get("seller");
	const [caps, setCaps] = useState<{ read: boolean; write: boolean } | null>(
		null,
	);
	const [delivery, setDelivery] = useState<boolean | null>(null);
	const [orderCaps, setOrderCaps] = useState<{
		orders: boolean;
		invoices: boolean;
	} | null>(null);
	useEffect(() => {
		let current = true,
			generation = 0;
		setCaps(null);
		const refresh = () => {
			const mine = ++generation;
			setCaps(null);
			setOrderCaps(null);
			setDelivery(null);
			void fulfilment<{ count: number }>(
				"seller",
				`profiles/${seller ? `?seller=${seller}` : ""}`,
			)
				.then((value) => {
					if (current && mine === generation) setDelivery(value.count > 0);
				})
				.catch(() => {
					if (current && mine === generation) setDelivery(null);
				});
			void commerce<{ results: Profile[] }>("orders/seller/profiles/")
				.then((value) => {
					if (!current || mine !== generation) return;
					const rows = seller
						? value.results.filter((p) => p.id === seller)
						: value.results;
					setOrderCaps({
						orders: rows.some((p) => p.orders),
						invoices: rows.some((p) => p.invoices),
					});
				})
				.catch(() => {
					if (current && mine === generation) setOrderCaps(null);
				});
			void inventoryRequest<StockProfiles>("seller/profiles/")
				.then((value) => {
					if (!current || mine !== generation) return;
					const profile = seller
						? value.profiles.find((p) => p.id === seller)
						: value.profiles[0];
					setCaps(profile?.capabilities ?? null);
				})
				.catch(() => {
					if (current && mine === generation) setCaps(null);
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
	}, [seller]);

	const groups: NavGroup[] = [
		{
			label: t.storeGroup,
			links: [
				["", t.overview, "home"],
				["catalogue", t.products, "box", !!caps?.write],
				["inventory", t.inventory, "store", !!caps?.read],
				["inventory/movements", t.movements, "file", !!caps?.read],
			],
		},
		{
			label: t.salesGroup,
			links: [
				["orders", commerceCopy[locale].orders, "file", !!orderCaps?.orders],
				[
					"negotiations",
					negotiationCopy[locale].title,
					"file",
					!!orderCaps?.orders,
				],
				["fulfilment", fulfilmentCopy[locale].sellerTitle, "box", !!delivery],
				["aftercare", aftercareCopy[locale].sellerTitle, "file"],
				[
					"invoices",
					commerceCopy[locale].invoices,
					"file",
					!!orderCaps?.invoices,
				],
				["payments", paymentCopy[locale].title, "file", !!orderCaps?.invoices],
			],
		},
		{
			label: t.buyersGroup,
			links: [["messages", communicationCopy[locale].messages, "mail"]],
		},
		{
			label: t.businessGroup,
			links: [["organizations", t.organization, "team"]],
		},
		{
			label: t.accountGroup,
			links: [
				["profile", t.profile, "user"],
				["settings", accountSettingsCopy[locale].title, "user"],
				["password", t.password, "lock"],
				["link", t.link, "user"],
			],
		},
	];

	const isActive = (route: string) =>
		path === sellerHref(locale, route) ||
		([
			"negotiations",
			"orders",
			"invoices",
			"payments",
			"fulfilment",
			"aftercare",
			"settings",
		].includes(route) &&
			path.startsWith(`${sellerHref(locale, route)}/`)) ||
		(route === "inventory" &&
			path.includes("/inventory/") &&
			!path.endsWith("/movements"));

	const renderLink = ([route, label, icon, condition]: [
		string,
		string,
		IconName,
		boolean?,
	]) => {
		if (condition === false) return null;
		return (
			<Link
				key={route}
				onClick={() => {
					if (details.current) details.current.open = false;
				}}
				href={sellerHref(locale, route, seller)}
				aria-current={isActive(route) ? "page" : undefined}
				className="flex min-h-11 items-center gap-3 rounded-sm px-3 py-2.5 text-body font-medium text-foreground no-underline transition-colors motion-reduce:transition-none hover:bg-info aria-[current=page]:bg-brand-soft aria-[current=page]:text-action aria-[current=page]:font-semibold"
			>
				<Icon name={icon} className="size-5 shrink-0" />
				<span className="min-w-0 flex-1 truncate">{label}</span>
			</Link>
		);
	};

	const navigation = (
		<nav aria-label={t.menu} className="space-y-4 py-2">
			{groups.map((group) => {
				const visibleLinks = group.links.filter(
					([, , , condition]) => condition !== false,
				);
				if (!visibleLinks.length) return null;
				return (
					<div key={group.label}>
						<p className="px-3 pb-1.5 text-caption font-semibold uppercase tracking-wide text-muted">
							{group.label}
						</p>
						<div className="space-y-0.5">{visibleLinks.map(renderLink)}</div>
					</div>
				);
			})}
		</nav>
	);

	return (
		<>
			{/* Desktop sidebar */}
			<aside className="hidden min-w-0 self-start desktop:block">
				<div className="sticky top-5 rounded-card border border-border bg-surface p-3 shadow-sm">
					{navigation}
					<div className="mt-4 border-t border-border pt-4">
						<div className="rounded-sm bg-info/50 p-3">
							<p className="text-caption font-semibold text-foreground">
								{t.needHelp}
							</p>
							<p className="mt-1 text-caption text-muted">{t.contactSupport}</p>
						</div>
					</div>
				</div>
			</aside>
			{/* Mobile drawer */}
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
				<div className="rounded-card border border-border bg-surface p-3 shadow-sm">
					{navigation}
				</div>
			</details>
		</>
	);
}
