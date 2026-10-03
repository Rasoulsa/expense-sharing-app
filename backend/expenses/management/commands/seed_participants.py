from django.core.management.base import BaseCommand
from django.db import transaction

from expenses.models import Participant


class Command(BaseCommand):
    help = "Ensure Alice, Bob, Charlie, and David exist without changing existing data."

    @transaction.atomic
    def handle(self, *args, **options):
        created = 0
        for name in ("Alice", "Bob", "Charlie", "David"):
            _, was_created = Participant.objects.get_or_create(name=name)
            created += was_created
        self.stdout.write(self.style.SUCCESS(f"Participants seeded: {created} created."))
