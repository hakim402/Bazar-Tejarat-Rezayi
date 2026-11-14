"use client";
import { useState } from "react";
import Link from "next/link";
import type { Locale } from "../../../lib/i18n/locales";
import { interfaceCopy } from "../../../lib/i18n/interface";
import { siteCopy } from "../../../lib/i18n/site";
import type { PageSummary } from "../registry";
export function HelpIndex({
	locale,
	articles,
}: {
	locale: Locale;
	articles: PageSummary[];
}) {
	const [query, setQuery] = useState(""),
		ui = interfaceCopy[locale];
	const results = articles.filter((article) =>
		`${article.title} ${article.intro}`
			.toLocaleLowerCase()
			.includes(query.trim().toLocaleLowerCase()),
	);
	return (
		<section className="space-y-6">
			<label className="block max-w-xl space-y-2">
				<span className="font-bold">{ui.search}</span>
				<input
					type="search"
					className="min-h-12 w-full rounded-control border border-control bg-surface px-4 text-foreground"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
			</label>
			<div className="grid gap-5 desktop:grid-cols-3">
				{results.map((article) => (
					<article
						className="space-y-4 rounded-card border border-border bg-surface p-6 shadow-card"
						key={article.slug}
					>
						<h2 className="text-xl">
							<Link href={`/${locale}${article.path}`}>{article.title}</Link>
						</h2>
						<p className="text-muted">{article.intro}</p>
					</article>
				))}
			</div>
			{!results.length && <p role="status">{siteCopy[locale].noArticles}</p>}
		</section>
	);
}
