from django.core.validators import MinValueValidator, RegexValidator
from django.db import models
from django.db.models.functions import Length, Trim
from django.db.models.lookups import GreaterThan, LessThanOrEqual

from expenses.names import canonical_occasion_name


class Participant(models.Model):
    name = models.CharField(
        max_length=100,
        unique=True,
        validators=[RegexValidator(r"\S", "Name must contain a non-whitespace character.")],
    )

    class Meta:
        ordering = ["name", "id"]
        constraints = [
            models.CheckConstraint(
                condition=GreaterThan(Length(Trim("name")), 0),
                name="participant_name_not_empty",
            ),
        ]

    def __str__(self) -> str:
        return self.name


class OccasionQuerySet(models.QuerySet):
    def update(self, **kwargs):
        if "canonical_name" in kwargs:
            raise ValueError("Occasion canonical names are derived; update the name instead.")
        if "name" in kwargs:
            if not isinstance(kwargs["name"], str):
                raise ValueError("Occasion name updates require a literal string; use save().")
            kwargs["name"] = kwargs["name"].strip()
            kwargs["canonical_name"] = canonical_occasion_name(kwargs["name"])
        return super().update(**kwargs)

    def bulk_create(
        self,
        objs,
        batch_size=None,
        ignore_conflicts=False,
        update_conflicts=False,
        update_fields=None,
        unique_fields=None,
    ):
        objs = list(objs)
        for obj in objs:
            obj.prepare_name()
        if update_conflicts:
            fields = set(update_fields or [])
            if "canonical_name" in fields and "name" not in fields:
                raise ValueError("Occasion canonical names are derived; update the name instead.")
            if "name" in fields:
                fields.add("canonical_name")
                update_fields = sorted(fields)
        return super().bulk_create(
            objs,
            batch_size=batch_size,
            ignore_conflicts=ignore_conflicts,
            update_conflicts=update_conflicts,
            update_fields=update_fields,
            unique_fields=unique_fields,
        )

    def bulk_update(self, objs, fields, batch_size=None):
        if {"name", "canonical_name"}.intersection(fields):
            raise ValueError("Occasion bulk name updates are unsupported; use save() or update().")
        return super().bulk_update(objs, fields, batch_size=batch_size)


class Occasion(models.Model):
    objects = OccasionQuerySet.as_manager()
    canonical_name = models.TextField(editable=False)
    name = models.CharField(
        max_length=100,
        unique=True,
        validators=[RegexValidator(r"\S", "Name must contain a non-whitespace character.")],
    )

    class Meta:
        ordering = ["name", "id"]
        constraints = [
            models.CheckConstraint(
                condition=GreaterThan(Length(Trim("name")), 0),
                name="occasion_name_not_empty",
            ),
            models.CheckConstraint(
                condition=LessThanOrEqual(Length("name"), 100),
                name="occasion_name_bounded",
            ),
            models.UniqueConstraint(
                fields=["canonical_name"], name="occasion_canonical_name_unique"
            ),
            models.CheckConstraint(
                condition=~models.Q(canonical_name=""), name="occasion_canonical_name_not_empty"
            ),
        ]

    def prepare_name(self):
        self.name = self.name.strip()
        self.canonical_name = canonical_occasion_name(self.name)

    def clean_fields(self, exclude=None):
        self.prepare_name()
        super().clean_fields(exclude=exclude)

    def save(
        self,
        *args,
        force_insert=False,
        force_update=False,
        using=None,
        update_fields=None,
    ):
        if args:
            # Preserve Django 5.2's deprecated positional save options without
            # letting an update_fields argument skip the derived key.
            force_insert, force_update, using, update_fields = self._parse_save_params(
                *args,
                method_name="save",
                force_insert=force_insert,
                force_update=force_update,
                using=using,
                update_fields=update_fields,
            )
        if update_fields is not None and not update_fields:
            return
        self.prepare_name()
        if update_fields is not None:
            update_fields = set(update_fields) | {"name", "canonical_name"}
        return super().save(
            force_insert=force_insert,
            force_update=force_update,
            using=using,
            update_fields=update_fields,
        )

    def __str__(self) -> str:
        return self.name


class Expense(models.Model):
    paid_by = models.ForeignKey(Participant, on_delete=models.PROTECT, related_name="expenses_paid")
    expense_for = models.ForeignKey(
        Participant, on_delete=models.PROTECT, related_name="expenses_received"
    )
    occasion = models.ForeignKey(
        Occasion, on_delete=models.PROTECT, related_name="expenses", null=True, blank=True
    )
    amount_cents = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    description = models.CharField(max_length=500, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount_cents__gt=0), name="expense_amount_positive"
            ),
            models.CheckConstraint(
                condition=~models.Q(paid_by=models.F("expense_for")),
                name="expense_different_participants",
            ),
            models.CheckConstraint(
                condition=LessThanOrEqual(Length("description"), 500),
                name="expense_description_bounded",
            ),
        ]
