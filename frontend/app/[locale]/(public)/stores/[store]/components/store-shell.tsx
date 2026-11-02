import { notFound } from "next/navigation";
import type { Locale } from "../../../../../../lib/i18n/locales";
import {
	MarketplaceShell,
	readMarketplace,
	Feedback,
	Breadcrumbs,
} from "../../../../../../features/marketplace/server";
import type { PublicStore } from "../../../../../../features/marketplace/types";
import { marketplaceCopy } from "../../../../../../features/marketplace/copy";
import { Asset } from "../../../../../../features/marketplace/components/cards";
import { mediaUrl } from "../../../../../../features/marketplace/api";
import { publicOrigin } from "../../../../../../features/pages/metadata";
export async function StoreShell({
	locale,
	id,
	children,
}: {
	locale: Locale;
	id: string;
	children: React.ReactNode;
}) {
	const result = await readMarketplace<PublicStore>(locale, `stores/${id}/`);
	if (result.status === 404) notFound();
	const store = result.data,
		t = marketplaceCopy[locale];
	return (
		<MarketplaceShell locale={locale}>
			{store ? (
				<>
					<Breadcrumbs
						locale={locale}
						items={[
							{ name: t.stores, path: "/stores" },
							{ name: store.name || t.stores, path: `/stores/${id}` },
						]}
					/>
					<script type="application/ld+json">
						{JSON.stringify({
							"@context": "https://schema.org",
							"@type": "ProfilePage",
							url: `${publicOrigin}/${locale}/stores/${id}`,
							mainEntity: {
								"@type": store.kind === "company" ? "Organization" : "Person",
								name: store.name,
								description: store.description,
								image: store.logo ? mediaUrl(store.logo.url) : undefined,
							},
						}).replaceAll("<", "\\u003c")}
					</script>
					<header className="overflow-hidden rounded-3xl border border-border bg-surface">
						{store.banner && (
							<Asset
								asset={store.banner}
								className="max-h-72 w-full object-cover"
							/>
						)}
						<div className="flex flex-wrap items-center gap-4 p-5">
							{store.logo ? (
								<Asset
									asset={store.logo}
									className="size-20 rounded-2xl object-contain"
								/>
							) : (
								<span
									aria-hidden
									className="flex size-20 items-center justify-center rounded-2xl bg-info text-3xl text-action"
								>
									◇
								</span>
							)}
							<div className="min-w-0">
								<h1 className="break-words text-3xl">
									{store.name || t.stores}
								</h1>
								<p className="mt-2 text-sm text-muted">{t[store.kind]}</p>
								<p>
									{store.city}
									{store.city && store.country ? ", " : ""}
									{store.country}
								</p>
							</div>
						</div>
						<nav className="flex flex-wrap gap-5 border-t border-border px-5">
							{(["products", "about", "reviews"] as const).map((tab) => (
								<a
									className="inline-flex min-h-11 items-center font-bold"
									key={tab}
									href={`/${locale}/stores/${id}${tab === "products" ? "" : `/${tab}`}`}
								>
									{t[tab]}
								</a>
							))}
						</nav>
					</header>
					{children}
				</>
			) : (
				<Feedback locale={locale} status={result.status} />
			)}
		</MarketplaceShell>
	);
}
