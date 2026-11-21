function ownerApplicationDirectory() {
    function normalize(value) {
        return value.normalize("NFKC").toLowerCase()
            .replace(/[\u0640\u200c]/g, " ")
            .replace(/ي/g, "ی")
            .replace(/ك/g, "ک")
            .trim();
    }

    return {
        query: "",
        filtering: false,
        resultCount: 0,
        openBeforeSearch: new Set(),
        returnFocus: null,

        openDirectory(trigger) {
            if (this.openAllApplications) return;
            this.returnFocus = trigger;
            this.openAllApplications = true;
            this.$nextTick(() => {
                const target = window.matchMedia("(pointer: coarse)").matches
                    ? this.$refs.closeDirectory
                    : this.$refs.searchDirectory;
                target.focus({ preventScroll: true });
            });
        },

        closeDirectory() {
            this.openAllApplications = false;
            this.filter("");
            this.$nextTick(() => this.returnFocus?.focus({ preventScroll: true }));
        },

        clearSearch() {
            this.filter("");
            this.$refs.searchDirectory.focus({ preventScroll: true });
        },

        filter(value) {
            const results = this.$refs.directoryResults;
            const groups = Array.from(results.querySelectorAll("details"));
            const terms = normalize(value).split(/\s+/).filter(Boolean);
            const filtering = terms.length > 0;

            if (filtering && !this.filtering) {
                this.openBeforeSearch = new Set(groups.filter(group => group.open));
            }

            this.query = value;
            this.resultCount = 0;
            for (const row of results.querySelectorAll("[data-directory-search]")) {
                const search = normalize(row.dataset.directorySearch);
                row.hidden = !terms.every(term => search.includes(term));
                if (!row.hidden) this.resultCount += 1;
            }
            for (const group of groups) {
                group.hidden = filtering && !group.querySelector("[data-directory-search]:not([hidden])");
                if (filtering) {
                    group.open = !group.hidden;
                } else if (this.filtering) {
                    group.open = this.openBeforeSearch.has(group);
                }
            }

            if (!filtering) this.openBeforeSearch.clear();
            this.filtering = filtering;
            results.scrollTop = 0;
        },
    };
}
