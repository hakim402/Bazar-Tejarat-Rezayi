import Link from "next/link";
import { contentCopy } from "../../../lib/i18n/content";
import type { Locale } from "../../../lib/i18n/locales";
import { readContent, readShell } from "../api/server";
import {
	PublicShell,
	SupportDetails,
} from "../../../components/layout/public-shell";
import { PublicBody } from "./public-body";
export async function ContentPage({
	locale,
	contentKey,
}: {
	locale: Locale;
	contentKey: string;
}) {
	const [content, shell] = await Promise.all([
		readContent(locale, contentKey),
		readShell(locale),
	]);
	return (
		<PublicShell locale={locale} shell={shell}>
			{contentKey !== "home" && (
				<nav
					aria-label={contentCopy[locale].navigation}
					className="flex flex-wrap gap-3 text-muted"
				>
					<Link href={`/${locale}`}>{contentCopy[locale].home}</Link>
					{content.data?.kind === "article" && (
						<Link href={`/${locale}/help`}>{contentCopy[locale].help}</Link>
					)}
				</nav>
			)}
			<PublicBody
				initial={content.data}
				failure={content.failure}
				locale={locale}
				contentKey={contentKey}
			/>
			{contentKey === "contact" && (
				<SupportDetails resource={shell?.support} locale={locale} />
			)}
		</PublicShell>
	);
}
