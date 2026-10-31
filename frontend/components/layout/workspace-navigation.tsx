"use client";
import Link from "next/link";
import { commerceCopy } from "../../features/orders/copy";
import { communicationCopy } from "../../features/messaging/copy";
import { accountSettingsCopy } from "../../lib/i18n/account-settings";
import { usePathname } from "next/navigation";
import type { AccountContext } from "../../features/identity/api/accounts";
import type { Locale } from "../../lib/i18n/locales";
import { authCopy } from "../../lib/i18n/auth";
import { interfaceCopy } from "../../lib/i18n/interface";
import { catalogueCopy } from "../../lib/i18n/catalogue";
import { organizationCopy } from "../../lib/i18n/organizations";
import { Icon, type IconName } from "../ui/icon";
export function WorkspaceNavigation({
	locale,
	context,
}: {
	locale: Locale;
	context: AccountContext;
}) {
	const a = authCopy[locale],
		path = usePathname(),
		base = `/${locale}/account/${context}`;
	const links: {
		href: string;
		label: string;
		icon: IconName;
	}[] = [{ href: base, label: interfaceCopy[locale].overview, icon: "home" }];
	if (context !== "buyer")
		links.push({
			href: `${base}/catalogue`,
			label: catalogueCopy[locale].title,
			icon: "box",
		});
	links.push(...(["orders", "invoices"] as const).map(route=>({href:`${base}/${route}`,label:commerceCopy[locale][route],icon:"file" as const})));
 if(context==="buyer")links.push({href:`/${locale}/cart`,label:commerceCopy[locale].cart,icon:"box"},{href:`${base}/checkouts`,label:commerceCopy[locale].history,icon:"file"});
	links.push(
		{
			href: `${base}/messages`,
			label: communicationCopy[locale].messages,
			icon: "mail",
		},
		{
			href: `${base}/notifications`,
			label: communicationCopy[locale].notifications,
			icon: "bell",
		},
	);
	links.push({
		href: `${base}/organizations`,
		label: organizationCopy[locale].title,
		icon: "store",
	});
	links.push({
		href: `${base}/settings`,
		label: accountSettingsCopy[locale].title,
		icon: "user",
	});
	links.push({
		href: `${base}/password`,
		label: a.passwordChange,
		icon: "lock",
	});
	return (
		<nav
			aria-label={interfaceCopy[locale].workspace}
			className="flex gap-2 overflow-x-auto rounded-card border border-border bg-surface p-2 desktop:flex-col desktop:p-3"
		>
			{links.map((link) => (
				<Link
					key={link.href}
					href={link.href}
					aria-current={
						path === link.href ||
						(link.href !== base && path.startsWith(`${link.href}/`))
							? "page"
							: undefined
					}
					className="flex min-h-12 shrink-0 items-center gap-3 rounded-control px-4 py-3 text-sm font-bold text-foreground no-underline hover:bg-info aria-[current=page]:bg-info aria-[current=page]:text-action desktop:shrink desktop:whitespace-normal"
				>
					<Icon name={link.icon} />
					{link.label}
				</Link>
			))}
		</nav>
	);
}
