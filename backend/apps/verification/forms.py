"""Category-scoped owner form; review rules remain in the shared transition service."""

from django import forms
from unfold.widgets import UnfoldAdminTextareaWidget
from apps.organizations.forms import WorkflowForm
from .services import categories


class ReviewWorkflowForm(WorkflowForm):
    def __init__(self, *args, case, **kwargs):
        super().__init__(*args, **kwargs)
        self.categories = categories(case.profile)
        self.present = set(case.evidence.values_list("category", flat=True))
        self.requested_alternatives = [
            {"label": self.copy[key], "reason": case.alternative_requests.get(key, "") or self.copy["none"]}
            for key in self.categories
        ]
        for key in self.categories:
            self.fields["alternative_" + key] = forms.CharField(
                label=self.copy["accepted"].format(category=self.copy[key]),
                help_text=self.copy["help"],
                max_length=1000, required=False, strip=True,
                widget=UnfoldAdminTextareaWidget(attrs={"rows": 3}),
                initial=case.accepted_alternatives.get(key, ""),
            )

    def clean(self):
        data = super().clean()
        if any(
            (name.startswith("alternative_") and name not in self.fields) or name == "accepted_alternatives"
            for name in self.data
        ):
            raise forms.ValidationError(self.copy["unknown"])
        accepted = {}
        for key in self.categories:
            name = "alternative_" + key
            value = data.pop(name, "")
            if value:
                accepted[key] = value
            elif data.get("action") == "approved" and key not in self.present and name not in self.errors:
                self.add_error(name, self.copy["missing"])
        data["accepted_alternatives"] = accepted
        return data
