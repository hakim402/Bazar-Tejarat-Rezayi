import type { Locale } from "../../lib/i18n/locales.ts";
import { copy as fa } from "./copy/fa-AF.ts";
import { copy as en } from "./copy/en.ts";
import { copy as ps } from "./copy/ps.ts";
import { copy as ar } from "./copy/ar.ts";
export const pageCopy = { "fa-AF": fa, en, ps, ar } satisfies Record<
	Locale,
	typeof fa
>;
