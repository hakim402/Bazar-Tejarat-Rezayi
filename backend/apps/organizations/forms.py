from django import forms
from unfold.widgets import UnfoldAdminSelectWidget, UnfoldAdminTextareaWidget
from apps.accounts.models import Account
from .owner_copy import COPY


class WorkflowForm(forms.Form):
    version = forms.IntegerField(min_value=1, widget=forms.HiddenInput)
    action = forms.ChoiceField(choices=[], widget=UnfoldAdminSelectWidget)
    reason = forms.CharField(max_length=1000, widget=UnfoldAdminTextareaWidget(attrs={"rows": 3}), required=True)
    assigned_to = forms.ModelChoiceField(queryset=Account.objects.none(), required=False, widget=UnfoldAdminSelectWidget)

    def __init__(self, *args, locale="fa-AF", **kwargs):
        super().__init__(*args, **kwargs)
        self.copy = COPY[locale]
        for name in ("action", "reason", "assigned_to"):
            self.fields[name].label = self.copy[name]
