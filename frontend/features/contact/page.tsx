import { Clock3, Mail, MapPin, Phone } from "lucide-react";
import type { Locale } from "../../lib/i18n/locales";
import { direction } from "../../lib/i18n/locales";
import { siteCopy } from "../../lib/i18n/site";
import { PublicShell } from "../../components/layout/public-shell";
import { Card } from "../../components/shadcn/card";
import { readSite } from "../site/server";
import { contactCopy } from "./copy";
import { ContactForm } from "./form";
import styles from "./contact.module.css";

export async function ContactPage({ locale }: { locale: Locale }) {
	const site = await readSite(locale),
		t = contactCopy[locale],
		ui = siteCopy[locale];
	const contacts = site?.contacts;
	return (
		<PublicShell
			locale={locale}
			site={site}
			hero={
				<section
					lang={locale}
					dir={direction(locale)}
					className={styles.page}
					aria-labelledby="contact-title"
				>
					<div className={styles.inner}>
						<header className={styles.heading}>
							<h1 id="contact-title">{t.title}</h1>
							<p>{t.intro}</p>
						</header>
						<Card className={styles.card}>
							<aside
								className={styles.information}
								aria-labelledby="contact-information"
							>
								<div className={styles.informationContent}>
									<h2 id="contact-information">{t.details}</h2>
									<p className={styles.informationIntro}>{t.security}</p>
									<address className={styles.details}>
										{contacts?.phone && (
											<a href={`tel:${contacts.phone.replace(/[ ()-]/g, "")}`}>
												<Phone aria-hidden="true" />
												<bdi dir="ltr">{contacts.phone}</bdi>
											</a>
										)}
										{contacts?.email && (
											<a href={`mailto:${contacts.email}`}>
												<Mail aria-hidden="true" />
												<bdi dir="ltr">{contacts.email}</bdi>
											</a>
										)}
										{site?.identity.address && (
											<p>
												<MapPin aria-hidden="true" />
												<span
													lang={site.identity.content_locale}
													dir={direction(site.identity.content_locale)}
												>
													{site.identity.address}
												</span>
											</p>
										)}
										{site?.identity.hours && (
											<p>
												<Clock3 aria-hidden="true" />
												<span
													lang={site.identity.content_locale}
													dir={direction(site.identity.content_locale)}
												>
													{site.identity.hours}
												</span>
											</p>
										)}
										{!contacts?.email &&
											!contacts?.phone &&
											!site?.identity.address &&
											!site?.identity.hours && <p>{ui.noContact}</p>}
									</address>
								</div>
								<span className={styles.circle} aria-hidden="true" />
							</aside>
							<div className={styles.form}>
								<h2 className="sr-only">{t.formTitle}</h2>
								<ContactForm locale={locale} />
							</div>
						</Card>
					</div>
				</section>
			}
		/>
	);
}
