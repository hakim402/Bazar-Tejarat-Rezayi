"use client";
import { createContext, useContext, useEffect, useRef } from "react";
import {
	AccountError,
	type ValidationIssue,
} from "../../../lib/api/private-client";
import { contentCopy } from "../../../lib/i18n/content";
import { contentEditorCopy } from "../../../lib/i18n/content-editor";
import type { Locale } from "../../../lib/i18n/locales";
export type Feedback = { message: string; issues: ValidationIssue[] };
export function editorFailure(error: unknown, locale: Locale): Feedback {
	const t = contentEditorCopy[locale];
	if (!(error instanceof AccountError))
		return { message: t.dependency, issues: [] };
	if (error.status === 409)
		return { message: contentCopy[locale].conflict, issues: [] };
	if (error.status === 401 || error.status === 403)
		return { message: t.denied, issues: [] };
	if (error.status === 429) return { message: t.limited, issues: [] };
	if (error.status === 400)
		return { message: t.validation, issues: error.violations };
	return {
		message: (error.status ?? 500) >= 500 ? t.dependency : t.documentRule,
		issues: [],
	};
}
export function issueMessage(code: string, locale: Locale) {
	const t = contentEditorCopy[locale];
	switch (code) {
		case "plain_text":
			return t.plainText;
		case "internal_target":
			return t.target;
		case "source_structure":
			return t.source;
		case "max_length":
		case "min_length":
		case "list_limit":
			return t.limit;
		case "document_limit":
			return t.documentLimit;
		case "image_alt":
			return t.image;
		case "unique_items":
			return t.unique;
		case "required":
		case "blank":
		case "invalid":
		case "invalid_choice":
		case "null":
			return t.required;
		default:
			return t.documentRule;
	}
}
export const fieldId = (path: string) =>
	`content-field-${path.replaceAll(".", "-")}`;
export const ValidationContext = createContext<{
	issues: ValidationIssue[];
	locale: Locale;
}>({ issues: [], locale: "fa-AF" });
export function useValidationFields() {
	const { issues, locale } = useContext(ValidationContext);
	return (path: string) => {
		const errors = issues.filter((i) => i.path === path);
		return {
			id: fieldId(path),
			"aria-invalid": errors.length > 0,
			"aria-describedby": errors.length ? `${fieldId(path)}-error` : undefined,
			message: errors.map((e) => issueMessage(e.code, locale)).join(" "),
		};
	};
}
export function EditorFeedback({
	feedback,
	locale,
}: {
	feedback: Feedback;
	locale: Locale;
}) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (feedback.message || feedback.issues.length) ref.current?.focus();
	}, [feedback.message, feedback.issues]);
	return (
		<div
			ref={ref}
			tabIndex={-1}
			role="alert"
			className="min-w-0 space-y-3 break-words rounded-control bg-danger-surface p-4 text-danger"
		>
			<p>{feedback.message}</p>
			{feedback.issues.length > 0 && (
				<ul>
					{feedback.issues.map((issue) => (
						<li key={`${issue.path}-${issue.code}`}>
							{typeof document !== "undefined" &&
							document.getElementById(fieldId(issue.path)) ? (
								<button
									type="button"
									className="min-h-11 cursor-pointer border-0 bg-transparent p-0 text-start text-inherit underline"
									onClick={() => {
										document.getElementById(fieldId(issue.path))?.focus();
									}}
								>
									{issueMessage(issue.code, locale)} <bdi>{issue.path}</bdi>
								</button>
							) : (
								<p>{issueMessage(issue.code, locale)}</p>
							)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
