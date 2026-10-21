import "server-only";
import { cache } from "react";
import {
	publicCall,
	validContent,
	validList,
	validShell,
	contentPath,
} from "./public";
export const readContent = cache(async (locale: string, key: string) => {
	try {
		return {
			data: await publicCall(
				process.env.API_INTERNAL_URL,
				contentPath(locale, key),
				validContent,
			),
			failure: false,
		};
	} catch {
		return { data: null, failure: true };
	}
});
export const readShell = cache(async (locale: string) => {
	try {
		return await publicCall(
			process.env.API_INTERNAL_URL,
			`${locale}/shell/`,
			validShell,
		);
	} catch {
		return null;
	}
});
export const readHelp = cache(async (locale: string, page: number) => {
	try {
		return {
			data: await publicCall(
				process.env.API_INTERNAL_URL,
				`${locale}/help/?page=${page}`,
				validList,
			),
			failure: false,
		};
	} catch {
		return { data: null, failure: true };
	}
});
