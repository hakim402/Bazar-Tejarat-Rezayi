import Image from "next/image";
import Link from "next/link";
import { apiOrigin } from "../../../../../lib/api/client";
import type { Locale } from "../../../../../lib/i18n/locales";
import { accessCopy } from "../../../../../lib/i18n/access";
import { authCopy } from "../../../../../lib/i18n/auth";
import { siteCopy } from "../../../../../lib/i18n/site";
import { Icon, type IconName } from "../../../../../components/ui/icon";
import { AccessLink } from "../../../../../components/authentication/access-provider";
import { Breadcrumb } from "../../../../../components/ui/breadcrumb";
import type { Page } from "../../../../../features/pages/api";
import { PageBody } from "../../../../../features/pages/components/page-body";
import { prepareBody } from "../../../../../features/pages/html";
import type { Site } from "../../../../../features/site/contract";
const primary =
	"inline-flex min-h-12 w-full max-w-xs items-center justify-center gap-2 rounded-control bg-primary px-5 py-2.5 text-center text-sm font-bold leading-snug text-on-primary no-underline break-words hover:brightness-95 desktop:min-h-13 desktop:w-auto desktop:max-w-none desktop:px-6 desktop:py-3 desktop:text-base";
const secondary =
	"inline-flex min-h-12 w-full max-w-xs items-center justify-center rounded-control border border-border bg-surface px-5 py-2.5 text-center text-sm font-bold leading-snug text-action no-underline break-words hover:bg-info desktop:min-h-13 desktop:w-auto desktop:max-w-none desktop:px-6 desktop:py-3 desktop:text-base";
export function SellerLanding({
	locale,
	page,
	site,
}: {
	locale: Locale;
	page: Page | null;
	site: Site | null;
}) {
	const t = accessCopy[locale],
		auth = authCopy[locale],
		title = page?.title || t.guide,
		body = page
			? prepareBody(
					page.body,
					page.content_locale,
					apiOrigin(process.env.NEXT_PUBLIC_API_URL),
				)
			: null,
		hasHelp = (site?.pages ?? []).some((item) => item.kind === "help-index"),
		hasContact = (site?.pages ?? []).some((item) => item.kind === "contact");
	const facts: { icon: IconName; text: string }[] = [
		{ icon: "user", text: t.shared },
		{ icon: "shield", text: t.safe },
		{ icon: "file", text: t.review },
	];
	return (
		<div className="space-y-8 desktop:space-y-12">
			<Breadcrumb
				label={siteCopy[locale].navigation}
				items={[{ label: auth.home, href: `/${locale}` }, { label: t.guide }]}
			/>
			<header className="relative isolate grid overflow-hidden rounded-card border border-border bg-linear-to-br from-campaign-start to-campaign-end desktop:grid-cols-[1.2fr_0.8fr]">
				<div className="p-6 text-center desktop:p-10 desktop:text-start">
					<span className="inline-flex items-center gap-2 text-sm font-bold text-action">
						<Icon name="store" />
						{t.sellerAccess}
					</span>
					<h1
						className={`mx-auto mt-4 max-w-xl leading-tight desktop:mx-0 ${title.length > 40 ? "text-2xl" : "text-3xl"} desktop:text-5xl`}
					>
						{title}
					</h1>
					<p className="mx-auto mt-5 max-w-lg text-lg text-muted desktop:mx-0">
						{t.sellerBody}
					</p>
					{page?.intro && <p className="mt-3 text-muted">{page.intro}</p>}
					<div className="mt-7 flex flex-col items-center gap-3 desktop:flex-row desktop:flex-wrap">
						<AccessLink
							locale={locale}
							screen="seller-registration"
							className={primary}
						>
							{t.start}
							<Icon
								name="arrow"
								className="size-4 shrink-0 rtl:rotate-180 desktop:size-5"
							/>
						</AccessLink>
						<AccessLink
							locale={locale}
							screen="seller-sign-in"
							className={secondary}
						>
							{auth.sellerSignin}
						</AccessLink>
					</div>
				</div>
				<div className="relative min-h-52 desktop:min-h-96">
					<Image
						src="/images/marketplace/welcome.webp"
						alt=""
						fill
						sizes="(min-width: 768px) 40vw, 100vw"
						className="object-cover object-bottom"
						priority
					/>
					<div className="absolute inset-0 bg-linear-to-t from-campaign-end/30 to-transparent" />
				</div>
			</header>
			<div className="grid gap-4 rounded-card border border-border bg-surface p-5 desktop:grid-cols-3 desktop:p-6">
				{facts.map((fact) => (
					<p
						key={fact.icon}
						className="flex items-center gap-3 text-sm font-medium"
					>
						<span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-info text-action">
							<Icon name={fact.icon} />
						</span>
						{fact.text}
					</p>
				))}
			</div>
			{page?.fallback && (
				<p className="rounded-card border border-border bg-info p-4 text-sm text-muted">
					{siteCopy[locale].fallback}
				</p>
			)}
			{body?.html && page && (
				<section aria-labelledby="seller-steps" className="space-y-6">
					<div className="flex flex-wrap items-end justify-between gap-4">
						<h2 id="seller-steps" className="text-2xl desktop:text-3xl">
							{t.steps}
						</h2>
						{hasHelp && (
							<Link
								href={`/${locale}/help`}
								className="inline-flex min-h-11 items-center font-bold"
							>
								{siteCopy[locale].help}
								<Icon name="chevron" className="ms-1 size-4 rtl:rotate-180" />
							</Link>
						)}
					</div>
					<PageBody
						locale={locale}
						contentLocale={page.content_locale}
						html={body.html}
						sections={body.sections}
					/>
				</section>
			)}
			<section className="grid gap-7 rounded-card border border-border bg-surface p-6 desktop:grid-cols-[1.2fr_0.8fr] desktop:p-8">
				<div>
					<h2 className="text-2xl">{t.ready}</h2>
					<p className="mt-4 max-w-2xl leading-8 text-muted">{t.readyBody}</p>
					<p className="mt-4 flex items-start gap-3 text-sm text-muted">
						<Icon name="lock" />
						{auth.sellerNote}
					</p>
				</div>
				<div className="rounded-card bg-info p-5">
					<h3 className="text-xl">{t.help}</h3>
					<p className="mt-3 leading-7 text-muted">{t.helpBody}</p>
					{hasContact && (
						<Link
							href={`/${locale}/contact`}
							className="mt-4 inline-flex min-h-11 items-center gap-2 font-bold"
						>
							{siteCopy[locale].contact}
							<Icon name="arrow" className="size-4 rtl:rotate-180" />
						</Link>
					)}
				</div>
			</section>
			<aside className="rounded-card border border-border bg-info p-5 text-sm leading-7 text-muted">
				{auth.policy}
			</aside>
		</div>
	);
}
