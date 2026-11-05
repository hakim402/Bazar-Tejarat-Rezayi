"""Physical fulfilment and independent review through actual owned Apache CGI."""

import datetime
import io
import json
import re
import urllib.parse
import uuid
from PIL import Image


def participants(run, request, signin):
    code = """import django;django.setup()
import json
from apps.fulfilment.management.commands.seed_fulfilment_examples import example_delivery
print(json.dumps(example_delivery('cod',stage='prepared',charge='5.00')))
"""
    _, raw = run.python("-c", code, name="cgi-fulfilment-owned-order")
    item = json.loads(raw)
    pk = item["id"]
    assert re.fullmatch(r"[0-9a-f-]{36}", pk)
    token = signin("buyer", "phase12-buyer@example.test")
    base = f"/api/v1/fulfilment/buyer/orders/{pk}/"

    def post(path, body, csrf=token):
        return request(
            path,
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "X-CSRFToken": csrf, "Origin": "https://web.example.test"},
        )

    detail = json.loads(request(base)[2])
    assert detail["recipient"] and detail["stage"] == "prepared"
    image = io.BytesIO()
    Image.new("RGB", (32, 24), (2, 112, 210)).save(image, format="PNG")
    boundary = "OwnedDeliveryEvidence"
    key = str(uuid.uuid4())
    multipart = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="command_id"\r\n\r\n{key}\r\n--{boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nclaim\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\n'.encode()
        + image.getvalue()
        + f"\r\n--{boundary}--\r\n".encode()
    )
    headers = {"Content-Type": "multipart/form-data; boundary=" + boundary, "Origin": "https://web.example.test"}
    assert request(base + "uploads/", data=multipart, headers=headers)[0] == 403
    status, _, raw = request(base + "uploads/", data=multipart, headers={**headers, "X-CSRFToken": token})
    assert status == 201
    image_id = json.loads(raw)["id"]
    image_path = f"/api/v1/fulfilment/buyer/evidence/{image_id}/"
    status, headers, raw = request(image_path)
    assert status == 200 and raw.startswith(b"\xff\xd8") and "no-store" in headers["Cache-Control"]
    assert request(image_path, method="HEAD")[0] == 200
    body = {
        "command_id": str(uuid.uuid4()),
        "version": detail["version"],
        "goods_version": detail["goods_version"],
        "charge": detail["charge_id"],
        "amount": "5.00",
        "currency": "AFN",
        "paid_at": (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=1)).isoformat(),
        "description": "Synthetic CGI actual named provider receipt",
        "evidence": [image_id],
    }
    status, _, raw = post(base + "claims/", body)
    assert status == 201
    data = json.loads(raw)
    claim = data["result"]["claim"]
    assert data["current"]["delivery_confirmed"] == "0.00"
    token = signin("seller", "phase12-finance@example.test")
    data = json.loads(request(f"/api/v1/fulfilment/seller/orders/{pk}/")[2])
    assert data["recipient"] is None
    assert (
        post(
            f"/api/v1/fulfilment/seller/orders/{pk}/dispatch/review/",
            {
                "command_id": str(uuid.uuid4()),
                "version": data["version"],
                "goods_version": data["goods_version"],
                "preparation": item["preparation"],
                "reason": "Finance role cannot dispatch",
            },
            token,
        )[0]
        == 403
    )
    # Record actual seller-confirmed goods funds through the retained API, with
    # its staff review still pending. No stock is reserved for this COD order.
    facts = {
        "command_id": str(uuid.uuid4()),
        "version": data["goods_version"],
        "amount": "12.50",
        "currency": "AFN",
        "paid_at": (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=1)).isoformat(),
        "description": "Synthetic CGI actual seller goods receipt",
        "evidence": [],
    }
    status, _, raw = post(f"/api/v1/payments/seller/orders/{pk}/receipts/", facts, token)
    assert status == 201
    token = signin("seller", "phase12-owner@example.test")
    seller = f"/api/v1/fulfilment/seller/orders/{pk}/"
    data = json.loads(request(seller)[2])
    preview = {
        "command_id": str(uuid.uuid4()),
        "version": data["version"],
        "goods_version": data["goods_version"],
        "preparation": item["preparation"],
        "reason": "Exact actual whole COD dispatch through CGI",
    }
    status, _, raw = post(seller + "dispatch/review/", preview, token)
    assert status == 200
    packet = json.loads(raw)["packet"]
    assert (
        packet["stock_effect"] == "deduct_cod"
        and len(packet["lines"]) == 1
        and packet["lines"][0]["quantity"] == "1.000"
    )
    status, _, raw = post(seller + "dispatch/", packet, token)
    assert status == 201
    first = json.loads(raw)["result"]
    assert first["state"] == "dispatched"
    status, _, raw = post(seller + "dispatch/", packet, token)
    assert status == 201 and json.loads(raw)["result"] == first
    status, headers, raw = request(seller + "handover/?locale=fa-AF&format=pdf", headers={"Accept": "application/pdf"})
    assert status == 200 and raw.startswith(b"%PDF") and "no-store" in headers["Cache-Control"]
    assert request(seller + "handover/?locale=en&format=html", method="HEAD", headers={"Accept": "text/html"})[0] == 200
    token = signin("buyer", "phase12-buyer@example.test")
    data = json.loads(request(base)[2])
    status, _, raw = post(
        base + "deliver/",
        {
            "command_id": str(uuid.uuid4()),
            "version": data["version"],
            "goods_version": data["goods_version"],
            "occurred_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "reason": "Buyer confirms actual whole CGI delivery",
        },
        token,
    )
    assert status == 201
    data = json.loads(raw)["current"]
    assert (
        data["delivery"]["source"] == "buyer"
        and data["completion"] == "incomplete"
        and data["delivery_confirmed"] == "0.00"
    )
    assign = """import django;django.setup()
import json,sys
from apps.accounts.models import User
from apps.fulfilment.models import ReviewCase
from apps.fulfilment.management.commands.seed_fulfilment_examples import command
from apps.messaging.management.commands.seed_messaging_examples import actor
case=ReviewCase.objects.get(claim_id=sys.argv[1]);root=actor(User.objects.get(email='phase09-root@example.test'),'owner');target=User.objects.get(email='phase03-owner@example.test')
command(case.order,root,'case_assign',case=case.pk,case_version=case.version,assigned_to=target.pk,reason='Independent actual CGI reviewer assignment')
print(json.dumps({'case':str(case.pk),'order':str(case.order_id)}))
"""
    _, raw = run.python("-c", assign, claim, name="cgi-fulfilment-independent-assignment")
    case = json.loads(raw)
    token = signin("buyer", "phase03-buyer@example.test")
    assert request(base)[0] == 404 and request(image_path)[0] == 404
    return case


def native_review(run, request, case):
    path = f"/admin/fulfilment/reviewcase/{case['case']}/review/"
    status, headers, raw = request(path)
    assert status == 200 and headers["Referrer-Policy"] == "same-origin"

    def hidden(name):
        value = re.search(rb'name="' + name.encode() + rb'"[^>]*value="([^"<>]+)"', raw)
        assert value is not None
        return value[1].decode()

    body = {
        name: hidden(name) for name in ["csrfmiddlewaretoken", "command_id", "version", "goods_version", "case_version"]
    }
    body.update(action="case_approve", reason="Independent actual provider receipt confirmed through native CGI")
    form = urllib.parse.urlencode(body).encode()
    assert (
        request(
            path,
            data=form,
            headers={"Content-Type": "application/x-www-form-urlencoded", "Origin": "https://evil.example.test"},
        )[0]
        == 403
    )
    status, _, _ = request(
        path,
        data=form,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://api.example.test",
            "Referer": "https://api.example.test" + path,
        },
    )
    assert status in (302, 303)
    proof = """import django;django.setup()
from apps.fulfilment import models as m,queries
from apps.orders.models import SellerOrder
from apps.inventory.models import StockTransition
import sys
order=SellerOrder.objects.get(pk=sys.argv[1]);facts=queries.dimensions(order)
assert facts['completion']=='completed' and facts['delivery_confirmed']=='5.00' and facts['goods_confirmed']=='12.50'
shipment=m.Shipment.objects.get(order=order)
assert shipment.operation.movements.count()==1 and StockTransition.objects.filter(movement__operation_id=shipment.operation_id,pending=False).count()==1
assert m.Completion.objects.filter(order=order).count()==1
print('Actual DML CGI participant dispatch/replay, private files, independent native receipt and automatic completion verified.')
"""
    run.python("-c", proof, case["order"], name="cgi-fulfilment-authoritative-effects")
