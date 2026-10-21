import Image from "next/image";
import Link from "next/link";
import { contentCopy } from "../../../lib/i18n/content";
import { direction, type Locale } from "../../../lib/i18n/locales";
import type { Document as DocumentData } from "../types";
export function Document({
	data,
	locale,
	contentLocale = locale,
	heading = true,
	compact = false,
}: {
	data: DocumentData;
	locale: Locale;
	contentLocale?: Locale;
	heading?: boolean;
	compact?: boolean;
}) {
	const t = contentCopy[locale];
	const first = data.blocks?.find((b) => b.enabled !== false);
	const hero =
		heading && first?.type === "hero" && first.title ? first.id : null;
	return (
		<article
			lang={contentLocale}
			dir={direction(contentLocale)}
			className="min-w-0 space-y-6 wrap-anywhere"
		>
			{heading && !hero && (
				<header className="space-y-3">
					<h1 className="max-w-full text-3xl desktop:text-5xl">{data.title}</h1>
					{data.description && (
						<p className="max-w-3xl text-muted">{data.description}</p>
					)}
				</header>
			)}
			{!hero && (data.blocks?.length ?? 0) > 1 && (
				<nav
					aria-label={t.contents}
					className="flex flex-wrap gap-x-5 gap-y-2 rounded-card border border-border bg-surface p-4"
				>
					{data.blocks
						?.filter((b) => b.enabled && b.title)
						.map((b) => (
							<a key={b.id} href={`#${b.id}`}>
								{b.title}
							</a>
						))}
				</nav>
			)}
			{data.blocks
				?.filter((b) => b.enabled !== false)
				.map((b) => (
					<section
						key={b.id}
						id={b.id}
						className={`${compact ? "space-y-3" : "scroll-mt-5 rounded-card border border-border p-5 desktop:p-8"} ${b.type === "hero" ? "grid items-center gap-6 desktop:grid-cols-2 bg-info" : "bg-surface space-y-4"}`}
					>
						<div className="space-y-4">
							{b.title &&
								(b.id === hero ? (
									<h1 className="max-w-full text-3xl desktop:text-5xl">
										{b.title}
									</h1>
								) : (
									<h2 className="text-2xl desktop:text-3xl">{b.title}</h2>
								))}
							{b.text && (
								<p className="whitespace-pre-line max-w-3xl">{b.text}</p>
							)}
							{b.type === "catalogue" || b.type === "store" ? (
								<p
									className="rounded-control bg-info p-3 text-muted"
									aria-disabled="true"
									lang={locale}
									dir={direction(locale)}
								>
									{t.future}
								</p>
							) : (
								<>
									{(b.items?.length ?? 0) > 0 && (
										<ol className="space-y-3 ps-6">
											{b.items?.map((text) => (
												<li key={`${b.id}-${text}`}>{text}</li>
											))}
										</ol>
									)}
									<div className="flex flex-wrap gap-4">
										{b.links?.map((link) => (
											<Link
												key={link.id}
												className="inline-flex min-h-11 items-center rounded-control border border-control px-4 py-2 font-bold"
												href={`/${locale}${link.target === "/" ? "" : link.target}`}
											>
												{link.label}
											</Link>
										))}
									</div>
								</>
							)}
						</div>
						{b.asset === "welcome" && (
							<Image
								className="h-auto w-full rounded-card object-cover"
								src="/account-welcome.png"
								alt={b.alt ?? ""}
								width={1536}
								height={1024}
								priority={b.type === "hero"}
							/>
						)}
					</section>
				))}
		</article>
	);
}
