import Link from "next/link";
import type { Locale } from "../../lib/i18n/locales";
import { BrandLogo } from "../brand/brand-logo";
import { Container } from "./container";
import { HeaderProfile } from "./header-profile";
import { HeaderSessionProvider } from "./header-session";
import { StorefrontNavigation } from "../../features/storefront/navigation";
export function SiteHeader({ locale }: { locale: Locale }) {
	return (
		<header className="site-header relative z-30 border-b border-border/60 bg-surface">
			<HeaderSessionProvider>
				<Container className="flex min-h-24 flex-wrap items-center gap-x-2 gap-y-3 py-4 desktop:flex-nowrap desktop:gap-x-7 desktop:py-5">
					<Link
						href={`/${locale}`}
						className="inline-flex min-h-11 shrink-0 items-center no-underline"
					>
						<BrandLogo
							locale={locale}
							className="w-28 min-[420px]:w-36 desktop:w-44"
						/>
					</Link>
					<StorefrontNavigation locale={locale} />
					<HeaderProfile locale={locale} />
				</Container>
			</HeaderSessionProvider>
		</header>
	);
}
