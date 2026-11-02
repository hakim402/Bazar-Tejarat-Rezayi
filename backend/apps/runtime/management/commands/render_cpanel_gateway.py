from django.core.management.base import BaseCommand, CommandError
from apps.runtime.gateway import render


class Command(BaseCommand):
    help = 'Render an inert private CGI package; never installs a public route.'

    def add_arguments(self, parser):
        parser.add_argument('--output', required=True)

    def handle(self, *args, **options):
        try:
            render(options['output'])
        except (ValueError, OSError):
            raise CommandError('Gateway package refused; choose a new private output directory.') from None
        self.stdout.write('Candidate CGI package rendered. Account execution/HTTPS/privacy acceptance is required before installation.')
