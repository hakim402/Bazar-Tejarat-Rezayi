import { direction, type Locale } from "../../../lib/i18n/locales";
import { siteCopy } from "../../../lib/i18n/site";
import type { BodySection } from "../html";
/** Rich-HTML article with a sticky anchor navigation when it has sections. */
export function PageBody({
	locale,
	contentLocale,
	html,
	sections,
}: {
	locale: Locale;
	contentLocale: Locale;
	html: string;
	sections: BodySection[];
}) {
	const article = (
		<article
			className="page-prose min-w-0 rounded-card border border-border bg-surface p-6 desktop:p-10"
			lang={contentLocale}
			dir={direction(contentLocale)}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: body is sanitized server-side and re-checked by prepareBody.
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
	if (sections.length < 2) return article;
	return (
		<div className="grid items-start gap-6 desktop:grid-cols-[16rem_minmax(0,1fr)]">
			<nav
				aria-label={siteCopy[locale].onThisPage}
				className="rounded-card border border-border bg-surface p-4 desktop:sticky desktop:top-6"
			>
				<h2 className="mb-3 text-base">{siteCopy[locale].onThisPage}</h2>
				<ol className="m-0 list-none space-y-1 p-0">
					{sections.map((section) => (
						<li key={section.id}>
							<a
								href={`#${section.id}`}
								className="inline-flex min-h-10 items-center text-sm leading-6 text-muted no-underline hover:text-action hover:underline"
							>
								{section.text}
							</a>
						</li>
					))}
				</ol>
			</nav>
			{article}
		</div>
	);
}
