from django.core.validators import MinValueValidator, RegexValidator
from django.db import models
from django.db.models.functions import Length, Trim
from django.db.models.lookups import GreaterThan, LessThanOrEqual


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


class Expense(models.Model):
    paid_by = models.ForeignKey(Participant, on_delete=models.PROTECT, related_name="expenses_paid")
    expense_for = models.ForeignKey(
        Participant, on_delete=models.PROTECT, related_name="expenses_received"
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
