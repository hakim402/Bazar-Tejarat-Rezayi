import { Icon } from "../../../components/ui/icon";
import type { Locale } from "../../../lib/i18n/locales";
import { productFlowCopy } from "../../../lib/i18n/seller-products";

/** Shared by private product setup and its editor; steps never submit a form. */
export function ProductSteps({
	locale,
	current,
	onChange,
	disabled = false,
}: {
	locale: Locale;
	current: number;
	onChange?: (step: number) => void;
	disabled?: boolean;
}) {
	const t = productFlowCopy[locale];
	return (
		<nav aria-label={t.step} className="mx-auto w-full max-w-4xl py-2 sm:py-5">
			<ol className="m-0 flex list-none p-0">
				{t.steps.map((label, index) => (
					<li
						key={label}
						aria-current={index === current ? "step" : undefined}
						className="relative min-w-0 flex-1 last:flex-none last:w-12 sm:last:w-28"
					>
						{index < t.steps.length - 1 && (
							<span
								aria-hidden="true"
								className={`absolute start-6 end-0 top-5 h-0.5 sm:start-10 ${index < current ? "bg-action" : "bg-border"}`}
							/>
						)}
						<button
							type="button"
							disabled={disabled || !onChange || index === 0 || index > current}
							onClick={() => onChange?.(index)}
							aria-label={`${t.step} ${index + 1}: ${label}`}
							className="relative flex min-h-11 w-full flex-col items-start gap-2 border-0 bg-transparent p-0 text-start disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-action"
						>
							<span
								className={`flex size-10 shrink-0 items-center justify-center rounded-full border text-sm font-semibold sm:size-11 ${index <= current ? "border-action bg-action text-on-primary" : "border-border bg-surface text-muted"}`}
							>
								{index < current ? (
									<Icon name="check" className="size-4" />
								) : (
									new Intl.NumberFormat(locale).format(index + 1)
								)}
							</span>
							<span
								className={`hidden pe-3 text-xs sm:block ${index === current ? "font-semibold text-foreground" : "text-muted"}`}
							>
								{label}
							</span>
						</button>
					</li>
				))}
			</ol>
			<p className="mt-3 text-sm font-medium text-foreground sm:hidden">
				{t.step} {new Intl.NumberFormat(locale).format(current + 1)} ·{" "}
				{t.steps[current]}
			</p>
		</nav>
	);
}

/** Server field errors and summary links reveal the same owning form step. */
export function productStepForIssue(path: string): number | undefined {
	if (path.startsWith("body.variants") || path.startsWith("prices")) return 2;
	if (path.startsWith("body.images") || path === "file") return 3;
	if (path.startsWith("body.")) return 1;
	return undefined;
}
