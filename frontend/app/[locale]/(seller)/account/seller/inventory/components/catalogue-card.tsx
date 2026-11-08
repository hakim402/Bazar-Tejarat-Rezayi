"use client";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { inventoryCopy } from "../../../../../../../lib/i18n/inventory";
import { StatCard } from "../../../../../../../components/ui/stat-card";

export function CatalogueCard({
	locale,
	count,
	href,
	className,
}: {
	locale: Locale;
	count: number;
	href?: string;
	className?: string;
}) {
	const t = inventoryCopy[locale];

	return (
		<StatCard
			className={className}
			locale={locale}
			icon="box"
			chip="info"
			label={t.catalogueProducts}
			value={count}
			hint={
				<span className="text-sm leading-relaxed">{t.productsInCatalogue}</span>
			}
			href={href}
		/>
	);
}
