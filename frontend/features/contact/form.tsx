"use client";

import { useRef, useState, type FormEvent } from "react";
import { Check, LoaderCircle } from "lucide-react";
import toast from "react-hot-toast";
import type { Locale } from "../../lib/i18n/locales";
import { AccountError, privateRequest } from "../../lib/api/private-client";
import { ApiError } from "../../lib/api/client";
import { Button } from "../../components/shadcn/button";
import { Input } from "../../components/shadcn/input";
import { NativeSelect } from "../../components/shadcn/native-select";
import { Textarea } from "../../components/shadcn/textarea";
import { contactCopy, topicValues } from "./copy";
import styles from "./contact.module.css";

export function ContactForm({ locale }: { locale: Locale }) {
	const t = contactCopy[locale];
	const [pending, setPending] = useState(false);
	const [sent, setSent] = useState(false);
	const [error, setError] = useState("");
	const [invalidFields, setInvalidFields] = useState<string[]>([]);
	const busy = useRef(false);
	const successHeading = useRef<HTMLHeadingElement>(null);
	const nameField = useRef<HTMLInputElement>(null);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy.current) return;
		const form = event.currentTarget;
		const fields = new FormData(form);
		const packet = Object.fromEntries(
			["name", "email", "topic", "reference", "message", "website"].map(
				(key) => [key, String(fields.get(key) ?? "").trim()],
			),
		);
		const bad = [
			...(packet.name.length < 2 || packet.name.length > 120 ? ["name"] : []),
			...(!packet.email || packet.email.length > 254 ? ["email"] : []),
			...(!topicValues.some((value) => value === packet.topic)
				? ["topic"]
				: []),
			...(packet.reference.length > 100 ? ["reference"] : []),
			...(packet.message.length < 10 || packet.message.length > 4000
				? ["message"]
				: []),
		];
		if (bad.length) {
			setInvalidFields(bad);
			setError(t.invalid);
			toast.error(t.invalid);
			(form.elements.namedItem(bad[0]) as HTMLElement | null)?.focus();
			return;
		}
		busy.current = true;
		setPending(true);
		setError("");
		setInvalidFields([]);
		try {
			const result = await privateRequest<{ status: string }>(
				`site/contact/${locale}/`,
				packet,
				"POST",
				{ timeoutMs: 40000 },
			);
			if (result.status !== "sent") throw new ApiError("invalid");
			setSent(true);
			toast.success(t.success);
			requestAnimationFrame(() => successHeading.current?.focus());
		} catch (failure) {
			const fields = failure instanceof AccountError ? failure.fields : [];
			const message =
				failure instanceof AccountError && failure.status === 429
					? t.limited
					: failure instanceof AccountError && failure.status === 400
						? t.invalid
						: failure instanceof ApiError &&
								(failure.kind === "timeout" || failure.kind === "unavailable")
							? t.uncertain
							: t.error;
			setInvalidFields(fields);
			setError(message);
			toast.error(message);
			const field = fields.find((key) =>
				["name", "email", "topic", "reference", "message"].includes(key),
			);
			if (field)
				(form.elements.namedItem(field) as HTMLElement | null)?.focus();
		} finally {
			busy.current = false;
			setPending(false);
		}
	}

	if (sent)
		return (
			<div className="flex min-h-96 flex-col items-center justify-center px-5 py-12 text-center">
				<span className="mb-5 flex size-14 items-center justify-center rounded-full bg-info text-action">
					<Check className="size-7" aria-hidden="true" />
				</span>
				<h2
					ref={successHeading}
					tabIndex={-1}
					className="text-2xl outline-none"
				>
					{t.success}
				</h2>
				<p className="mt-3 max-w-sm leading-7 text-muted">{t.successBody}</p>
				<Button
					type="button"
					variant="outline"
					className="mt-7"
					onClick={() => {
						setSent(false);
						requestAnimationFrame(() => nameField.current?.focus());
					}}
				>
					{t.another}
				</Button>
			</div>
		);

	const invalid = (field: string) => invalidFields.includes(field);
	return (
		<form
			method="post"
			onSubmit={submit}
			aria-busy={pending}
			className={styles.contactForm}
		>
			<div className={styles.nameEmail}>
				<div className={styles.field}>
					<label htmlFor="contact-name" className={styles.label}>
						{t.name}
					</label>
					<Input
						ref={nameField}
						id="contact-name"
						name="name"
						autoComplete="name"
						required
						minLength={2}
						maxLength={120}
						aria-invalid={invalid("name")}
						aria-describedby={invalid("name") ? "contact-error" : undefined}
						className={styles.lineField}
					/>
				</div>
				<div className={styles.field}>
					<label htmlFor="contact-email" className={styles.label}>
						{t.email}
					</label>
					<Input
						id="contact-email"
						name="email"
						type="email"
						dir="ltr"
						autoComplete="email"
						required
						maxLength={254}
						aria-invalid={invalid("email")}
						aria-describedby={invalid("email") ? "contact-error" : undefined}
						className={styles.lineField}
					/>
				</div>
			</div>
			<div className={styles.field}>
				<label htmlFor="contact-topic" className={styles.label}>
					{t.topic}
				</label>
				<NativeSelect
					id="contact-topic"
					name="topic"
					required
					defaultValue=""
					aria-invalid={invalid("topic")}
					aria-describedby={invalid("topic") ? "contact-error" : undefined}
					className={styles.lineField}
				>
					<option value="" disabled>
						{t.choose}
					</option>
					{topicValues.map((value, index) => (
						<option key={value} value={value}>
							{t.topics[index]}
						</option>
					))}
				</NativeSelect>
			</div>
			<div className={styles.field}>
				<label
					htmlFor="contact-message"
					className={`${styles.label} ${styles.messageLabel}`}
				>
					{t.message}
				</label>
				<Textarea
					id="contact-message"
					name="message"
					required
					minLength={10}
					maxLength={4000}
					rows={4}
					aria-invalid={invalid("message")}
					aria-describedby={`contact-privacy${invalid("message") ? " contact-error" : ""}`}
					className={`${styles.lineField} ${styles.message}`}
				/>
			</div>
			<input type="hidden" name="reference" value="" />
			<div hidden aria-hidden="true">
				<label htmlFor="contact-website">Website</label>
				<input
					id="contact-website"
					name="website"
					tabIndex={-1}
					autoComplete="off"
				/>
			</div>
			{error && (
				<p
					id="contact-error"
					role="alert"
					className="rounded-md border border-danger/25 bg-danger/5 p-3 text-sm leading-6 text-danger"
				>
					{error}
				</p>
			)}
			<Button type="submit" disabled={pending} className={styles.send}>
				{pending && (
					<LoaderCircle
						className="size-4 animate-spin motion-reduce:animate-none"
						aria-hidden="true"
					/>
				)}
				{pending ? t.sending : t.send}
			</Button>
			<p id="contact-privacy" className={styles.privacy}>
				{t.privacy}
			</p>
		</form>
	);
}
