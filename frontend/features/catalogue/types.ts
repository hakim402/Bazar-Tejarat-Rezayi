import type { components } from "../../lib/api/schema";
import type { Locale } from "../../lib/i18n/locales";
export type Labels = Record<Locale, string>;
export type Attribute = {
	editorKey?: string;
	code: string;
	labels: Labels;
	type: "text" | "enum" | "decimal" | "boolean";
	required?: boolean;
	variant?: boolean;
	choices?: string[];
};
export type Category = {
	code: string;
	labels: Labels;
	attributes: Attribute[];
	units: string[];
	active: boolean;
	parent: string | null;
	version: number;
};
export type Taxonomy = {
	categories: Category[];
	units: {
		code: string;
		labels: Labels;
		fractional: boolean;
		version: number;
		active: boolean;
	}[];
};
export type Variant = {
	unit_labels?: Labels;
	attribute_labels?: Record<string, Labels>;
	clientKey?: string;
	id?: string | null;
	sku: string;
	unit: string;
	increment: string;
	minimum: string;
	contents: string;
	attributes: Record<string, string | boolean>;
	active: boolean;
	retail?: string | null;
	wholesale?: string | null;
};
export type ImageRef = { id: string; alt: string; variant?: string | null };
export type ProductBody = {
	attribute_labels?: Record<string, Labels>;
	title: string;
	description: string;
	brand: string;
	locale: Locale;
	category: string;
	attributes: Record<string, string | boolean>;
	variants: Variant[];
	images: ImageRef[];
};
export type Revision = {
	id: string;
	number: number;
	body: ProductBody;
	state: string;
	reason: string;
};
export type Price = {
	id: string;
	sku: string;
	retail: string | null;
	wholesale: string | null;
};
export type Translation = {
	id: string;
	revision: string;
	locale: Locale;
	title: string;
	description: string;
	image_alts: Record<string, string>;
	state: string;
	version: number;
	human_edited: boolean;
	has_approved: boolean;
	job: { status: string; attempts: number; error_code: string } | null;
};
export type ProductDetail = {
	id: string;
	seller: string;
	seller_name: string;
	currency: "AFN" | "USD";
	pricing_mode: "fixed" | "negotiable";
	version: number;
	published: string | null;
	revisions: Revision[];
	images: { id: string; width: number; height: number; url: string }[];
	prices: Price[];
	price_history: {
		variant: string;
		retail: string | null;
		wholesale: string | null;
		version: number;
		at: string;
	}[];
	translations: Translation[];
	permissions: string[];
	provider: string;
};
export type ProductList = {
	results: {
		id: string;
		title: string;
		state: string;
		version: number;
		seller: string;
		published: string | null;
	}[];
	sellers: { id: string; name: string }[];
	permissions: string[];
	count: number;
	page: number;
};
export type Operation = components["schemas"]["CatalogueOperation"];
