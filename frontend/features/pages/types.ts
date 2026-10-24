import type { PageKey } from "./registry";
export type PageAction = { label: string; href: string };
export type PageSection = {
	anchor: string;
	heading: string;
	body: string;
	steps: string[];
	actions: PageAction[];
	illustration?: { src: string; alt: string };
};
export type PageCopy = {
	title: string;
	intro: string;
	sections: PageSection[];
};
export type PageDictionary = Record<PageKey, PageCopy>;
