#!/usr/bin/env python3
"""
Generates the SYNTHETIC sample handbook for Task 0.9:
supabase/seed/kestrel-vane-employee-handbook.pdf

Kestrel & Vane Ltd is fictional, so nothing private is ever involved and we
own every fact in the file. The PDF is the source material for ingestion
(Slice 1) and the eval dataset (Slice 2): eval/dataset/facts.md lists checkable
facts and the physical page each one is on.

Layout rules (from the Task 0.6 and 0.7 findings in docs/decisions.md):
- Single column only (line-interleaved columns are not recoverable).
- One section per page, section N on page N, footer "Page N of 10". Every
  page is asserted to fit, so facts cannot drift onto another page.
- Plain ASCII text, no repeated filler sentences, so quotes stay unique.

Needs: Python 3 and reportlab. The generated file is committed, so you only
rerun this to change the content:
    python3 supabase/seed/build_sample_pdf.py
After any change, run `yarn test`: tests/unit/sample-docs.test.ts checks that
every fact in facts.md is still on its stated page.
"""
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.platypus import Frame, Paragraph, Spacer, Table, TableStyle

OUT = Path(__file__).resolve().parent / "kestrel-vane-employee-handbook.pdf"
PAGE_W, PAGE_H = A4
MARGIN = 20 * mm
FRAME_W = PAGE_W - 2 * MARGIN
FOOTER_TEXT = "Kestrel & Vane Ltd - Employee Handbook"

TITLE = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=20, leading=25, spaceAfter=12)
H1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=15, leading=19, spaceAfter=10)
H2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=11.5, leading=15, spaceBefore=8, spaceAfter=5)
BODY = ParagraphStyle("body", fontName="Helvetica", fontSize=10.5, leading=14, spaceAfter=7)
NOTE = ParagraphStyle("note", parent=BODY, fontName="Helvetica-Oblique", fontSize=9.5, leading=13)
BULLET = ParagraphStyle("bullet", parent=BODY, leftIndent=16, bulletIndent=4, spaceAfter=3)
CELL = ParagraphStyle("cell", fontName="Helvetica", fontSize=9.5, leading=12)
CELL_HEAD = ParagraphStyle("cellhead", parent=CELL, fontName="Helvetica-Bold")

# Block helpers. Text is ReportLab paragraph markup, so write & as &amp;.


def p(text: str):
    return Paragraph(text, BODY)


def h2(text: str):
    return Paragraph(text, H2)


def bullets(items: list[str]):
    return [Paragraph(t, BULLET, bulletText="\u2022") for t in items]


def table(rows: list[list[str]], widths: list[float]):
    data = [[Paragraph(c, CELL_HEAD if r == 0 else CELL) for c in row] for r, row in enumerate(rows)]
    t = Table(data, colWidths=[w * FRAME_W for w in widths], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8E8E8")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return [t, Spacer(1, 8)]


def page1():
    return [
        Paragraph("Kestrel &amp; Vane Ltd<br/>Employee Handbook", TITLE),
        Paragraph("1. About this handbook", H1),
        p("Kestrel &amp; Vane Ltd is a design and engineering consultancy with 142 employees. "
          "This handbook sets out the working policies that apply to all permanent and "
          "fixed-term employees. Each section starts on its own page, and section numbers "
          "match page numbers."),
        h2("Document control"),
        *table([
            ["Field", "Value"],
            ["Version", "3.2"],
            ["Effective date", "1 March 2026"],
            ["Approved by", "Board of Directors on 12 February 2026"],
            ["Document owner", "Head of People, Marguerite Dunmore"],
            ["Review cycle", "Every 12 months"],
            ["Next review due", "1 March 2027"],
        ], [0.3, 0.7]),
        p("Questions about this handbook go to the People team at people@kestrelandvane.example."),
        Paragraph("Kestrel &amp; Vane Ltd is a fictional company. This handbook is a synthetic "
                  "sample document written for software testing and contains no real policies.", NOTE),
    ]


def page2():
    return [
        Paragraph("2. Working hours and attendance", H1),
        p("The standard working day runs from 09:00 to 17:30, Monday to Friday, with a "
          "45-minute unpaid lunch break. The contracted working week is therefore 38.75 hours."),
        p("Employees may start work at any time between 07:30 and 10:00, provided they are "
          "present during the core hours of 10:00 to 15:30. Flexible start and finish times are "
          "recorded in the Timesheet tool by the end of each working day."),
        h2("Attendance rules"),
        *bullets([
            "Absence during core hours needs the line manager's approval in advance.",
            "Arriving after 10:00 is recorded as a late mark.",
            "Three late marks in one calendar month lead to a conversation with the line manager.",
        ]),
        h2("Overtime"),
        p("Overtime must be approved in writing by a line manager before it is worked. "
          "Approved overtime is compensated as time off in lieu (TOIL) and is never paid as "
          "extra salary."),
        p("TOIL accrues at 1.5 hours for every hour of approved overtime. Accrued TOIL must be "
          "taken within 8 weeks of the overtime being worked, and any TOIL not taken by then lapses."),
    ]


def page3():
    return [
        Paragraph("3. Annual leave", H1),
        p("Full-time employees receive 26 days of paid annual leave in each leave year. The leave "
          "year runs from 1 April to 31 March. Part-time employees receive a pro-rata entitlement."),
        p("Entitlement grows with service. Employees with 3 completed years of service receive 2 "
          "extra days, and employees with 6 completed years of service receive 4 extra days in total."),
        p("On the standard entitlement, leave accrues at 2.17 days for each month worked. Employees "
          "who join part-way through the leave year receive an entitlement for the remaining months only."),
        p("Up to 5 days of unused leave can be carried over into the next leave year. Carried-over "
          "days must be used by 30 June, after which they are lost."),
        p("A leave request covering 10 or more consecutive working days needs at least 6 weeks' notice."),
        h2("Public holidays"),
        p("The company observes 9 public holidays a year, in addition to annual leave:"),
        *bullets([
            "New Year's Day (1 January)",
            "Good Friday",
            "Easter Monday",
            "Early May bank holiday (first Monday in May)",
            "Spring bank holiday (last Monday in May)",
            "Summer bank holiday (last Monday in August)",
            "Founders' Day (first Friday in September)",
            "Christmas Day (25 December)",
            "Boxing Day (26 December)",
        ]),
    ]


def page4():
    return [
        Paragraph("4. Sick and family leave", H1),
        p("If you are too unwell to work, tell your line manager by 09:30 on the first day of "
          "absence. A medical certificate is required once an absence lasts more than 3 consecutive "
          "working days. Certificates go to the People team, not to line managers."),
        p("The table below shows the paid leave available for sickness and family circumstances. "
          "Entitlements are per leave year unless stated otherwise."),
        *table([
            ["Leave type", "Paid entitlement", "Conditions"],
            ["Sick leave", "12 days at full pay", "Beyond 12 days, pay is decided by the People team case by case"],
            ["Bereavement, immediate family", "5 days at full pay", "Taken within 4 weeks of the death"],
            ["Bereavement, other relatives", "1 day at full pay", "Attending the funeral"],
            ["Carer's leave", "3 days at full pay", "Emergencies involving a dependant"],
            ["Jury service", "Full pay for up to 10 days", "The summons must be given to the People team"],
            ["Moving home", "1 day at full pay", "Once per leave year"],
        ], [0.34, 0.26, 0.40]),
        p("Unused sick leave does not carry over to the next leave year and is never paid out."),
    ]


def page5():
    return [
        Paragraph("5. Remote and hybrid work", H1),
        p("Kestrel &amp; Vane runs a hybrid model based at the Harbour Street office. The company's "
          "anchor days are Tuesday and Thursday, when everyone is expected to be in the office."),
        h2("Where you may work"),
        *bullets([
            "Standard pattern: at least 2 days a week in the office and up to 3 days a week working remotely.",
            "During the probation period: 4 days a week in the office.",
            "Working remotely from another country: up to 20 working days per calendar year, "
            "with written approval from the Head of People.",
            "Working from a public place such as a cafe is allowed only for tasks that do not involve client data.",
        ]),
        h2("Home-office support"),
        p("New employees receive a one-off home-office stipend of $450 towards a desk, chair or "
          "monitor. The stipend is not repeated for later purchases."),
        p("The stipend is paid with the first payroll after the end of the probation period, which "
          "lasts 6 months. Employees who leave before it is paid receive nothing."),
        p("Employees who work remotely on at least 8 days in a month also receive a broadband "
          "allowance of $30 for that month."),
    ]


def page6():
    return [
        Paragraph("6. Expenses and travel", H1),
        p("Expense claims must be submitted in the Tallybook portal within 30 days of the expense. "
          "The Finance Office rejects older claims unless it agreed an exception in advance."),
        h2("Daily allowances by city tier"),
        *table([
            ["City tier", "Examples", "Meals per day", "Hotel per night"],
            ["Tier 1", "London, New York, Singapore", "$75", "$260"],
            ["Tier 2", "Berlin, Toronto, Dubai", "$60", "$190"],
            ["Tier 3", "All other cities", "$45", "$140"],
        ], [0.14, 0.46, 0.20, 0.20]),
        h2("Approval levels"),
        *bullets([
            "Up to $100: approved by the line manager.",
            "From $101 to $1,000: approved by the Head of Department.",
            "Above $1,000: approved by the Finance Director.",
        ]),
        h2("Flights"),
        p("Flights shorter than 6 hours must be booked in economy class. For flights of 6 hours "
          "or longer, premium economy is permitted."),
        p("All flights must be booked through the travel desk at least 14 days before departure, "
          "unless a Head of Department approves a short-notice booking."),
        p("Alcohol is never reimbursed."),
    ]


def page7():
    return [
        Paragraph("7. IT security and devices", H1),
        p("These rules apply to all employees and to contractors who have access to company systems."),
        h2("Account and device rules"),
        *bullets([
            "Passwords must be at least 14 characters long.",
            "Multi-factor authentication is mandatory on every company account.",
            "Screens lock automatically after 5 minutes of inactivity.",
            "Company laptops are replaced every 36 months.",
            "Personal USB storage devices may not be connected to company laptops.",
        ]),
        h2("Reporting incidents"),
        p("Report a lost or stolen device to the Security Desk within 1 hour of noticing the loss. "
          "Report a suspected phishing email within 4 hours of receiving it. Both reports go to "
          "security@kestrelandvane.example."),
        p("The Security Desk may remotely wipe any lost device without asking the employee first."),
        p("Employees who open a phishing link must still report it. Reporting promptly is never "
          "treated as a disciplinary matter."),
    ]


def page8():
    return [
        Paragraph("8. Conduct and speaking up", H1),
        p("All employees are expected to treat colleagues, clients and suppliers with courtesy and "
          "respect. Harassment, bullying and discrimination are never acceptable."),
        h2("Gifts and outside work"),
        p("Gifts from clients or suppliers worth more than $50 must be declared to the Head of People "
          "within 3 working days of receipt. Gifts worth more than $200 must be declined or returned."),
        p("Paid work outside the company needs written approval from the Head of People before it starts."),
        h2("Speaking up"),
        p("Concerns about misconduct can be raised confidentially through the Speak Up line, which is "
          "run by an independent provider and answers 24 hours a day, or by email to "
          "speakup@kestrelandvane.example."),
        p("Every report is acknowledged within 2 working days. An investigator is assigned within "
          "5 working days of the acknowledgement."),
        p("Investigations are normally completed within 20 working days of the investigator being "
          "assigned. If more time is needed, the person who raised the concern is updated every "
          "10 working days. Employees are protected from retaliation for reports made in good faith."),
    ]


def page9():
    return [
        Paragraph("9. Health, safety and emergencies", H1),
        h2("Fire safety"),
        p("The Harbour Street office has 8 trained fire marshals. The assembly point is Car Park C, "
          "behind the loading bay. The fire alarm is tested every Wednesday at 10:15."),
        p("Full evacuation drills are held twice a year, in April and October."),
        h2("First aid"),
        *bullets([
            "There are 6 qualified first aiders.",
            "First-aid kits are kept on every floor and in the kitchen.",
            "The defibrillator is on the ground floor, next to reception.",
        ]),
        h2("Accidents and workstations"),
        p("Every workplace accident or near miss must be recorded in the accident book within 24 hours."),
        p("Every employee must complete a display screen equipment (DSE) assessment within 4 weeks "
          "of their start date."),
        p("The DSE assessment is repeated every 2 years, and also whenever an employee's workstation "
          "changes or they report discomfort."),
    ]


def page10():
    return [
        Paragraph("10. Reviews, pay and notice periods", H1),
        p("Formal performance reviews are held twice a year, in June and December. Ratings use a "
          "four-point scale: Exceeds, Meets, Partly Meets and Below."),
        p("Salaries are paid on the 25th of each month. When the 25th falls on a weekend, payment is "
          "made on the Friday before. The annual pay review takes effect on 1 July."),
        p("The company contributes 6% of base salary to the employee's pension, provided the "
          "employee contributes at least 4%."),
        p("Employees who contribute 8% or more receive an additional 1% from the company, which "
          "brings the company contribution to 7%."),
        p("Each employee has a learning budget of $1,200 per leave year. Unused budget does not roll over."),
        h2("Notice periods"),
        *table([
            ["Service", "Notice from employee", "Notice from company"],
            ["During probation", "1 week", "1 week"],
            ["Up to 2 years of service", "4 weeks", "6 weeks"],
            ["More than 2 years of service", "8 weeks", "12 weeks"],
        ], [0.4, 0.3, 0.3]),
        p("Notice must be given in writing to the Head of People."),
    ]


PAGES = [page1, page2, page3, page4, page5, page6, page7, page8, page9, page10]


def main() -> None:
    total = len(PAGES)
    # invariant=1 removes timestamps so reruns give identical bytes.
    c = canvas.Canvas(str(OUT), pagesize=A4, invariant=1, pageCompression=1)
    c.setTitle("Kestrel & Vane Ltd Employee Handbook (fictional sample)")
    c.setAuthor("Kestrel & Vane Ltd (fictional)")
    c.setSubject("Synthetic sample document for software testing")
    for number, build in enumerate(PAGES, start=1):
        story = build()
        frame = Frame(MARGIN, MARGIN + 6 * mm, FRAME_W, PAGE_H - 2 * MARGIN - 6 * mm,
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, showBoundary=0)
        frame.addFromList(story, c)
        assert not story, f"page {number} overflows: shorten its content"
        c.setFont("Helvetica", 8.5)
        c.drawString(MARGIN, MARGIN - 4 * mm, FOOTER_TEXT)
        c.drawRightString(PAGE_W - MARGIN, MARGIN - 4 * mm, f"Page {number} of {total}")
        c.showPage()
    c.save()
    print(f"wrote {OUT.name}: {total} pages, {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
