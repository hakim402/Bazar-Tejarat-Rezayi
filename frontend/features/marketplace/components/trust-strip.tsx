import type { Locale } from "../../../lib/i18n/locales";
import { Icon } from "../../../components/ui/icon";
import { marketplaceCopy } from "../copy";
export function TrustStrip({
	locale,
	className = "",
}: {
	locale: Locale;
	className?: string;
}) {
	const t = marketplaceCopy[locale],
		items = [
			{ icon: "truck", label: t.trustDelivery },
			{ icon: "shield", label: t.trustAuthentic },
			{ icon: "headset", label: t.trustSupport },
		] as const;
	return (
		<ul
			className={`flex flex-wrap items-center justify-around gap-x-4 gap-y-2 rounded-card bg-page px-4 py-3 ${className}`}
		>
			{items.map((item, i) => (
				<li
					key={item.label}
					className="flex items-center gap-2 text-sm font-semibold"
				>
					{i > 0 && (
						<span
							aria-hidden
							className="me-4 hidden h-6 w-px bg-border min-[640px]:block"
						/>
					)}
					<Icon name={item.icon} className="size-5 text-action" />
					{item.label}
				</li>
			))}
		</ul>
	);
}
