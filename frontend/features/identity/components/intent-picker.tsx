import { authCopy } from "../../../lib/i18n/auth";
import type { Locale } from "../../../lib/i18n/locales";
export function IntentPicker({
	locale,
	context,
	value,
	onChange,
}: {
	locale: Locale;
	context: "buyer" | "seller";
	value: string;
	onChange: (value: string) => void;
}) {
	const t = authCopy[locale],
		business = context === "seller" ? "company" : "business";
	return (
		<fieldset className="intent-picker mt-2 mb-4 flex gap-2 border-0 p-0 desktop:gap-3">
			<legend className="mb-2.5 font-bold">{t.intent}</legend>
			{(["individual", business] as const).map((intent) => (
				<label
					key={intent}
					className="flex min-h-13 flex-1 cursor-pointer items-center gap-2.5 rounded-control border border-control p-2 text-base font-bold has-checked:border-primary has-checked:bg-primary has-checked:text-on-primary desktop:px-3 desktop:py-2.5 desktop:text-lg"
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
