// Session memory only. Logout/access loss clears sensitive material; nothing is
// written to browser storage, query strings, analytics, SSR or page metadata.
import type { ImageRef } from "./api";
export type Prepared = {
	localId: string;
	file?: File;
	command: string;
	image?: ImageRef;
	failed?: boolean;
};
export type Pending = { command_id: string; body: string; images: string[] };
export type Draft = { body: string; images: Prepared[]; pending?: Pending };
const drafts = new Map<string, Draft>();
export function draftFor(key: string): Draft {
	return drafts.get(key) ?? { body: "", images: [] };
}
export function saveDraft(key: string, draft: Draft) {
	drafts.set(key, draft);
}
export function clearDrafts() {
	drafts.clear();
}
export function dropDraft(key: string) {
	drafts.delete(key);
}
export function scopeKey(
	identity: string,
	context: string,
	seller: string,
	thread: string,
) {
	return `${identity}:${context}:${seller}:${thread}`;
}
