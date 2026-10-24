import type { PageDictionary } from "../types";

// Code-owned four-language page copy; development legal notices are deliberate.
export const copy: PageDictionary = {
	home: {
		title: "Bazar Rezayi — trade with clarity",
		intro:
			"Understand the marketplace, choose your account and explore retail and wholesale guidance.",
		sections: [
			{
				anchor: "buyers",
				heading: "For buyers",
				body: "Start with a buyer account. For wholesale buying, understand business verification and the minimum quantity attached to an offer.",
				steps: [],
				actions: [
					{
						label: "Wholesale buying guide",
						href: "/wholesale",
					},
				],
			},
			{
				anchor: "sellers",
				heading: "For sellers",
				body: "Individual sellers and companies follow registration and review steps. Creating an account does not itself approve a seller or publish a product.",
				steps: [],
				actions: [
					{
						label: "Start selling",
						href: "/sell",
					},
				],
			},
			{
				anchor: "learn",
				heading: "Know before you trade",
				body: "Read the verification, payment and delivery, and issue-resolution guides. Ordering and payment tools are not yet available in this public version.",
				steps: [],
				actions: [
					{
						label: "Visit the help centre",
						href: "/help",
					},
				],
			},
		],
	},
	"how-it-works": {
		title: "How the marketplace works",
		intro: "From choosing an account to understanding trading terms.",
		sections: [
			{
				anchor: "start",
				heading: "Choose the right account",
				body: "Buyer and seller sign-ins are separate. If you hold both roles, credentials are shared while permissions and approvals remain separate.",
				steps: [
					"Choose your role.",
					"Verify your email and complete the required profile.",
					"Follow the review status where verification is required.",
				],
				actions: [
					{
						label: "Create a buyer account",
						href: "/auth/buyer-registration",
					},
					{
						label: "Create a seller account",
						href: "/auth/seller-registration",
					},
				],
			},
			{
				anchor: "terms",
				heading: "Read the price and terms carefully",
				body: "Check the price, unit, quantity and seller. Site language does not change the trading currency. Wholesale eligibility depends on business verification and the relevant minimum quantity.",
				steps: [],
				actions: [
					{
						label: "Wholesale eligibility",
						href: "/wholesale",
					},
				],
			},
			{
				anchor: "availability",
				heading: "What is available now",
				body: "This version provides registration, accounts, profile review and public guides. Ordering, negotiation, payments, fulfilment and transaction messaging are not yet enabled for public use.",
				steps: [],
				actions: [
					{
						label: "Visit the help centre",
						href: "/help",
					},
					{
						label: "Contact platform support",
						href: "/contact",
					},
				],
			},
		],
	},
	wholesale: {
		title: "Wholesale buying, clearly explained",
		intro:
			"Understand the difference between seeing a wholesale price and qualifying to buy at it.",
		sections: [
			{
				anchor: "eligibility",
				heading: "Public prices, separate eligibility",
				body: "Marketplace rules provide for public retail and wholesale prices. Buying on wholesale terms is reserved for verified business buyers who meet the minimum quantity for the offer.",
				steps: [],
				actions: [],
			},
			{
				anchor: "prepare",
				heading: "Prepare your business profile",
				body: "Start with a buyer account and complete the business and authorized-representative details. Submit requested evidence through the private review flow. Registration does not mean automatic approval.",
				steps: [],
				actions: [
					{
						label: "Create a buyer account",
						href: "/auth/buyer-registration",
					},
					{
						label: "Understand verification",
						href: "/help/verification",
					},
				],
			},
			{
				anchor: "check",
				heading: "Check before buying",
				body: "Compare the selling unit, quantity, currency and delivery terms separately. Delivery charges are distinct from goods prices. Wholesale ordering is not yet active in this public version.",
				steps: [],
				actions: [
					{
						label: "How it works",
						href: "/how-it-works",
					},
				],
			},
		],
	},
	sell: {
		title: "Sell on Bazar Rezayi",
		intro: "A starting point for individual sellers and companies.",
		sections: [
			{
				anchor: "onboard",
				heading: "Start with the right profile",
				body: "Create a seller account, verify your email and choose an individual or company profile. Names and details should agree with the evidence you provide for review.",
				steps: [],
				actions: [
					{
						label: "Create a seller account",
						href: "/auth/seller-registration",
					},
				],
			},
			{
				anchor: "review",
				heading: "Review before public activity",
				body: "Sellers require staff review. Identity, business and representative-authority evidence is requested according to the profile type. Private documents and contact information are not displayed on a public seller page.",
				steps: [],
				actions: [
					{
						label: "Understand verification",
						href: "/help/verification",
					},
				],
			},
			{
				anchor: "catalogue",
				heading: "Accurate information, clear responsibility",
				body: "Prepare accurate specifications, images and prices for your goods. Description and image review is separate from price updates. Account creation or profile approval does not automatically publish goods or activate ordering.",
				steps: [],
				actions: [
					{
						label: "How it works",
						href: "/how-it-works",
					},
					{
						label: "Visit the help centre",
						href: "/help",
					},
				],
			},
		],
	},
	about: {
		title: "About Bazar Rezayi",
		intro:
			"A marketplace built around clear information and identifiable responsibilities.",
		sections: [
			{
				anchor: "purpose",
				heading: "Connecting people, with clear roles",
				body: "Bazar Rezayi brings buyers, individual sellers and seller companies together in one platform. Its purpose is to make retail and wholesale participation easier to understand.",
				steps: [],
				actions: [],
			},
			{
				anchor: "responsibilities",
				heading: "The platform and seller have distinct roles",
				body: "The seller responsible for an offer must be identifiable. Rezayi’s own selling activity is separate from platform administration. Account verification is not a guarantee of every product or payment insurance.",
				steps: [],
				actions: [],
			},
			{
				anchor: "next",
				heading: "Take an informed next step",
				body: "Learn how the marketplace works or choose the guide for your role. Editorial images illustrate the site; they do not establish stock or availability.",
				steps: [],
				actions: [
					{
						label: "How it works",
						href: "/how-it-works",
					},
					{
						label: "Visit the help centre",
						href: "/help",
					},
				],
				illustration: {
					src: "/images/marketplace/welcome.webp",
					alt: "Boxes, a blue shopping bag, pottery and a rug in an editorial marketplace image.",
				},
			},
		],
	},
	contact: {
		title: "Contact and support",
		intro: "Find the right guide or contact platform support.",
		sections: [
			{
				anchor: "help-first",
				heading: "Start with the right guide",
				body: "For sign-in and account roles, start with How it works. For seller or business review, use the verification guide. These guides help you prepare useful details before contacting support.",
				steps: [],
				actions: [
					{
						label: "How it works",
						href: "/how-it-works",
					},
					{
						label: "Understand verification",
						href: "/help/verification",
					},
					{
						label: "Visit the help centre",
						href: "/help",
					},
				],
			},
			{
				anchor: "reach-us",
				heading: "Reach platform support",
				body: "The approved support email, phone and website are listed in the contact section on this page. Share the subject and a brief description of your issue. No guaranteed response time or round-the-clock service is advertised.",
				steps: [],
				actions: [],
			},
			{
				anchor: "protect",
				heading: "Keep sensitive information private",
				body: "Do not send passwords, sign-in codes or recovery codes. Upload identity or business evidence only through the relevant private workflow. Platform support is not a route to disclose sellers’ private contacts.",
				steps: [],
				actions: [],
			},
		],
	},
	terms: {
		title: "Terms of use — development sample",
		intro:
			"Fictional information for local development testing; not final terms for an operating business.",
		sections: [
			{
				anchor: "development-sample",
				heading: "Fictional operator and sample age",
				body: "Example operator: Rezayi Demo Marketplace. Example country: Afghanistan. Example minimum age: 18. These are fictional testing values, not evidence of a registered company, a legal determination or implemented age verification.",
				steps: [],
				actions: [],
			},
			{
				anchor: "scope",
				heading: "Current service scope",
				body: "Current services include accounts, profiles, review and guidance content. Public ordering, payments, fulfilment and transaction messaging are not yet active. This page is not a goods-sale contract or guarantee of a transaction.",
				steps: [],
				actions: [],
			},
			{
				anchor: "accounts",
				heading: "Accounts and accurate information",
				body: "Provide accurate information and use only accounts you are authorized to access. Buyer and seller sign-ins and role permissions are separate. Protect passwords and security codes. Account verification does not guarantee all goods.",
				steps: [],
				actions: [],
			},
			{
				anchor: "conduct",
				heading: "Responsible use",
				body: "Do not impersonate others, submit false evidence, disclose others’ private information or attempt to bypass access controls. Use official platform support for account issues.",
				steps: [],
				actions: [
					{
						label: "Contact platform support",
						href: "/contact",
					},
				],
			},
			{
				anchor: "before-launch",
				heading: "Before operational use",
				body: "Before a real launch, the owner must replace and review the legal identity, governing law, actual age policy, fees, appeal process and transaction terms. This sample must not be relied on as the legal terms of a real transaction.",
				steps: [],
				actions: [],
			},
		],
	},
	privacy: {
		title: "Privacy policy — development sample",
		intro:
			"Demonstration policy for testing; retention periods and deletion procedures are not finalized.",
		sections: [
			{
				anchor: "development-sample",
				heading: "Development sample scope",
				body: "Example operator: Rezayi Demo Marketplace, Afghanistan, a fictional development identity. The sample age of 18 in the Terms is for testing. This is not the final privacy notice of an operating business.",
				steps: [],
				actions: [],
			},
			{
				anchor: "information",
				heading: "Information associated with the service",
				body: "Accounts include sign-in identity and profile details. Seller or business review may require identity, business and representative-authority evidence. Security events and sensitive changes are recorded for traceability.",
				steps: [],
				actions: [],
			},
			{
				anchor: "access",
				heading: "Public and private information",
				body: "Identity documents and review evidence are not intended for public display. Roles and permissions restrict private-workspace access. A seller’s private contact details must not be published in the public introduction.",
				steps: [],
				actions: [],
			},
			{
				anchor: "requests",
				heading: "Questions about your information",
				body: "Use official support contacts for questions about account information. Do not send passwords, sign-in codes or recovery codes. Identity confirmation may be needed to avoid disclosing information to the wrong person.",
				steps: [],
				actions: [
					{
						label: "Contact platform support",
						href: "/contact",
					},
				],
			},
			{
				anchor: "before-launch",
				heading: "Retention and requests need final decisions",
				body: "Data and evidence retention periods and deletion procedures are not finalized. No automatic deletion or response deadline is promised. Use official support for questions without sending sensitive material. Before real use, the owner must specify applicable rights, providers and data transfers.",
				steps: [],
				actions: [],
			},
		],
	},
	"payment-and-delivery": {
		title: "Payment and delivery guide",
		intro:
			"Understand goods prices, delivery charges and receipt confirmation separately.",
		sections: [
			{
				anchor: "current",
				heading: "Current service availability",
				body: "This guide explains the marketplace’s intended rules. Public ordering, payment and delivery tools are not yet active; this page is not a payment facility or confirmation of coverage.",
				steps: [],
				actions: [],
			},
			{
				anchor: "balances",
				heading: "Two distinct payment responsibilities",
				body: "Goods payments to the seller and delivery payments to the delivery provider are recorded separately. Sellers confirm goods receipts; Rezayi staff confirm delivery receipts. Confirming one does not settle the other.",
				steps: [],
				actions: [],
			},
			{
				anchor: "check",
				heading: "Clarify before agreeing",
				body: "Clarify the unit, quantity, currency, payment method and agreed destination. Advance payment or cash on delivery must be explicit. Staff finalize delivery charges before dispatch; do not assume free or universal delivery.",
				steps: [],
				actions: [],
			},
			{
				anchor: "records",
				heading: "Keep clear records",
				body: "Keep the amount, currency, date and payment reference. Sending a receipt does not itself confirm receipt of funds. Read the issue-resolution guide for cancellation or disputes; no instant-refund guarantee is advertised.",
				steps: [],
				actions: [
					{
						label: "Cancellations and disputes",
						href: "/help/cancellations-and-disputes",
					},
				],
			},
		],
	},
	"cancellations-and-disputes": {
		title: "Cancellations and disputes",
		intro:
			"Understand withdrawal, accepted-order cancellation and post-delivery issues.",
		sections: [
			{
				anchor: "before",
				heading: "Before seller finalization",
				body: "Under marketplace rules, a buyer may withdraw an unaccepted negotiable request before seller finalization. That differs from cancelling an accepted order. The public version does not yet enable this transaction workflow.",
				steps: [],
				actions: [],
			},
			{
				anchor: "after",
				heading: "After acceptance or delivery",
				body: "Accepted-order cancellation requires staff approval, with dispatch paused while cancellation is pending. Post-delivery issues follow dispute review; no blanket, unconditional returns policy is advertised.",
				steps: [],
				actions: [],
			},
			{
				anchor: "evidence",
				heading: "Explain the issue with clear evidence",
				body: "Prepare the relevant reference, dates and a clear description. Goods refunds are the seller’s responsibility; approved delivery refunds belong to the relevant provider, with Rezayi review and records. Use official platform support for guidance.",
				steps: [],
				actions: [
					{
						label: "Contact platform support",
						href: "/contact",
					},
				],
			},
		],
	},
	verification: {
		title: "Account and business verification",
		intro: "Who is reviewed, and what does verification mean?",
		sections: [
			{
				anchor: "who",
				heading: "Review follows the profile type",
				body: "Individual sellers provide identity evidence. Companies and business buyers provide business evidence and the representative’s identity and authority. The applicable review flow identifies the evidence required.",
				steps: [],
				actions: [],
			},
			{
				anchor: "steps",
				heading: "Complete the review steps",
				body: "Provide accurate, readable information. Respond to requests for clarification or further evidence through the same private flow. Email verification and business verification are different steps.",
				steps: [
					"Complete your profile.",
					"Provide the requested evidence privately.",
					"Follow the review status and correction requests.",
				],
				actions: [],
			},
			{
				anchor: "meaning",
				heading: "What verification does not promise",
				body: "Verification concerns the reviewed profile. It does not guarantee every product, delivery to every location or payment insurance. Check the offer terms and the site’s available functionality before trading.",
				steps: [],
				actions: [
					{
						label: "Contact platform support",
						href: "/contact",
					},
				],
			},
		],
	},
	help: {
		title: "Help centre",
		intro: "Guides to accounts, verification and marketplace rules.",
		sections: [],
	},
};
