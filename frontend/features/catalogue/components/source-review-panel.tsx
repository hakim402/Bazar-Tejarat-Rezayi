import type { Locale } from "../../../lib/i18n/locales";
import { catalogueCopy } from "../../../lib/i18n/catalogue";
import type { Revision } from "../types";
export function SourceReviewPanel({
	locale,
	previous,
	selected,
}: {
	locale: Locale;
	previous: Revision;
	selected: Revision;
}) {
	const t = catalogueCopy[locale];
	const fields = [
		"title",
		"description",
		"brand",
		"category",
		"attributes",
		"variants",
		"images",
	] as const;
	const labels = {
		title: t.productTitle,
		description: t.description,
		brand: t.brand,
		category: t.category,
		attributes: t.attributes,
		variants: t.variants,
		images: t.images,
	};
	const changed = fields.filter(
		(key) =>
			JSON.stringify(previous.body[key]) !== JSON.stringify(selected.body[key]),
	);
	return (
		<aside className="rounded-control border border-border p-4 space-y-3">
			<h2 className="text-xl">
				{t.previous} → {t.saved}
			</h2>
			<p className="break-all text-sm">
				<bdi>
					{previous.id} → {selected.id}
				</bdi>
			</p>
			<ul className="list-inside list-disc">
				{changed.map((key) => (
					<li key={key}>{labels[key]}</li>
				))}
			</ul>
			<p className="text-muted">{t.priceHelp}</p>
		</aside>
	);
}
