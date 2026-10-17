import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isLocale, locales } from "../../lib/i18n/locales";
import { messages } from "../../lib/i18n/messages";
import { serverBootstrap } from "../../lib/api/server";
import { Shell } from "../../components/shell";
import { BootstrapPanel } from "../../components/bootstrap-panel";
export async function generateMetadata({
	params,
}: {
	params: Promise<{ locale: string }>;
}): Promise<Metadata> {
	const { locale } = await params;
	if (!isLocale(locale)) return {};
	const t = messages[locale];
	return {
		title: `${t.brand} — ${t.preview}`,
		description: t.intro,
		metadataBase: new URL("https://bazartejaratrezayi.com"),
		alternates: {
			canonical: `/${locale}`,
			languages: Object.fromEntries([
				...locales.map((value) => [value, `/${value}`]),
				["x-default", "/fa-AF"],
			]),
		},
		robots: { index: false, follow: false },
	};
}
export default async function Home({
	params,
}: {
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;
	if (!isLocale(locale)) notFound();
	const t = messages[locale];
	const bootstrap = await serverBootstrap();
	return (
		<Shell locale={locale}>
			<section className="hero">
				<div className="hero-copy">
					<p className="eyebrow">{t.eyebrow}</p>
					<h1>{t.title}</h1>
					<p className="hero-intro">{t.intro}</p>
					<p className="availability">
						<span className="status-dot" aria-hidden="true" />
						{t.availability}
					</p>
				</div>
				<div className="hero-mark" aria-hidden="true">
					<Image
						src="/brand/symbol.svg"
						alt=""
						width={250}
						height={250}
						priority
					/>
					<span>{t.brand}</span>
					<p>{t.pending}</p>
				</div>
			</section>
			<BootstrapPanel
				key={locale}
				locale={locale}
				initial={bootstrap.data}
				initialFailure={bootstrap.failure}
			/>
		</Shell>
	);
}
