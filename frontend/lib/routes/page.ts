import { notFound } from "next/navigation";
import { isLocale } from "../i18n/locales";
import { uuidPattern } from "./account-routes";
export function pageLocale(value: string) {
	if (!isLocale(value)) notFound();
	return value;
}
export function resourceId(value: string) {
	if (!uuidPattern.test(value)) notFound();
	return value;
}
