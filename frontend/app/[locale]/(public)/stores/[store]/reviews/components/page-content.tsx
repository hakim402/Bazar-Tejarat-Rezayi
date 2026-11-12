import type { Locale } from "../../../../../../../lib/i18n/locales";
import { notFound } from "next/navigation";
import {
	readMarketplace,
	marketMetadata,
	Feedback,
	type Search,
} from "../../../../../../../features/marketplace/server";
import type { PublicStore } from "../../../../../../../features/marketplace/types";
import { Pagination } from "../../../../../../../features/marketplace/components/filters";
import { RatingStars } from "../../../../../../../features/marketplace/components/cards";
import { marketplaceCopy } from "../../../../../../../features/marketplace/copy";
import { aftercareCopy } from "../../../../../../../features/aftercare/copy";
import { localTimestamp } from "../../../../../../../features/messaging/api";
import { StoreShell } from "../../components/store-shell";

type PublicReview = {
	reviewer: "buyer";
	rating: number;
	text: string;
	language: string;
	created_at: string;
};
type ReviewPage = {
	results: PublicReview[];
	count: number;
	page: number;
	page_size: number;
};
type ReviewSummary = { count: number; average: string | null };

export async function metadataFor(
	locale: Locale,
	params: { store: string },
	_search: Search,
) {
	const result = await readMarketplace<PublicStore>(
		locale,
		`stores/${params.store}/`,
	);
	if (result.status === 404) notFound();
	if (!result.data)
		return {
			robots: { index: false, follow: false },
			title: marketplaceCopy[locale].unavailable,
		};
	return marketMetadata(
		locale,
		`/stores/${params.store}/reviews`,
		result.data.name,
		result.data.description,
		true,
	);
}
export async function PageContent({
	locale,
	params,
	search,
}: {
	locale: Locale;
	params: { store: string };
	search: Search;
}) {
	const t = marketplaceCopy[locale],
		copy = aftercareCopy[locale],
		raw = search.page ?? "1";
	const valid =
		Object.keys(search).every((key) => key === "page") &&
		typeof raw === "string" &&
		/^\d+$/.test(raw) &&
		Number(raw) >= 1 &&
		Number(raw) <= 10000;
	if (!valid)
		return (
			<StoreShell locale={locale} id={params.store} tab="reviews">
				<Feedback locale={locale} status={400} />
			</StoreShell>
		);
	const page = Number(raw),
		query = new URLSearchParams();
	if (page > 1) query.set("page", String(page));
	const [reviewsResult, summaryResult] = await Promise.all([
		readMarketplace<ReviewPage>(
			locale,
			`stores/${params.store}/reviews/?page=${page}`,
		),
		readMarketplace<ReviewSummary>(
			locale,
			`stores/${params.store}/reviews/summary/`,
		),
	]);
	if (reviewsResult.status === 404 || summaryResult.status === 404) notFound();
	const reviews = reviewsResult.data,
		summary = summaryResult.data;
	return (
		<StoreShell locale={locale} id={params.store} tab="reviews">
			<section className="space-y-4 rounded-card border border-border bg-surface p-5">
				<h2 className="text-2xl font-bold">{t.reviews}</h2>
				{!reviews || !summary ? (
					<Feedback
						locale={locale}
						status={!reviews ? reviewsResult.status : summaryResult.status}
					/>
				) : (
					<>
						{summary.count > 0 && summary.average !== null ? (
							<p className="flex flex-wrap items-center gap-2">
								<RatingStars average={Number(summary.average)} />
								<bdi className="font-bold">{summary.average}/5</bdi> ·{" "}
								<bdi>{summary.count}</bdi> {t.reviewCount}
							</p>
						) : (
							<p>{copy.reviewEmpty}</p>
						)}
						{reviews.count > 0 && (
							<Pagination
								locale={locale}
								path={`/${locale}/stores/${params.store}/reviews`}
								query={query}
								page={reviews.page}
								count={reviews.count}
								pageSize={reviews.page_size}
							/>
						)}
						{reviews.results.length ? (
							<ul className="space-y-3">
								{reviews.results.map((review) => (
									<li
										key={`${review.created_at}:${review.rating}:${review.language}:${review.text}`}
										className="min-w-0 space-y-2 rounded-card border border-border p-4"
									>
										<p className="flex items-center gap-2">
											<RatingStars
												average={review.rating}
												className="size-3.5"
											/>
											<bdi className="text-sm font-bold">{review.rating}/5</bdi>
										</p>
										<p
											lang={review.language}
											dir="auto"
											className="whitespace-pre-wrap break-words"
										>
											{review.text}
										</p>
										<p className="text-sm text-muted">
											<bdi>{review.language}</bdi> ·{" "}
											<bdi>{localTimestamp(review.created_at, locale)}</bdi>
										</p>
									</li>
								))}
							</ul>
						) : (
							summary.count > 0 && <p role="status">{t.noMatches}</p>
						)}
						{reviews.count > 0 && (
							<Pagination
								locale={locale}
								path={`/${locale}/stores/${params.store}/reviews`}
								query={query}
								page={reviews.page}
								count={reviews.count}
								pageSize={reviews.page_size}
							/>
						)}
					</>
				)}
			</section>
		</StoreShell>
	);
}
