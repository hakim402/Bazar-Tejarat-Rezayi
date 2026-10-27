"use client";
import type { Locale } from "../../../lib/i18n/locales";
import { inventoryCopy } from "../../../lib/i18n/inventory";
import { Button } from "../../../components/ui/button";
export function Pagination({
	locale,
	page,
	count,
	size,
	onPage,
}: {
	locale: Locale;
	page: number;
	count: number;
	size: number;
	onPage: (page: number) => void;
}) {
	const t = inventoryCopy[locale];
	return (
		<nav aria-label={t.page} className="mt-5 flex flex-wrap items-center gap-3">
			<Button
				compact
				variant="secondary"
				disabled={page <= 1}
				onClick={() => onPage(page - 1)}
			>
				{t.previous}
			</Button>
			<span>
				{t.page}{" "}
				<bdi>
					{page} / {Math.max(1, Math.ceil(count / size))}
				</bdi>
			</span>
			<Button
				compact
				variant="secondary"
				disabled={page * size >= count}
				onClick={() => onPage(page + 1)}
			>
				{t.next}
			</Button>
		</nav>
	);
}
