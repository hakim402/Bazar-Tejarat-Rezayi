import { authCopy } from "../../../lib/i18n/auth";
import type { Locale } from "../../../lib/i18n/locales";
export function IntentPicker({
	locale,
	context,
	value,
	onChange,
	compact = false,
}: {
	locale: Locale;
	context: "buyer" | "seller";
	value: string;
	compact?: boolean;
	onChange: (value: string) => void;
}) {
	const t = authCopy[locale],
		business = context === "seller" ? "company" : "business";
	return (
		<fieldset
			className={`intent-picker flex gap-2 border-0 p-0 ${compact ? "my-1" : "mt-2 mb-4 desktop:gap-3"}`}
		>
			<legend
				className={compact ? "mb-1 text-xs font-medium" : "mb-2.5 font-bold"}
			>
				{t.intent}
			</legend>
			{(["individual", business] as const).map((intent) => (
				<label
					key={intent}
					className={`flex flex-1 cursor-pointer items-center gap-2 rounded-control border border-control p-2 has-checked:border-primary has-checked:bg-primary has-checked:text-on-primary ${compact ? "min-h-10 text-xs font-medium" : "min-h-13 text-base font-bold desktop:px-3 desktop:py-2.5 desktop:text-lg"}`}
				>
					<input
						type="radio"
						name="intent"
						value={intent}
						className="size-4.5 accent-primary"
						checked={value === intent}
						onChange={() => onChange(intent)}
					/>
					{intent === "individual"
						? t.individual
						: context === "seller"
							? t.company
							: t.business}
				</label>
			))}
		</fieldset>
	);
}
