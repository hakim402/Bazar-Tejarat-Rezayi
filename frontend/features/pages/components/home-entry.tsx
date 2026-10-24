import Link from "next/link";
import { interfaceCopy } from "../../../lib/i18n/interface";
import { authCopy } from "../../../lib/i18n/auth";
import type { Locale } from "../../../lib/i18n/locales";
import { Icon } from "../../../components/ui/icon";
export function HomeEntry({ locale }: { locale: Locale }) {
	const t = interfaceCopy[locale],
		a = authCopy[locale];
	return (
		<section aria-label={t.start} className="grid gap-4 desktop:grid-cols-2">
			{(["buyer", "seller"] as const).map((role) => (
				<div
					key={role}
					className="flex items-start gap-4 rounded-card border border-border bg-surface p-6 shadow-card"
				>
					<span className="flex size-12 shrink-0 items-center justify-center rounded-card bg-info text-action">
						<Icon
							name={role === "buyer" ? "user" : "store"}
							className="size-6"
						/>
					</span>
					<div className="space-y-3">
						<h2 className="text-xl">{a[role]}</h2>
						<p className="text-sm text-muted">
							{role === "buyer" ? t.buyerBody : t.sellerBody}
						</p>
						<Link
							className="inline-flex min-h-11 items-center gap-2 text-sm font-bold"
							href={`/${locale}/auth/${role}-registration`}
						>
							{a.register}
							<Icon name="arrow" className="size-4 rtl:rotate-180" />
						</Link>
					</div>
				</div>
			))}
		</section>
	);
}
