/** Format a canonical decimal for display without converting it to a number. */
export function displayDecimal(value: string | null | undefined): string {
	if (value == null) return "—";
	return value.includes(".")
		? value.replace(/0+$/, "").replace(/\.$/, "")
		: value;
}
