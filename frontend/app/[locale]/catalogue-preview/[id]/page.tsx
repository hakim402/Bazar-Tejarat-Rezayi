import { notFound } from "next/navigation";
import { isLocale, type Locale } from "../../../../lib/i18n/locales";
import { catalogueCopy } from "../../../../lib/i18n/catalogue";
import { apiOrigin } from "../../../../lib/api/client";
import { PublicShell } from "../../../../components/layout/public-shell";
import { readSite } from "../../../../features/site/server";
import { ProductRevisionPreview } from "../../../../features/catalogue/components/product-revision-preview";
import type {
	ProductBody,
	ProductDetail,
	Variant,
	ImageRef,
} from "../../../../features/catalogue/types";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
type Published = {
	id: string;
	revision: string;
	seller_name: string;
	currency: ProductDetail["currency"];
	pricing_mode: ProductDetail["pricing_mode"];
	resolved_locale: Locale;
	source_fallback: boolean;
	body: Pick<
		ProductBody,
		"title" | "description" | "brand" | "category" | "attributes" | "attribute_labels"
	>;
	variants: Variant[];
	images: (ImageRef & { url: string })[];
};
export default async function Page({
	params,
}: {
	params: Promise<{ locale: string; id: string }>;
}) {
	const { locale, id } = await params;
	if (!isLocale(locale) || !/^[0-9a-f-]{36}$/.test(id)) notFound();
	let value: Published | null = null;
	let unavailable = false;
	try {
		const response = await fetch(
			`${apiOrigin(process.env.API_INTERNAL_URL)}/api/v1/catalogue/published/${locale}/${id}/`,
			{
				cache: "no-store",
				credentials: "omit",
				signal: AbortSignal.timeout(10000),
			},
		);
		if (response.status !== 404) {
			if (!response.ok) throw new Error();
			value = (await response.json()) as Published;
		}
	} catch {
		unavailable = true;
	}
	if (!value && !unavailable) notFound();
	const t = catalogueCopy[locale];
	return (
		<PublicShell locale={locale} site={await readSite(locale)}>
			{unavailable || !value ? (
				<p role="alert">{t.unavailable}</p>
			) : (
				<>
					<h1 className="text-2xl">{t.published}</h1>
					{value.source_fallback && (
						<p className="my-4 rounded-control bg-warning-surface p-4 text-warning">
							{t.sourceFallback} · {value.resolved_locale}
						</p>
					)}
					<div>
						<ProductRevisionPreview
							locale={locale}
							body={{
								...value.body,
								locale: value.resolved_locale,
								variants: value.variants,
								images: value.images,
							}}
							item={{
								seller_name: value.seller_name,
								currency: value.currency,
								pricing_mode: value.pricing_mode,
								images: value.images.map((image) => ({
									...image,
									width: 640,
									height: 480,
								})),
								prices: value.variants.map((variant) => ({
									id: variant.id as string,
									sku: variant.sku,
									retail: variant.retail ?? null,
									wholesale: variant.wholesale ?? null,
								})),
							}}
							label={t.published}
							revision={value.revision}
						/>
					</div>
				</>
			)}
		</PublicShell>
	);
}
