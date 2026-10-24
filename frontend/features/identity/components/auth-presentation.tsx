import Image from "next/image";
import type { ReactNode } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { accessCopy } from "../../../lib/i18n/access";
import { BrandLogo } from "../../../components/brand/brand-logo";
export function AuthPresentation({
	locale,
	seller = false,
	inDialog = false,
	split = !seller,
	children,
}: {
	locale: Locale;
	seller?: boolean;
	inDialog?: boolean;
	split?: boolean;
	children: ReactNode;
}) {
	const t = accessCopy[locale];
	const form = (
		<section
			className={`account-card min-w-0 bg-surface p-5 text-foreground ${inDialog ? "pt-10" : "desktop:p-7"}`}
		>
			{children}
		</section>
	);
	if (!split)
		return (
			<div className="mx-auto w-full max-w-sm overflow-hidden rounded-card border border-border bg-surface shadow-card">
				{form}
			</div>
		);
	return (
		<div className="mx-auto grid w-full max-w-2xl min-w-0 overflow-hidden rounded-card border border-border bg-surface shadow-card desktop:grid-cols-[13rem_minmax(0,1fr)]">
			<aside className="hidden min-w-0 flex-col bg-brand-panel p-5 text-brand-ink desktop:flex">
				<BrandLogo locale={locale} reversed className="w-32" />
				<h2 className="mt-8 text-xl leading-snug">
					{seller ? t.sellerAccess : t.buyerAccess}
				</h2>
				<p className="mt-3 text-sm leading-6 text-brand-ink/90">
					{seller ? t.sellerBody : t.buyerBody}
				</p>
				<div className="relative mt-auto h-36 pt-5">
					<Image
						src="/images/marketplace/welcome.webp"
						alt=""
						fill
						sizes="168px"
						className="rounded-control object-cover object-bottom"
					/>
				</div>
			</aside>
			{form}
		</div>
	);
}
