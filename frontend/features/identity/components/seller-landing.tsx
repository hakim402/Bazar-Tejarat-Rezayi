import Image from "next/image";
import Link from "next/link";
import type { Locale } from "../../../lib/i18n/locales";
import { accessCopy } from "../../../lib/i18n/access";
import { authCopy } from "../../../lib/i18n/auth";
import { pageCopy } from "../../pages/copy";
import { siteCopy } from "../../../lib/i18n/site";
import { Icon, type IconName } from "../../../components/ui/icon";
import { AccessLink } from "./access-provider";
const primary =
	"inline-flex min-h-13 items-center justify-center gap-2 rounded-control bg-primary px-6 py-3 font-bold text-on-primary no-underline hover:brightness-95";
const secondary =
	"inline-flex min-h-13 items-center justify-center rounded-control border border-border bg-surface px-6 py-3 font-bold text-action no-underline hover:bg-info";
export function SellerLanding({ locale }: { locale: Locale }) {
	const t = accessCopy[locale],
		auth = authCopy[locale],
		copy = pageCopy[locale].sell;
	const facts: { icon: IconName; text: string }[] = [
		{ icon: "user", text: t.shared },
		{ icon: "shield", text: t.safe },
		{ icon: "file", text: t.review },
	];
	return (
		<div className="space-y-8 desktop:space-y-12">
			<nav
				aria-label={siteCopy[locale].navigation}
				className="flex items-center gap-3 text-sm text-muted"
			>
				<Link href={`/${locale}`}>{auth.home}</Link>
				<span aria-hidden="true">/</span>
				<span>{t.guide}</span>
			</nav>
			<header className="relative isolate grid overflow-hidden rounded-card border border-border bg-linear-to-br from-campaign-start to-campaign-end desktop:grid-cols-[1.2fr_0.8fr]">
				<div className="p-6 desktop:p-10">
					<span className="inline-flex items-center gap-2 text-sm font-bold text-action">
						<Icon name="store" />
						{t.sellerAccess}
					</span>
					<h1 className="mt-4 max-w-xl text-3xl leading-tight desktop:text-5xl">
						{copy.title}
					</h1>
					<p className="mt-5 max-w-lg text-lg text-muted">{t.sellerBody}</p>
					<p className="mt-3 text-muted">{copy.intro}</p>
					<div className="mt-7 flex flex-wrap gap-3">
						<AccessLink
							locale={locale}
							screen="seller-registration"
							className={primary}
						>
							{t.start}
							<Icon name="arrow" className="size-5 rtl:rotate-180" />
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
			<section aria-labelledby="seller-steps">
				<div className="mb-6 flex flex-wrap items-end justify-between gap-4">
					<h2 id="seller-steps" className="text-2xl desktop:text-3xl">
						{t.steps}
					</h2>
					<Link
						href={`/${locale}/help/verification`}
						className="inline-flex min-h-11 items-center font-bold"
					>
						{copy.sections[1].actions[0].label}
						<Icon name="chevron" className="ms-1 size-4 rtl:rotate-180" />
					</Link>
				</div>
				<ol className="m-0 grid list-none gap-5 p-0 desktop:grid-cols-3">
					{copy.sections.map((section, index) => (
						<li
							key={section.anchor}
							className="rounded-card border border-border bg-surface p-6"
						>
							<span className="mb-5 inline-flex size-11 items-center justify-center rounded-control bg-info font-bold text-action">
								{new Intl.NumberFormat(locale).format(index + 1)}
							</span>
							<h3 className="mb-3 text-xl">{section.heading}</h3>
							<p className="leading-7 text-muted">{section.body}</p>
						</li>
					))}
				</ol>
			</section>
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
					<Link
						href={`/${locale}/contact`}
						className="mt-4 inline-flex min-h-11 items-center gap-2 font-bold"
					>
						{siteCopy[locale].contact}
						<Icon name="arrow" className="size-4 rtl:rotate-180" />
					</Link>
				</div>
			</section>
			<aside className="rounded-card border border-border bg-info p-5 text-sm leading-7 text-muted">
				{auth.policy}
			</aside>
		</div>
	);
}
