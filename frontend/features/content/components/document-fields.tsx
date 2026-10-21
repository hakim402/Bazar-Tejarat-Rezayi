"use client";
import { useId, type ComponentProps } from "react";
import { useValidationFields } from "./editor-validation";
import type { Locale } from "../../../lib/i18n/locales";
import { contentCopy, contentTypeNames } from "../../../lib/i18n/content";
import { Button } from "../../../components/ui/button";
import type { Document as DocumentData, Section } from "../types";
export const fieldClass =
	"mt-1 block min-h-11 w-full min-w-0 rounded-control border border-control bg-surface p-3 text-foreground";
export function Field({
	label,
	path,
	...props
}: ComponentProps<"input"> & { label: string; path?: string }) {
	const validation = useValidationFields();
	const generatedId = useId();
	const { message, ...attributes } = validation(
		path ?? props.name ?? generatedId,
	);
	return (
		<div className="block min-w-0">
			<label htmlFor={attributes.id}>{label}</label>
			<input {...props} {...attributes} className={fieldClass} />
			{message && (
				<span
					id={`${attributes.id}-error`}
					className="block break-words text-danger"
				>
					{message}
				</span>
			)}
		</div>
	);
}
export function Area({
	label,
	path,
	...props
}: ComponentProps<"textarea"> & { label: string; path?: string }) {
	const validation = useValidationFields();
	const generatedId = useId();
	const { message, ...attributes } = validation(
		path ?? props.name ?? generatedId,
	);
	return (
		<div className="block min-w-0">
			<label htmlFor={attributes.id}>{label}</label>
			<textarea {...props} {...attributes} className={fieldClass} />
			{message && (
				<span
					id={`${attributes.id}-error`}
					className="block break-words text-danger"
				>
					{message}
				</span>
			)}
		</div>
	);
}
type Links = NonNullable<Section["links"]>;
export function LinkFields({
	prefix,
	value,
	onChange,
	locale,
}: {
	prefix: string;
	value: Links;
	onChange: (value: Links) => void;
	locale: Locale;
}) {
	const t = contentCopy[locale];
	return (
		<fieldset className="min-w-0 space-y-3">
			<legend>{t.links}</legend>
			{value.map((link, i) => (
				<div
					key={link.id}
					className="grid gap-3 rounded-control border border-border p-3 desktop:grid-cols-2"
				>
					<Field
						label={`${t.label} ${i + 1}`}
						path={`${prefix}.${i}.label`}
						value={link.label}
						maxLength={120}
						required
						onChange={(e) =>
							onChange(
								value.map((l, n) =>
									n === i ? { ...l, label: e.target.value } : l,
								),
							)
						}
					/>
					<Field
						label={`${t.target} ${i + 1}`}
						path={`${prefix}.${i}.target`}
						value={link.target}
						maxLength={180}
						required
						dir="ltr"
						onChange={(e) =>
							onChange(
								value.map((l, n) =>
									n === i ? { ...l, target: e.target.value } : l,
								),
							)
						}
					/>
					<Button
						variant="secondary"
						onClick={() => onChange(value.filter((_, n) => n !== i))}
					>
						{t.remove} {i + 1}
					</Button>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="secondary"
							disabled={i === 0}
							onClick={() => {
								const next = [...value];
								[next[i - 1], next[i]] = [next[i], next[i - 1]];
								onChange(next);
							}}
						>
							{t.up} {i + 1}
						</Button>
						<Button
							variant="secondary"
							disabled={i === value.length - 1}
							onClick={() => {
								const next = [...value];
								[next[i + 1], next[i]] = [next[i], next[i + 1]];
								onChange(next);
							}}
						>
							{t.down} {i + 1}
						</Button>
					</div>
				</div>
			))}
			<Button
				variant="secondary"
				disabled={value.length >= 8}
				onClick={() =>
					onChange([
						...value,
						{ id: crypto.randomUUID(), label: "", target: "/help" },
					])
				}
			>
				{t.add} · {t.links}
			</Button>
		</fieldset>
	);
}
export function DocumentFields({
	data,
	onChange,
	kind,
	locale,
}: {
	data: DocumentData;
	onChange: (d: DocumentData) => void;
	kind: string;
	locale: Locale;
}) {
	const t = contentCopy[locale],
		blocks = data.blocks ?? [],
		groups = data.navigation ?? [];
	function update(i: number, partial: Partial<Section>) {
		onChange({
			...data,
			blocks: blocks.map((b, n) => (n === i ? { ...b, ...partial } : b)),
		});
	}
	return (
		<div className="space-y-5">
			<Field
				label={t.title}
				name="title"
				path="payload.title"
				value={data.title}
				required
				maxLength={180}
				onChange={(e) => onChange({ ...data, title: e.target.value })}
			/>
			<Area
				label={t.description}
				path="payload.description"
				value={data.description ?? ""}
				maxLength={400}
				onChange={(e) => onChange({ ...data, description: e.target.value })}
			/>
			{kind === "article" && (
				<Field
					label={t.group}
					path="payload.group"
					value={data.group ?? ""}
					maxLength={100}
					onChange={(e) => onChange({ ...data, group: e.target.value })}
				/>
			)}
			{kind === "support" && (
				<fieldset className="space-y-4">
					<legend>{t.contact}</legend>
					{(["email", "phone", "website"] as const).map((key) => (
						<Field
							key={key}
							label={t[key]}
							path={`payload.support.${key}`}
							dir="ltr"
							type={
								key === "email" ? "email" : key === "website" ? "url" : "tel"
							}
							value={data.support?.[key] ?? ""}
							onChange={(e) =>
								onChange({
									...data,
									support: {
										email: "",
										phone: "",
										website: "",
										...data.support,
										[key]: e.target.value,
									},
								})
							}
						/>
					))}
				</fieldset>
			)}
			{kind === "shell" ? (
				<fieldset className="space-y-5">
					<legend>{t.navigation}</legend>
					{groups.map((g, i) => (
						<div
							key={g.id}
							className="space-y-4 rounded-card border border-border p-4"
						>
							<Field
								label={`${t.label} ${i + 1}`}
								path={`payload.navigation.${i}.label`}
								value={g.label}
								maxLength={100}
								required
								onChange={(e) =>
									onChange({
										...data,
										navigation: groups.map((v, n) =>
											n === i ? { ...v, label: e.target.value } : v,
										),
									})
								}
							/>
							<label>
								{t.type}
								<select
									className={fieldClass}
									value={g.placement}
									onChange={(e) =>
										onChange({
											...data,
											navigation: groups.map((v, n) =>
												n === i
													? {
															...v,
															placement: e.target.value as "header" | "footer",
														}
													: v,
											),
										})
									}
								>
									<option value="header">{t.header}</option>
									<option value="footer">{t.footer}</option>
								</select>
							</label>
							<LinkFields
								locale={locale}
								prefix={`payload.navigation.${i}.links`}
								value={g.links}
								onChange={(links) =>
									onChange({
										...data,
										navigation: groups.map((v, n) =>
											n === i ? { ...v, links } : v,
										),
									})
								}
							/>
							<Button
								variant="secondary"
								onClick={() =>
									onChange({
										...data,
										navigation: groups.filter((_, n) => n !== i),
									})
								}
							>
								{t.remove} {i + 1}
							</Button>
						</div>
					))}
					<Button
						variant="secondary"
						disabled={groups.length >= 6}
						onClick={() =>
							onChange({
								...data,
								navigation: [
									...groups,
									{
										id: crypto.randomUUID(),
										label: "",
										placement: "footer",
										links: [],
									},
								],
							})
						}
					>
						{t.add} · {t.navigation}
					</Button>
				</fieldset>
			) : (
				kind !== "support" && (
					<fieldset className="min-w-0 space-y-5">
						<legend>{t.sections}</legend>
						{blocks.map((b, i) => (
							<fieldset
								key={b.id}
								className="min-w-0 space-y-4 rounded-card border border-border p-4"
							>
								<legend>
									<bdi>{b.id}</bdi>
								</legend>
								<label>
									{t.type}
									<select
										className={fieldClass}
										value={b.type}
										onChange={(e) =>
											update(i, { type: e.target.value as Section["type"] })
										}
									>
										{[
											"hero",
											"text",
											"steps",
											"guides",
											"callout",
											...(kind === "home" ? ["catalogue", "store"] : []),
										].map((type) => (
											<option key={type} value={type}>
												{contentTypeNames[locale][type]}
											</option>
										))}
									</select>
								</label>
								<label className="flex gap-3">
									<input
										type="checkbox"
										checked={b.enabled !== false}
										onChange={(e) => update(i, { enabled: e.target.checked })}
									/>
									{t.enabled}
								</label>
								<Field
									label={`${t.title} ${i + 1}`}
									path={`payload.blocks.${i}.title`}
									value={b.title ?? ""}
									maxLength={180}
									onChange={(e) => update(i, { title: e.target.value })}
								/>
								<Area
									label={`${t.text} ${i + 1}`}
									path={`payload.blocks.${i}.text`}
									rows={5}
									value={b.text ?? ""}
									maxLength={6000}
									onChange={(e) => update(i, { text: e.target.value })}
								/>
								{!["catalogue", "store"].includes(b.type) && (
									<>
										<Area
											label={t.items}
											path={`payload.blocks.${i}.items`}
											value={b.items?.join("\n") ?? ""}
											onChange={(e) =>
												update(i, {
													items: e.target.value
														? e.target.value.split("\n")
														: [],
												})
											}
										/>
										<label>
											{t.asset}
											<select
												className={fieldClass}
												value={b.asset ?? ""}
												onChange={(e) =>
													update(i, {
														asset: e.target.value as Section["asset"],
													})
												}
											>
												<option value="">{t.none}</option>
												<option value="welcome">{t.welcome}</option>
											</select>
										</label>
										<Field
											label={t.alt}
											path={`payload.blocks.${i}.alt`}
											value={b.alt ?? ""}
											maxLength={200}
											onChange={(e) => update(i, { alt: e.target.value })}
										/>
										<LinkFields
											locale={locale}
											prefix={`payload.blocks.${i}.links`}
											value={b.links ?? []}
											onChange={(links) => update(i, { links })}
										/>
									</>
								)}
								<div className="flex flex-wrap gap-2">
									<Button
										variant="secondary"
										disabled={!i}
										onClick={() => {
											const next = [...blocks];
											[next[i - 1], next[i]] = [next[i], next[i - 1]];
											onChange({ ...data, blocks: next });
										}}
									>
										{t.up} {i + 1}
									</Button>
									<Button
										variant="secondary"
										disabled={i === blocks.length - 1}
										onClick={() => {
											const next = [...blocks];
											[next[i + 1], next[i]] = [next[i], next[i + 1]];
											onChange({ ...data, blocks: next });
										}}
									>
										{t.down} {i + 1}
									</Button>
									<Button
										variant="secondary"
										onClick={() =>
											onChange({
												...data,
												blocks: blocks.filter((_, n) => n !== i),
											})
										}
									>
										{t.remove} {i + 1}
									</Button>
								</div>
							</fieldset>
						))}
						<Button
							variant="secondary"
							disabled={blocks.length >= 24}
							onClick={() =>
								onChange({
									...data,
									blocks: [
										...blocks,
										{
											id: `section-${crypto.randomUUID().slice(0, 8)}`,
											type: "text",
											enabled: true,
											title: "",
											text: "",
											items: [],
											links: [],
											asset: "",
											alt: "",
										},
									],
								})
							}
						>
							{t.add} · {t.sections}
						</Button>
					</fieldset>
				)
			)}
		</div>
	);
}
