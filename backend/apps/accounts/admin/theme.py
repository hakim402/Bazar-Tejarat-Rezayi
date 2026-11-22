"""Single source of truth for owner-admin presentation.

Every class below ships in Unfold's compiled ``static/unfold/css/styles.css`` —
no custom Tailwind build is required. ``admin_display`` consumes the badge palette
and the dashboard context exposes ``THEME`` so templates never hard-code colours.
Display-only: no permission, guard or business behavior lives here.
"""

# --- Neutral surfaces & text (theme-aware light/dark) -----------------------
CARD = "rounded-lg border border-base-200 bg-white shadow-sm dark:border-base-800 dark:bg-base-900"
CARD_HOVER = "transition-colors hover:border-primary-400"
TEXT = "text-base-900 dark:text-base-100"
MUTED = "text-base-500 dark:text-base-400"
FAINT = "text-base-400 dark:text-base-500"
ACTION = "text-primary-600 dark:text-primary-400"
DIVIDER = "border-base-200 dark:border-base-800"
ICON_TILE = (
    "flex shrink-0 items-center justify-center rounded-md bg-primary-50 "
    "text-primary-600 dark:bg-primary-950 dark:text-primary-400"
)
SECTION_TITLE = "text-base font-semibold text-base-900 dark:text-base-100"
LISTING_THEME = {"table": "whitespace-nowrap"}
ORDER_THEME = {
    "layout": "flex min-w-0 flex-col gap-6",
    "panel": f"{CARD} flex flex-col gap-3 p-5 text-sm",
    "heading": f"text-xl font-semibold {TEXT}",
    "section_heading": f"text-lg font-semibold {TEXT}",
    "history": f"rounded-default border {DIVIDER} p-3",
    "form": "flex flex-col gap-3",
    "button": "inline-flex items-center justify-center rounded-default bg-primary-600 px-4 py-2 font-medium text-white",
    "label": f"block mb-2 font-medium {TEXT}",
    "error": "text-sm text-red-600 dark:text-red-400",
    "toolbar": "flex flex-wrap items-center justify-between gap-3",
    "status_grid": "grid grid-cols-1 gap-4 lg:grid-cols-3",
    "workspace_grid": "grid grid-cols-1 items-start gap-6 lg:grid-cols-3",
    "main_column": "min-w-0 lg:col-span-2",
    "eyebrow": f"flex items-center gap-2 text-xs font-semibold {MUTED}",
    "metric": f"text-base font-semibold break-words {TEXT}",
    "muted": MUTED,
    "notice": f"{CARD} flex flex-wrap items-center gap-2 p-4 text-sm {TEXT}",
    "secondary_button": f"inline-flex items-center justify-center gap-2 rounded-default border {DIVIDER} px-3 py-2 text-sm font-medium {ACTION}",
    "disclosure": f"cursor-pointer text-sm font-semibold {ACTION}",
    "detail_body": "flex flex-col gap-3 pt-3",

}
CHIP = (
    "rounded-md bg-primary-50 px-2 py-0.5 text-[11px] font-semibold uppercase "
    "text-primary-600 dark:bg-primary-950 dark:text-primary-400"
)

# --- Status badge palette (moved verbatim from admin_display) ---------------
BADGE_BASE = (
    "font-semibold h-[18px] leading-[18px] px-1 rounded-xs text-center text-[11px] "
    "whitespace-nowrap uppercase min-w-[18px] inline-block align-middle"
)
BADGE_COLORS = {
    "warning": "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400",
    "success": "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400",
    "danger": "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
    "info": "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
    "default": "bg-base-100 text-base-700 dark:bg-base-500/20 dark:text-base-400",
}
STATE_VARIANTS = {
    "warning": {
        "pending", "open", "submitted", "under_review", "reported", "review_required",
        "shortage", "blocked_zero", "queued", "retry_due", "claimed", "dispatching",
        "draft", "referred", "incomplete", "unpaid", "partial", "expiring",
        "needs_information", "accepted", "reopen", "unread",
    },
    "success": {
        "approved", "confirmed", "completed", "active", "resolved", "paid", "published",
        "captured", "smtp_accepted", "consumed", "released", "verified", "enabled",
        "overpaid", "delivered", "dispatched", "settled", "recovered", "valid",
        "resolve", "read",
    },
    "danger": {
        "rejected", "cancelled", "suspended", "exhausted", "failed", "expired",
        "disabled", "delivery_unknown", "revoked", "blocked", "restricted",
    },
    "info": {
        "held", "reserved", "sealed", "withdrawn", "decided", "erroneous", "running",
        "complete", "done", "reduced", "unreserved", "flat", "unknown", "assign",
    },
}

# --- Shared record identity (name with supporting detail, both truncated) -----
# One definition for every listing that must show a readable record instead of
# a bare identifier. Catalogue keeps its own image treatment on top of it.
IDENTITY_THEME = {
    "identity": "flex items-center gap-3",
    "text": "min-w-0 w-48",
    "name": "block truncate text-sm font-medium text-base-900 dark:text-base-100",
    "meta": "block truncate text-xs text-base-500 dark:text-base-400",
}

CATALOGUE_THEME = {
    "identity": IDENTITY_THEME["identity"],
    "image": "h-10 w-10 shrink-0 rounded-default object-cover",
    "text": IDENTITY_THEME["text"],
    "name": IDENTITY_THEME["name"],
    "meta": IDENTITY_THEME["meta"],
    "badges": "flex flex-wrap gap-1",
}

ACCOUNT_THEME = {
    "avatar": "rounded-full bg-primary-50 font-semibold text-primary-700 dark:bg-primary-950 dark:text-primary-400",
    "menu": "rounded-xl border border-base-200 bg-white shadow-lg dark:border-base-700 dark:bg-base-900",
    "trigger": "rounded-lg hover:bg-base-100 dark:hover:bg-base-800",
    "trigger_active": "bg-base-100 dark:bg-base-800",
    "label": f"text-xs font-semibold {MUTED}",
    "row": (
        "rounded-md text-sm font-medium text-base-700 hover:bg-base-100 "
        "dark:text-base-200 dark:hover:bg-base-800"
    ),
    "row_primary": "rounded-md bg-primary-50 text-sm font-semibold text-primary-700 dark:bg-primary-950 dark:text-primary-400",
    "segments": "rounded-lg bg-base-50 dark:bg-base-800",
    "selection": "rounded-md bg-white font-semibold text-primary-700 shadow-sm dark:bg-base-900 dark:text-primary-400",
    "signout": "rounded-md text-sm font-medium text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/20",
    "record_panel": CARD,
    "record_name": f"text-lg font-semibold {TEXT}",
    "record_meta": f"text-sm {MUTED}",
    "record_link": (
        f"rounded-md border {DIVIDER} px-3 py-1.5 text-sm font-medium "
        "hover:bg-base-100 dark:hover:bg-base-800"
    ),
    "profile_heading": SECTION_TITLE,
    "profile_value": f"break-words text-sm font-medium {TEXT}",
}

NAVIGATION_THEME = {
    "section": f"mx-3 mt-3 mb-1 px-3 py-1.5 text-xs font-semibold {MUTED}",
    "group": f"flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-default px-3 py-2 text-start hover:bg-base-100 dark:hover:bg-base-800 {TEXT}",
    "branch": f"ms-5 my-1 flex flex-col gap-0.5 border-s-2 ps-2 {DIVIDER}",
    "child": f"flex min-h-9 items-center gap-2 rounded-default px-3 py-1.5 text-sm hover:bg-base-100 dark:hover:bg-base-800 {TEXT}",
    "expanded": f"font-semibold {ACTION}",
    "active": ACCOUNT_THEME["row_primary"],
}

DIRECTORY_THEME = {
    "backdrop": "bg-base-900/20 backdrop-blur-xs dark:bg-base-900/80",
    "panel": f"border-e {DIVIDER} bg-white shadow-lg dark:bg-base-900",
    "divider": DIVIDER,
    "title": SECTION_TITLE,
    "muted": MUTED,
    "icon": ICON_TILE,
    "input": f"rounded-lg border {DIVIDER} bg-base-50 text-sm dark:bg-base-800 {TEXT}",
    "button": f"rounded-md hover:bg-base-100 dark:hover:bg-base-800 {MUTED}",
    "group": f"rounded-xl border {DIVIDER}",
    "heading": f"rounded-xl px-3 py-2 font-semibold hover:bg-base-50 dark:hover:bg-base-800 {TEXT}",
    "current_heading": ACTION,
    "subheading": f"rounded-md px-3 py-2 font-medium hover:bg-base-100 dark:hover:bg-base-800 {TEXT}",
    "count": f"rounded-md bg-base-100 px-1.5 py-0.5 text-xs dark:bg-base-800 {MUTED}",
    "link": f"rounded-md hover:bg-base-100 dark:hover:bg-base-800 {TEXT}",
    "current_link": ACCOUNT_THEME["row_primary"],
}

# --- Shared owner workspace surfaces (cases and delivery diagnostics) --------
# Presentation only. Every class below ships in Unfold's compiled
# ``static/unfold/css/styles.css``; no custom build is required. The
# messaging and delivery screens share this base so both read as one family.
WORKSPACE_THEME = {
    "layout": "flex min-w-0 flex-col gap-6",
    "panel": f"{CARD} flex flex-col gap-3 p-5 text-sm",
    "heading": f"text-xl font-semibold {TEXT}",
    "section_heading": f"text-lg font-semibold {TEXT}",
    "eyebrow": f"flex items-center gap-2 text-xs font-semibold {MUTED}",
    "muted": MUTED,
    "toolbar": "flex flex-wrap items-center justify-between gap-3",
    "workspace_grid": "grid grid-cols-1 items-start gap-6 lg:grid-cols-3",
    "main_column": "min-w-0 lg:col-span-2",
    "notice": f"{CARD} flex flex-wrap items-center gap-2 p-4 text-sm {TEXT}",
    "empty": f"rounded-lg border border-dashed {DIVIDER} p-6 text-center text-sm {MUTED}",
    "history": f"rounded-default border {DIVIDER} p-3",
    "detail_body": "flex flex-col gap-3 pt-3",
    "label": f"block mb-2 font-medium {TEXT}",
    "error": "text-sm text-red-600 dark:text-red-400",
    "form": "flex flex-col gap-3",
    "button": "inline-flex items-center justify-center rounded-default bg-primary-600 px-4 py-2 font-medium text-white",
    "secondary_button": f"inline-flex items-center justify-center gap-2 rounded-default border {DIVIDER} px-3 py-2 text-sm font-medium {ACTION}",
    "disclosure": f"cursor-pointer text-sm font-semibold {ACTION}",
    "badge": BADGE_BASE,
    "badge_tones": BADGE_COLORS,
    "identity": "flex items-center gap-3",
    "text": "min-w-0 w-48",
    "name": "block truncate text-sm font-medium text-base-900 dark:text-base-100",
    "meta": "block truncate text-xs text-base-500 dark:text-base-400",
    "reference": "text-xs text-base-500 dark:text-base-400",
    "body": "break-words text-sm",
    "divider": DIVIDER,
    "card": CARD,
    "text": TEXT,
    "action": ACTION,
    "chip": CHIP,
}

# Moderation case workspace: reported message, conversation history and the
# guarded decision form share one visual language.
MESSAGING_THEME = {
    **WORKSPACE_THEME,
    "message": f"rounded-default border {DIVIDER} p-3",
    "reported": (
        "rounded-default border-2 border-primary-500 bg-primary-50 p-3 "
        "dark:border-primary-700 dark:bg-primary-950"
    ),
    "flag": (
        "rounded-md bg-primary-100 px-2 py-0.5 text-[11px] font-semibold uppercase "
        "text-primary-700 dark:bg-primary-950 dark:text-primary-400"
    ),
    "author": f"font-semibold {TEXT}",
    "state_grid": "grid grid-cols-1 gap-4 lg:grid-cols-2",
}

# Notification delivery diagnostics: delivery state, attempts and the guarded
# retry controls stay together so an uncertain send is never read as a receipt.
# Delivery states keep their own tones: a cancelled delivery is a normal end
# state ("no longer eligible"), not a failure, so it must not read as an error.
DELIVERY_TONES = {
    "queued": "warning",
    "claimed": "warning",
    "dispatching": "info",
    "captured": "success",
    "smtp_accepted": "success",
    "retry_due": "warning",
    "cancelled": "default",
    "exhausted": "danger",
    "delivery_unknown": "danger",
}
DELIVERY_THEME = {
    **WORKSPACE_THEME,
    "state": f"rounded-default border {DIVIDER} p-4 text-sm {TEXT}",
    "state_tones": DELIVERY_TONES,
}

# --- Site settings, homepage media and content pages ------------------------
# Presentation for the site admin's Python-rendered previews, badges and the
# embedded slide/post library. Reuses the shared badge palette, dividers and
# action colour so site screens match the rest of the owner admin.
SITE_THEME = {
    "badge": BADGE_BASE,
    "badge_tones": {
        "published": BADGE_COLORS["success"],
        "draft": BADGE_COLORS["warning"],
        "hidden": BADGE_COLORS["default"],
    },
    "chips": "inline-flex flex-wrap gap-1",
    "chip": "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold",
    "chip_tones": {
        "published": BADGE_COLORS["success"],
        "draft": BADGE_COLORS["warning"],
        "missing": BADGE_COLORS["default"],
    },
    # Private streamed media previews (compact, theme-aware containers).
    "thumb": "h-12 w-16 rounded-default object-cover",
    "favicon": "h-12 max-w-full object-cover",
    "sharing": "h-24 max-w-full rounded-default object-cover",
    "cover": "h-24 max-w-full rounded-default object-cover",
    "draft_upload": "h-24 max-w-full rounded-default object-cover",
    "media": "h-72 max-w-full rounded-default object-cover",
    "video": "h-72 max-w-full rounded-default",
    "logo_row": "flex flex-wrap gap-4",
    "logo_img": "max-h-[30px] max-w-48",
    "logo_light_tile": f"rounded-default border {DIVIDER} bg-white p-3",
    "logo_dark_tile": "rounded-default bg-base-900 p-3",
    # Embedded slide/post library panel.
    "panel": "flex flex-col gap-3",
    "panel_toolbar": "flex flex-wrap items-center justify-between gap-3",
    "panel_add": (
        "inline-flex cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-default "
        "border border-transparent bg-primary-600 px-3 py-2 font-medium text-white hover:bg-primary-600/80"
    ),
    "panel_icon": "material-symbols-outlined text-lg",
    "panel_link": f"text-sm font-medium underline {ACTION}",
    "panel_list": f"overflow-hidden rounded-default border {DIVIDER}",
    "panel_row": f"flex items-center gap-3 border-b p-2 last:border-b-0 {DIVIDER}",
    "panel_row_grow": "grow min-w-0",
    "panel_row_title": "truncate text-sm font-medium",
    "panel_row_meta": f"text-xs {MUTED}",
    "panel_row_action": f"shrink-0 text-sm font-medium underline {ACTION}",
    "panel_empty": f"p-4 text-center text-sm {MUTED}",
    "shrink": "shrink-0",
}

REPORT_THEME = {
    "layout": "flex min-w-0 flex-col gap-4 pb-6",
    "title": f"text-2xl font-semibold {TEXT}",
    "heading": f"text-base font-semibold {TEXT}",
    "note": f"text-xs {MUTED}",
    "action": ACTION,
    "toolbar": f"{CARD} flex flex-wrap gap-3 p-3",
    "control": f"h-9 rounded-default border {DIVIDER} bg-white px-3 text-sm dark:bg-base-900",
    "button": f'{ORDER_THEME["button"]} h-9',
    "menu_button": f"flex h-9 cursor-pointer items-center gap-2 rounded-default border {DIVIDER} px-3 text-sm font-medium {TEXT}",
    "menu": f"{CARD} absolute end-0 top-10 z-10 flex w-48 flex-col p-1 shadow-lg",
    "segment": f"flex rounded-default border {DIVIDER} bg-base-50 p-1 dark:bg-base-800",
    "segment_link": f"rounded-default px-2 py-1 text-xs font-medium {MUTED}",
    "segment_active": ACCOUNT_THEME["selection"],
    "tabs": f"flex gap-4 overflow-x-auto border-b {DIVIDER}",
    "tab": f"shrink-0 border-b-2 border-transparent px-2 py-2 text-sm font-medium {MUTED}",
    "tab_active": f"shrink-0 border-b-2 border-primary-600 px-2 py-2 text-sm font-semibold {ACTION}",
    "metrics": "grid grid-cols-2 gap-3 lg:grid-cols-4",
    "metric": f"{CARD} flex min-w-0 flex-col p-4",
    "metric_value": f"text-xl font-semibold {TEXT}",
    "metric_icon": f"{ICON_TILE} h-8 w-8",
    "split": "grid grid-cols-1 gap-4 lg:grid-cols-3",
    "wide": "min-w-0 lg:col-span-2",
    "card": CARD,
    "head": "flex flex-wrap items-start justify-between gap-2 px-4 pt-4",
    "body": "p-4",
    "divider": DIVIDER,
    "fold": f"mt-3 border-t pt-2 {DIVIDER}",
    "fold_trigger": f"cursor-pointer py-1 text-sm font-medium {ACTION}",
    "table_wrap": "overflow-x-auto",
    "table": "w-full whitespace-nowrap text-sm",
    "table_head": f"bg-base-50 text-xs dark:bg-base-800 {MUTED}",
    "row": f"border-b last:border-b-0 {DIVIDER}",
    "text_cell": "px-4 py-2 text-start",
    "number_cell": "px-4 py-2",
    "chip": f"inline-flex rounded-default bg-base-100 px-2 py-0.5 text-xs font-semibold dark:bg-base-800 {MUTED}",
    "curr_chip": ACCOUNT_THEME["row_primary"],
    "queue_link": f"flex items-center gap-2 rounded-default px-2 py-2 text-sm hover:bg-base-50 dark:hover:bg-base-800 {TEXT}",
    "empty": f"p-6 text-center text-sm {MUTED}",
    "bar_track": "block h-1.5 w-full overflow-hidden rounded-default bg-base-100 dark:bg-base-800",
    "bar_fill": ACTION,
    "chart": "relative h-72 w-full",
    "chart_data": "mt-2 max-h-screen overflow-auto",
    "chart_surface": "bg-white dark:bg-base-900",
    "chart_tint": "bg-primary-50 dark:bg-primary-950",
    "error": ORDER_THEME["error"],
}

# --- Template-facing map (injected as `rz_theme` by dashboard_context) ------
# Never name the context key ``theme``: Unfold's skeleton owns that key for the
# root Alpine theme() component (light/dark/auto string).
THEME = {
    "card": CARD,
    "card_hover": CARD_HOVER,
    "text": TEXT,
    "muted": MUTED,
    "faint": FAINT,
    "action": ACTION,
    "divider": DIVIDER,
    "icon_tile": ICON_TILE,
    "section_title": SECTION_TITLE,
    "chip": CHIP,
    "overview_banner": "rounded-2xl bg-linear-to-br from-primary-950 to-primary-700 text-white shadow-lg dark:to-primary-900",
    "overview_ring": "absolute aspect-square rounded-full border border-primary-600 opacity-50",
    "overview_priority_panel": "rounded-xl border border-primary-700 bg-base-900/20",
    "overview_priority_colors": {"urgent": "bg-red-300", "today": "bg-orange-300", "routine": "bg-blue-300"},
    "overview_priority_track": "bg-white/20",
    "overview_banner_muted": "text-primary-100",
    "overview_button": "rounded-md bg-white text-primary-900 hover:bg-primary-50",
    "overview_panel": f"flex h-72 min-w-0 flex-col overflow-hidden {CARD}",
    "overview_empty_icon": "rounded-2xl bg-primary-50 text-primary-600 dark:bg-primary-950 dark:text-primary-400",
    "overview_empty_check": (
        "rounded-full border-2 border-white bg-green-100 text-green-700 "
        "dark:border-base-900 dark:bg-green-950 dark:text-green-400"
    ),
    "overview_row_icon": "rounded-md bg-base-50 text-base-600 dark:bg-base-800 dark:text-base-300",
    "overview_area_icons": {
        "trading": "bg-primary-50 text-primary-600 dark:bg-primary-950 dark:text-primary-400",
        "marketplace": "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
        "platform": "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
    },
    "overview_notice": "rounded-xl bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-400",
    "overview_table_head": "bg-base-50 dark:bg-base-800",
    "queue_filter": "rounded-md px-3 py-2 text-xs font-medium hover:bg-base-100 dark:hover:bg-base-800",
    "queue_filter_active": "bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-400",
    "queue_row_hover": "hover:bg-base-50 dark:hover:bg-base-800",
    "queue_group_heading": f"bg-base-50 px-5 py-2 dark:bg-base-800 {TEXT}",
    "queue_badge": {key: f"{BADGE_BASE} {value}" for key, value in BADGE_COLORS.items()},
}
