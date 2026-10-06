from django.db import migrations, models

from expenses.names import canonical_occasion_name


def canonical_rows(apps, schema_editor):
    occasions = apps.get_model("expenses", "Occasion").objects.using(schema_editor.connection.alias)
    rows = list(occasions.order_by("id").values_list("id", "name"))
    by_key = {}
    for row_id, name in rows:
        key = canonical_occasion_name(name)
        by_key.setdefault(key, []).append((row_id, name))
    conflicts = [group for key, group in by_key.items() if not key or len(group) > 1]
    if conflicts:
        details = "; ".join(
            ", ".join(f"id={row_id}, name={name!r}" for row_id, name in group)
            for group in conflicts
        )
        raise RuntimeError(
            "Occasion canonical names conflict or are blank after trimming, Unicode NFC "
            "normalization and casefolding. Conflicting rows: " + details + ". "
            "Explicitly rename the distinct occasions, preserving IDs and expense associations, "
            "then retry migration 0004. No rows have been changed or merged."
        )
    return [(row_id, canonical_occasion_name(name)) for row_id, name in rows]


def check_names(apps, schema_editor):
    # Run before adding the column so a collision leaves even the old schema intact.
    canonical_rows(apps, schema_editor)


def backfill_names(apps, schema_editor):
    # Recheck before writing in case a writer committed between preflight and DDL.
    rows = canonical_rows(apps, schema_editor)
    occasion = apps.get_model("expenses", "Occasion")
    occasion.objects.using(schema_editor.connection.alias).bulk_update(
        [occasion(id=row_id, canonical_name=key) for row_id, key in rows],
        ["canonical_name"],
        batch_size=500,
    )


class Migration(migrations.Migration):
    dependencies = [("expenses", "0003_occasion_case_insensitive_names")]

    operations = [
        migrations.RunPython(check_names, migrations.RunPython.noop),
        migrations.AddField(
            model_name="occasion",
            name="canonical_name",
            field=models.TextField(editable=False, null=True),
        ),
        migrations.RunPython(backfill_names, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="occasion",
            name="canonical_name",
            field=models.TextField(editable=False),
        ),
        migrations.AddConstraint(
            model_name="occasion",
            constraint=models.UniqueConstraint(
                fields=["canonical_name"], name="occasion_canonical_name_unique"
            ),
        ),
        migrations.AddConstraint(
            model_name="occasion",
            constraint=models.CheckConstraint(
                condition=~models.Q(canonical_name=""), name="occasion_canonical_name_not_empty"
            ),
        ),
        migrations.RemoveConstraint(model_name="occasion", name="occasion_name_ci_unique"),
    ]
