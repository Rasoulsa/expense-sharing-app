"""Verify the disposable compose.smoke.yml stack, never a production database."""

import json
import subprocess
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
API = "http://localhost:8000"
FRONTEND = "http://localhost:8080"


def request(path, *, method="GET", data=None, origin=FRONTEND, expected=200):
    body = json.dumps(data).encode() if data is not None else None
    headers = {"Accept": "application/json", "Origin": origin}
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = Request(API + path, data=body, headers=headers, method=method)
    try:
        response = urlopen(req, timeout=5)
    except HTTPError as error:
        response = error
    with response:
        assert response.status == expected, (method, path, response.status)
        assert response.headers.get("Access-Control-Allow-Origin") == (
            FRONTEND if origin == FRONTEND else None
        )
        payload = response.read()
        return json.loads(payload) if payload else None


def main():
    for path, content in (("/health/", b"ok\n"), ("/", None), ("/expenses/history", None)):
        with urlopen(FRONTEND + path, timeout=5) as response:
            assert response.status == 200
            body = response.read()
            assert body == content if content else b'<div id="root"></div>' in body
    request("/health/live/")
    request("/health/ready/")
    request("/health/live/", origin="https://untrusted.example.test")
    people = request("/api/participants/")
    assert [person["name"] for person in people] == ["Alice", "Bob", "Charlie", "David"]
    assert request("/api/expenses/") == []
    assert request("/api/balances/") == []
    ids = {person["name"]: person["id"] for person in people}
    request("/api/participants/", method="POST", data={"name": "Mina Smoke"}, expected=405)
    assert request("/api/occasions/") == []
    dinner = request("/api/occasions/", method="POST", data={"name": " Dinner "}, expected=201)
    assert dinner["name"] == "Dinner"
    first = request(
        "/api/expenses/",
        method="POST",
        data={
            "paid_by": ids["Alice"],
            "expense_for": ids["Bob"],
            "amount": "50.00",
            "description": "Container smoke lunch",
            "occasion": dinner["id"],
        },
        expected=201,
    )
    assert first["occasion"] == dinner
    reverse = request(
        "/api/expenses/",
        method="POST",
        data={
            "paid_by": ids["Bob"],
            "expense_for": ids["Alice"],
            "amount": "20.00",
            "description": "Container smoke reverse",
        },
        expected=201,
    )
    balances = request("/api/balances/")
    assert reverse["occasion"] is None
    assert request(f"/api/expenses/?occasion={dinner['id']}") == [first]
    duplicate = request("/api/occasions/", method="POST", data={"name": " dinner "}, expected=400)
    assert duplicate["name"]
    scoped = request(f"/api/balances/?occasion={dinner['id']}")
    assert scoped == [
        {
            "debtor": {"id": ids["Bob"], "name": "Bob"},
            "creditor": {"id": ids["Alice"], "name": "Alice"},
            "amount": "50.00",
        }
    ]
    assert len(balances) == 1
    assert balances[0]["debtor"]["id"] == ids["Bob"]
    assert balances[0]["creditor"]["id"] == ids["Alice"]
    assert balances[0]["amount"] == "30.00"
    request(f"/api/expenses/{reverse['id']}/", method="DELETE", expected=204)
    request(f"/api/expenses/{reverse['id']}/", method="DELETE", expected=404)
    assert request("/api/expenses/") == [first]
    assert request("/api/balances/")[0]["amount"] == "50.00"
    # Seed reruns must preserve people, IDs, occasions, and persisted expenses.
    subprocess.run(
        [
            "docker",
            "compose",
            "-f",
            "compose.smoke.yml",
            "exec",
            "-T",
            "backend",
            "python",
            "manage.py",
            "seed_participants",
        ],
        cwd=ROOT,
        check=True,
        timeout=30,
    )
    assert request("/api/participants/") == people
    assert request("/api/occasions/") == [dinner]
    assert request("/api/expenses/") == [first]
    assert request("/api/balances/")[0]["amount"] == "50.00"
    print("PASS: frontend health/SPA, backend health, exact CORS, read-only participants,")
    print(
        "occasions/filtering, global/filtered pairwise balances, case-variant duplicates, "
        "deletion/404, and seed preservation."
    )


if __name__ == "__main__":
    main()
