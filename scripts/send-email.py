import json
import os
import smtplib
import ssl
from email.message import EmailMessage
from pathlib import Path


OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", "output"))
SUMMARY_PATH = OUTPUT_DIR / "fame-badminton-availability.md"
JSON_PATH = OUTPUT_DIR / "fame-badminton-availability.json"


def main():
    missing = [
        name
        for name in (
            "SMTP_HOST",
            "SMTP_PORT",
            "SMTP_USERNAME",
            "SMTP_PASSWORD",
            "EMAIL_FROM",
            "EMAIL_TO",
        )
        if not os.environ.get(name)
    ]
    if missing:
        raise RuntimeError(f"Missing email configuration: {', '.join(missing)}")

    payload = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    body = SUMMARY_PATH.read_text(encoding="utf-8")
    subject = (
        f"Fame badminton availability: "
        f"{payload['availableSlotCount']} slots after {payload['eveningStart']}"
    )

    message = EmailMessage()
    message["From"] = os.environ["EMAIL_FROM"]
    message["To"] = os.environ["EMAIL_TO"]
    message["Subject"] = subject
    message.set_content(body)

    attach_file(message, SUMMARY_PATH, "text/markdown")
    attach_file(message, JSON_PATH, "application/json")

    smtp_host = os.environ["SMTP_HOST"]
    smtp_port = int(os.environ["SMTP_PORT"])
    username = os.environ["SMTP_USERNAME"]
    password = os.environ["SMTP_PASSWORD"]

    if smtp_port == 465:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(smtp_host, smtp_port, context=context) as server:
            server.login(username, password)
            server.send_message(message)
    else:
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.starttls(context=ssl.create_default_context())
            server.login(username, password)
            server.send_message(message)


def attach_file(message, path, mime_type):
    maintype, subtype = mime_type.split("/", 1)
    message.add_attachment(
        path.read_bytes(),
        maintype=maintype,
        subtype=subtype,
        filename=path.name,
    )


if __name__ == "__main__":
    main()
