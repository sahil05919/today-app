import { describe, expect, it } from "vitest";
import { cleanPage, pageFromText } from "../lib/snap/clean";
import { classify, dayFirst, readPage, roleOf } from "../lib/snap/extract";
import { findSensitive, maskSensitive } from "../lib/snap/sensitive";
import type { OcrPage, SnapItem, SnapReading } from "../lib/snap/types";

// Wed 14 Oct 2026, noon, London (BST). Sat 31 Oct, Sat 14 Nov, Fri 20 Nov, Wed 25 Nov 2026 are what the weekday names say.
const NOW = new Date(2026, 9, 14, 12, 0);
const read = (text: string, opts: { takenAt?: Date; page?: OcrPage } = {}): SnapReading => {
  const page = opts.page ?? pageFromText(text);
  return readPage(opts.takenAt ? { ...page, takenAt: opts.takenAt.getTime() } : page, { ref: opts.takenAt ?? NOW, now: NOW });
};
const one = (text: string, opts: { takenAt?: Date } = {}): SnapItem => {
  const r = read(text, opts);
  expect(r.items.length, `expected one item in ${JSON.stringify(text.slice(0, 50))}, got ${JSON.stringify(r.items.map((i) => i.title))}`).toBe(1);
  return r.items[0];
};

describe("Snap: events and tickets", () => {
  it("1. Eventbrite order: title from the order line, 9pm start, a 3am end is not put on the wrong day, GMT label ignored", () => {
    const i = one("Order confirmation for Neon Nights Halloween Rave\nDate and time\nSat, 31 Oct 2026 · 9:00 PM – 3:00 AM GMT\nLocation\nThe Warehouse, 12 Dock Road\nLondon E16 1AB\nOrder #4567890123\nTotal £22.50");
    expect(i).toMatchObject({ type: "event", title: "Neon Nights Halloween Rave", date: "2026-10-31", start: "21:00", amount: 22.5, reference: "4567890123" });
    expect(i.end).toBeUndefined();
    expect(i.notes).toContain("after midnight");
    expect(i.location).toContain("The Warehouse");
  });

  it("2. Ticketmaster: the show starts at 19:30, doors at 18:30 are a note", () => {
    const i = one("Your tickets\nArctic Monkeys\nO2 Arena, London\nSat 14 Nov 2026\nDoors 18:30  Start 19:30\nBlock 112 Row K Seat 14\nTotal £87.50\nOrder number 12-34567/UK");
    expect(i).toMatchObject({ type: "event", title: "Arctic Monkeys", date: "2026-11-14", start: "19:30", amount: 87.5, reference: "12-34567/UK", location: "O2 Arena, London" });
    expect(i.notes).toBe("Doors 18:30");
  });

  it("3. Dice: 'You're going to' names it, source and booking ref found", () => {
    const i = one("DICE\nYou're going to\nFloating Points\nFri 20 Nov 2026 · 22:00 – 04:00\nFabric, 77A Charterhouse St, London EC1M 6HJ\nTicket 1 of 1 · £18.50\nBooking ref: DX7Q4R9T");
    expect(i).toMatchObject({ type: "event", date: "2026-11-20", start: "22:00", source: "Dice", reference: "DX7Q4R9T", amount: 18.5 });
    expect(i.title).toContain("Floating Points");
    expect(i.location).toContain("Fabric");
  });

  it("4. a poster: doors 7pm / starts 8pm, a bare weekday in the title is not a second day", () => {
    const r = read("FRIDAY NIGHT LIVE\nDOORS 7PM / STARTS 8PM\n20 NOVEMBER\nTHE CAVERN, LIVERPOOL\n£10 ADV");
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ type: "event", title: "FRIDAY NIGHT LIVE", date: "2026-11-20", start: "20:00", notes: "Doors 19:00" });
    expect(r.items[0].location).toBe("THE CAVERN, LIVERPOOL");
  });

  it("5. a cinema booking in the 7.30pm style", () => {
    const i = one("Odeon Luxe\nBooking confirmation\nDune: Part Three\nSat 7 Nov 2026 at 7.30pm\nScreen 4, Seats H12 H13\nBooking reference: 9ZQ4M2\nTotal £24.80");
    expect(i).toMatchObject({ date: "2026-11-07", start: "19:30", reference: "9ZQ4M2", amount: 24.8 });
    expect(i.title).toContain("Dune");
  });

  it("6. a football fixture: kick-off is the start, the stadium is the place", () => {
    const i = one("Arsenal v Spurs\nSun 22 Nov 2026\nKick-off 16:30\nEmirates Stadium\nBlock 112 Row 14 Seat 6");
    expect(i).toMatchObject({ type: "event", date: "2026-11-22", start: "16:30" });
    expect(i.location).toContain("Emirates Stadium");
  });

  it("7. a theatre booking", () => {
    const i = one("The Lion King\nLyceum Theatre\nWed 25 Nov 2026\n19:30\nStalls Row F Seats 12-13\nTotal £96.00\nBooking ref LK45821");
    expect(i).toMatchObject({ type: "event", title: "The Lion King", date: "2026-11-25", start: "19:30", amount: 96, reference: "LK45821" });
  });

  it("8. an event with a day but no time keeps no time (the card will ask)", () => {
    const i = one("Community Fair\nSat 7 Nov 2026\nBrixton Village\nFree entry, all welcome\nVenue: Brixton Village Market");
    expect(i).toMatchObject({ date: "2026-11-07" });
    expect(i.start).toBeUndefined();
  });

  it("9. a webinar by a link", () => {
    const i = one("Webinar: Intro to Power BI\nThu 19 Nov 2026 at 6pm\nJoin link: https://zoom.us/j/12345\nRSVP by replying to this email");
    expect(i).toMatchObject({ date: "2026-11-19", start: "18:00" });
  });

  it("10. a restaurant reservation with a UK date", () => {
    const i = one("Dinner reservation\n13/11/2026 7:30pm\nTable for 2");
    expect(i).toMatchObject({ type: "event", title: "Dinner reservation", date: "2026-11-13", start: "19:30" });
  });

  it("11. a poster listing two nights makes two events", () => {
    const r = read("COMEDY WEEKEND\nFri 20 Nov 2026\nDoors 7pm\nSat 21 Nov 2026\nDoors 7pm\nThe Laughing Duck, Camden\nTickets £15");
    expect(r.items.map((i) => i.date)).toEqual(["2026-11-20", "2026-11-21"]);
  });
});

describe("Snap: appointments", () => {
  it("12. NHS outpatient letter: the appointment day, not the letter date", () => {
    const i = one("NHS Royal Free Hospital\nDear Mr Kumar\nLetter date: 2 October 2026\nYour outpatient appointment\nDate: Tuesday 17 November 2026\nTime: 10:40\nLocation: Royal Free Hospital, Pond Street\nNW3 2QG\nPlease arrive 15 minutes early");
    expect(i).toMatchObject({ type: "appointment", title: "Hospital appointment", date: "2026-11-17", start: "10:40", source: "NHS" });
    expect(i.location).toBe("Royal Free Hospital, Pond Street, NW3 2QG");
  });

  it("13. a dentist SMS: 'tomorrow 3.30pm', the place stops at the sentence", () => {
    const i = one("Reminder: you have a dentist appt tomorrow 3.30pm at Bright Smile Dental. Reply C to confirm.");
    expect(i).toMatchObject({ type: "appointment", title: "Dentist appointment", date: "2026-10-15", start: "15:30", location: "Bright Smile Dental" });
  });

  it("14. a GP reminder with a UK numeric date; '10 minutes early' is not a time", () => {
    const i = one("Elm Surgery: Reminder of your appointment with Dr Patel on Mon 19/10/2026 at 09:20. Please arrive 10 minutes early. Reply CANCEL to cancel.");
    expect(i).toMatchObject({ type: "appointment", title: "GP appointment", date: "2026-10-19", start: "09:20" });
  });

  it("15. an optician booking", () => {
    const i = one("Specsavers: Your eye test is booked for Friday 23rd October at 2:15pm, Brixton branch. Bring your glasses.");
    expect(i).toMatchObject({ type: "appointment", title: "Optician appointment", date: "2026-10-23", start: "14:15" });
  });

  it("16. hospital date 03/11/2026 is 3 November, and the letter-sent date is ignored", () => {
    const i = one("Outpatient clinic\nLetter sent: 12/10/2026\nAppointment date: 03/11/2026 14:00\nPlease attend Ward 4");
    expect(i).toMatchObject({ type: "appointment", date: "2026-11-03", start: "14:00" });
  });

  it("17. physio with a time range written 4.45pm - 5.30pm", () => {
    const i = one("Your physiotherapy appointment is confirmed\nDate: Thursday 5 November 2026\nTime: 4.45pm - 5.30pm\nClinic: Camden Physio, 14 Parkway NW1 7AA");
    expect(i).toMatchObject({ type: "appointment", title: "Physio appointment", date: "2026-11-05", start: "16:45", end: "17:30" });
    expect(i.location).toContain("Camden Physio");
  });

  it("18. a flu jab text", () => {
    const i = one("Flu vaccination at Boots\nSat 24 Oct 2026, 10:00\nBoots Pharmacy, Oxford Street W1C 1AP\nPlease bring your NHS number");
    expect(i).toMatchObject({ type: "appointment", date: "2026-10-24", start: "10:00" });
  });

  it("19. an interview invitation gets an Interview title and the day and time", () => {
    const i = one("Interview invitation\nSenior Data Analyst, Tesco\nWed 18 Nov 2026 at 2pm\nMicrosoft Teams meeting");
    expect(i).toMatchObject({ type: "appointment", title: "Interview", date: "2026-11-18", start: "14:00" });
  });
});

describe("Snap: bills and statements", () => {
  it("20. council tax: instalment due, the issue date is ignored, Direct Debit noted", () => {
    const i = one("Barnet Council\nCouncil Tax bill 2026/27\nIssue date: 01 Oct 2026\nInstalment of £112.40 due on 1 November 2026\nDirect Debit will be collected on 1 November 2026");
    expect(i).toMatchObject({ type: "bill", title: "Council tax bill", date: "2026-11-01", dueDate: "2026-11-01", amount: 112.4 });
    expect(i.notes).toContain("Direct Debit");
  });

  it("21. credit card statement: due date, not the statement date; balance, with the minimum noted", () => {
    const i = one("Barclaycard\nStatement date 05 Oct 2026\nPayment due date 29 Oct 2026\nMinimum payment £25.00\nNew balance £1,245.67");
    expect(i).toMatchObject({ type: "bill", title: "Barclaycard statement", dueDate: "2026-10-29", amount: 1245.67, source: "Barclaycard" });
    expect(i.notes).toBe("Minimum payment £25.00");
  });

  it("22. an energy bill: 'Pay by', bill date ignored", () => {
    const i = one("British Gas\nYour energy bill\nBill date: 1 Oct 2026\nAmount to pay: £142.36\nPay by 15 Nov 2026 by Direct Debit\nAccount number 4455 6677 8899");
    expect(i).toMatchObject({ type: "bill", title: "British Gas energy bill", dueDate: "2026-11-15", amount: 142.36 });
  });

  it("23. a water bill with UK dd/mm and an 'Issued' date", () => {
    const i = one("Thames Water\nYour water bill\nAmount due £87.20\nDue date 20/11/2026\nIssued 02/10/2026");
    expect(i).toMatchObject({ type: "bill", title: "Thames Water bill", dueDate: "2026-11-20", amount: 87.2 });
  });

  it("24. a broadband bill already past its due date is not flagged (overdue is the point)", () => {
    const i = one("Virgin Media bill\nStatement date 28 Sep 2026\nTotal due £62.00\nPayment due by 12 Oct 2026");
    expect(i).toMatchObject({ type: "bill", dueDate: "2026-10-12", amount: 62 });
    expect(i.checkDate).toBeUndefined();
  });

  it("25. a freelance invoice", () => {
    const i = one("INVOICE #1042\nAcme Design Ltd\nInvoice date: 3 Oct 2026\nDue date: 3 Nov 2026\nTotal due £450.00");
    expect(i).toMatchObject({ type: "bill", dueDate: "2026-11-03", amount: 450 });
  });

  it("26. a bill with a card number never has it in the item, and says it is sensitive", () => {
    const r = read("Capital One\nPayment due date 2 Nov 2026\nMinimum payment £30.00\nPaying by card 4111 1111 1111 1111");
    expect(r.sensitive).toBe(true);
    expect(r.text).not.toContain("4111 1111 1111 1111");
    expect(r.text).toContain("•••• 1111");
    expect(r.items[0]).toMatchObject({ type: "bill", dueDate: "2026-11-02" });
  });
});

describe("Snap: deliveries", () => {
  it("27. Royal Mail 'we missed you': redelivery day, collect-by as the deadline, tracking ref", () => {
    const i = one("Royal Mail\nSorry we missed you\nRedelivery date: Thursday 15 October\nCollect from Delivery Office by 22 Oct\n1 Mill Lane N1 4AB\nRef: RM123456789GB");
    expect(i).toMatchObject({ type: "delivery", title: "Royal Mail delivery", date: "2026-10-15", dueDate: "2026-10-22", reference: "RM123456789GB", source: "Royal Mail" });
  });

  it("28. Amazon: arriving Thursday", () => {
    const i = one("Amazon.co.uk\nArriving tomorrow\nYour package will arrive Thursday, 15 Oct by 9 PM\nOrder #202-1234567-1234567");
    expect(i).toMatchObject({ type: "delivery", date: "2026-10-15", source: "Amazon", reference: "202-1234567-1234567" });
  });

  it("29. DPD: today between two times", () => {
    const i = one("DPD: Your parcel will be delivered today between 14:10 and 15:10. Track: dpd.co.uk");
    expect(i).toMatchObject({ type: "delivery", title: "DPD parcel", date: "2026-10-14", start: "14:10" });
  });

  it("30. Evri: expected Fri 16 Oct", () => {
    const i = one("Evri: your parcel from ASOS is out for delivery. Expected Fri 16 Oct.");
    expect(i).toMatchObject({ type: "delivery", date: "2026-10-16", source: "Evri" });
  });
});

describe("Snap: shift offers and jobs", () => {
  it("31. Unitemps offer: role, day, hours, rate, venue, apply-by", () => {
    const i = one("Unitemps\nNew shift offer\nRole: Exam invigilator\nDate: Tue 24 Nov 2026\nTime: 08:30 - 12:30\nVenue: UCL, Gower Street WC1E 6BT\nRate: £13.50 per hour\nApply by 20 Nov 2026");
    expect(i).toMatchObject({ type: "shift", title: "Exam invigilator shift", date: "2026-11-24", start: "08:30", end: "12:30", dueDate: "2026-11-20", amount: 13.5, source: "Unitemps" });
    expect(i.location).toContain("UCL");
  });

  it("32. King's Talent Bank: a list of two shifts is two items", () => {
    const r = read("King's Talent Bank\nWarehouse assistant shift\nSat 14 Nov 2026 09:00-17:00\n£12.50 per hour\nSteward shift\nSun 15 Nov 2026 10:00-16:00\n£12.50 per hour");
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ type: "shift", title: "Warehouse assistant shift", date: "2026-11-14", start: "09:00", end: "17:00", amount: 12.5 });
    expect(r.items[1]).toMatchObject({ type: "shift", title: "Steward shift", date: "2026-11-15", start: "10:00", end: "16:00" });
    expect(r.items[0].notes).toBe("£12.50 per hour");
  });

  it("33. Pinnacle's email layout is read by the existing share reader", () => {
    const i = one("Pinnacle Event Staff … Approved … Tue, 3 Nov 2026 (07:00-10:00 GMT) · PE898 World Traveller Market Exhibition, Standby");
    expect(i).toMatchObject({ type: "shift", title: "WTM Exhibition shift (Pinnacle) — Standby", date: "2026-11-03", start: "07:00", end: "10:00" });
  });

  it("34. an agency's chat message: this Saturday 7am-3pm", () => {
    const i = one("Hi Sahil, we have a shift for you at the Royal Albert Hall this Saturday 7am-3pm, £14/hr. Can you do it? - Tom, Apex Staffing");
    expect(i).toMatchObject({ type: "shift", date: "2026-10-17", start: "07:00", end: "15:00" });
    expect(i.title.toLowerCase()).toContain("shift");
  });
});

describe("Snap: letters and deadlines", () => {
  it("35. HMRC: the filing deadline", () => {
    const i = one("HMRC\nSelf Assessment tax return\nYou must file your online tax return by 31 January 2027\nIf you miss the deadline you may be charged a penalty");
    expect(i).toMatchObject({ type: "deadline", date: "2027-01-31", source: "HMRC" });
  });

  it("36. DVLA: the earlier of expires and renew-by", () => {
    const i = one("DVLA\nYour vehicle tax expires on 1 Nov 2026. Renew by 31 Oct 2026 to avoid a fine.");
    expect(i).toMatchObject({ type: "deadline", date: "2026-10-31" });
  });

  it("37. a council form to return by a date", () => {
    const i = one("Dear Resident\nPlease return the enclosed electoral registration form by 30 November 2026.\nYours sincerely\nElectoral Services");
    expect(i).toMatchObject({ type: "deadline", date: "2026-11-30" });
  });
});

describe("Snap: chat messages and notes", () => {
  it("38. WhatsApp: party sat 8pm at mine", () => {
    const i = one("party sat 8pm at mine");
    expect(i).toMatchObject({ type: "plan", title: "Party at mine", date: "2026-10-17", start: "20:00" });
  });

  it("39. Hinglish: kal 5 baje call karna (a bare baje is a guess, so it is marked unsure)", () => {
    const i = one("kal 5 baje call karna");
    expect(i).toMatchObject({ type: "plan", title: "Call", date: "2026-10-15", start: "17:00" });
    expect(i.conf.start).toBeLessThan(0.6);
  });

  it("40. Hinglish: parso subah 9 baje gym", () => {
    const i = one("parso subah 9 baje gym");
    expect(i).toMatchObject({ date: "2026-10-16", start: "09:00" });
  });

  it("41. a WhatsApp screenshot: status bar clock, battery, header, chat times and keyboard never become a plan", () => {
    const W = 1080;
    const H = 2400;
    const row = (text: string, y: number, x0 = 60, x1 = W - 60, h = 44) => ({ text, x0, x1, y0: y, y1: y + h });
    const page: OcrPage = {
      width: W,
      height: H,
      lines: [
        row("12:45", 30, 60, 160, 36),
        row("78%", 30, 900, 990, 36),
        row("EE 5G", 30, 700, 820, 36),
        row("Mum", 160),
        row("online", 220),
        row("TODAY", 420),
        row("dinner at Dishoom tomorrow 7.30pm?", 520),
        row("12:41", 570, 880, 1000, 28),
        row("yes book it ✓✓", 700),
        row("12:43", 750, 880, 1000, 28),
        row("q w e r t y u i o p", 1900),
        row("a s d f g h j k l", 2000),
        row("Type a message", 2200),
      ],
    };
    const r = read("", { page });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ date: "2026-10-15", start: "19:30" });
    expect(r.items[0].title.toLowerCase()).toContain("dishoom");
    expect(cleanPage(page).dropped.some((d) => d.startsWith("status bar: 12:45"))).toBe(true);
    expect(r.rawText).not.toContain("12:45");
  });

  it("42. a screenshot where ONLY the status bar clock has a time: it must not become the event time", () => {
    const page: OcrPage = { width: 1080, height: 2400, lines: [{ text: "12:45", x0: 60, x1: 160, y0: 30, y1: 66 }, { text: "Gym session Saturday", x0: 60, x1: 700, y0: 600, y1: 650 }] };
    const r = read("", { page });
    expect(r.items.every((i) => i.start !== "12:45")).toBe(true);
    expect(r.items[0]?.start).toBeUndefined();
  });

  it("43. 'tomorrow' counts from the day the picture was taken (and a day already past is flagged)", () => {
    const taken = new Date(2026, 9, 12, 10, 0); // Mon 12 Oct: tomorrow was Tue 13
    const i = one("drinks tomorrow 6pm at the Crown", { takenAt: taken });
    expect(i).toMatchObject({ date: "2026-10-13", start: "18:00", checkDate: true });
    expect(i.conf.date).toBeLessThan(0.6);
  });

  it("44. the same text taken today resolves to tomorrow and is not flagged", () => {
    const i = one("drinks tomorrow 6pm at the Crown");
    expect(i).toMatchObject({ date: "2026-10-15", start: "18:00" });
    expect(i.checkDate).toBeUndefined();
  });

  it("45. UK vs US: 03/11/2026 is 3 November, never 11 March", () => {
    expect(one("Parent's evening\n03/11/2026 6pm\nSt Mary's School").date).toBe("2026-11-03");
    expect(one("Parent's evening\n3.11.2026 6pm\nSt Mary's School").date).toBe("2026-11-03");
  });

  it("46. a date only the American way can be (month 13) is read that way, marked unsure", () => {
    const i = one("Reservation: Rosa's Thai\n11/13/2026 7pm\nTable for 4");
    expect(i.date).toBe("2026-11-13");
    expect(i.conf.date).toBeLessThan(0.7);
  });

  it("47. a note with no date stays a note with its text kept", () => {
    const r = read("Buy milk, eggs and bread\nremember bin bags");
    expect(r.docType).toBe("note");
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ type: "note", title: "Buy milk, eggs and bread" });
    expect(r.items[0].date).toBeUndefined();
    expect(r.items[0].notes).toContain("bin bags");
  });

  it("48. a day that has already passed is flagged and unsure", () => {
    const i = one("Quiz night\nSat 3 Oct 2026 at 8pm\nThe Anchor");
    expect(i.checkDate).toBe(true);
    expect(i.conf.date).toBeLessThan(0.6);
  });

  it("49. unreadable OCR (symbols, one letter) finds nothing and says the text is weak", () => {
    const r = read("| |\n• •\n~");
    expect(r.items).toEqual([]);
    expect(r.weak).toBe(true);
  });
});

describe("Snap: the sensitive guard", () => {
  it("50. sort code + account number: flagged, masked, no reference kept", () => {
    const r = read("Barclays\nYour payment is due 29 Oct 2026\nPay £312.40 to\nSort code 20-45-45  Account number 12345678\nReference: INV99812");
    expect(r.sensitive).toBe(true);
    expect(r.text).not.toContain("12345678");
    expect(r.text).not.toContain("20-45-45");
    expect(r.items[0].reference).toBeUndefined();
  });

  it("51. recognises card, IBAN, National Insurance, passport, licence and passwords", () => {
    const kinds = (t: string) => findSensitive(t).map((h) => h.kind);
    expect(kinds("Card 4111 1111 1111 1111")).toEqual(["card"]);
    expect(kinds("Order 1234 5678 9012 3456")).toEqual([]); // fails the Luhn check: an order number, not a card
    expect(kinds("IBAN GB82 WEST 1234 5698 7654 32")).toContain("iban");
    expect(kinds("NI number: AB 12 34 56 C")).toEqual(["ni"]);
    expect(kinds("Passport number: 123456789")).toEqual(["passport"]);
    expect(kinds("Licence SMITH061102S97XY")).toEqual(["id"]);
    expect(kinds("Your password is hunter22 do not share")).toEqual(["password"]);
    expect(kinds("CVV 123")).toEqual(["card"]);
  });

  it("52. ordinary things are not flagged (a postcode, a phone number, a booking ref, an 8-digit order number alone)", () => {
    for (const t of ["NW3 2QG", "020 7946 0958", "Booking ref 9ZQ4M2", "Order 12345678", "Table for 2 at 7.30", "Pay by 15 Nov 2026"]) expect(findSensitive(t), t).toEqual([]);
  });

  it("53. masking keeps the last four digits of a card only", () => {
    expect(maskSensitive("Card 4111 1111 1111 1111 expires 12/28")).toBe("Card •••• 1111 expires 12/28");
    expect(maskSensitive("nothing here")).toBe("nothing here");
  });
});

describe("Snap: classification and roles", () => {
  it("54. each kind of document is told apart", () => {
    expect(classify("Amount due £10 pay by 3 Nov invoice")?.type).toBe("bill");
    expect(classify("tickets doors 7pm venue")?.type).toBe("event");
    expect(classify("your appointment at the surgery")?.type).toBe("appointment");
    expect(classify("sorry we missed you parcel redelivery")?.type).toBe("delivery");
    expect(classify("new shift offer £13 per hour")?.type).toBe("shift");
    expect(classify("hello, are you free on sat")).toBeNull();
  });

  it("55. the words before a date decide what it is", () => {
    expect(roleOf("Statement date:")).toBe("ignore");
    expect(roleOf("Payment due by")).toBe("due");
    expect(roleOf("Doors")).toBe("doors");
    expect(roleOf("Starts at")).toBe("start");
    expect(roleOf("Letter date:")).toBe("ignore");
    expect(roleOf("Date of birth")).toBe("ignore");
    expect(roleOf("")).toBe("plain");
  });

  it("56. every item has a confidence for every field it has", () => {
    const i = one("Your tickets\nArctic Monkeys\nO2 Arena, London\nSat 14 Nov 2026\nDoors 18:30  Start 19:30\nTotal £87.50");
    for (const f of ["title", "date", "start", "location", "amount"] as const) expect(i.conf[f], f).toBeGreaterThan(0);
    for (const v of Object.values(i.conf)) expect(v).toBeLessThanOrEqual(1);
  });
});

describe("Snap: messy, real-world OCR (each of these broke the first version)", () => {
  it("57. month-first dates ('Sat, Nov 14') are not read as November 2014 by the UK parser", () => {
    expect(dayFirst("Sat, Nov 14")).toBe("Sat, 14 Nov");
    expect(dayFirst("November 14th, 2026 at 7pm")).toBe("14 November, 2026 at 7pm");
    expect(dayFirst("Oct 2026")).toBe("Oct 2026"); // a month and a year stay as they are
    expect(dayFirst("Nov 14:30")).toBe("Nov 14:30");
    expect(dayFirst("29 Oct 26")).toBe("29 Oct 26"); // a day already in front: left alone
    expect(dayFirst("Payment due 5th Nov 26")).toBe("Payment due 5th Nov 26");
    const i = one("Doors: 7:30 PM\nShow: 8:30 PM\nSat, Nov 14\nTerminal 5");
    expect(i).toMatchObject({ type: "event", date: "2026-11-14", start: "20:30", notes: "Doors 19:30" });
    expect(one("Saturday, November 14, 2026 at 7:00 PM\nTickets\nThe Troxy, London").date).toBe("2026-11-14");
  });

  it("58. the day, the time and the place on separate lines of an unlabelled poster read as ONE event", () => {
    const r = read("Neon Nights\nSaturday\n14 November\n2026\n7:30pm\nO2 Forum Kentish Town");
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ type: "event", title: "Neon Nights", date: "2026-11-14", start: "19:30" });
  });

  it("59. a price that OCR read with an E instead of £ is still the amount to pay", () => {
    expect(one("Thames Water\nAmount due E84.20\nPay by 05/11/2026")).toMatchObject({ type: "bill", amount: 84.2, dueDate: "2026-11-05" });
  });

  it("60. a 'Total' beats a booking fee, and 'Your order' does not make a ticket a delivery", () => {
    const i = one("Your order\nStandard £25.00\nBooking fee £3.50\nTotal £28.50\nSat 14 Nov 2026 7pm\nThe Roundhouse");
    expect(i).toMatchObject({ type: "event", amount: 28.5, date: "2026-11-14", start: "19:00" });
  });

  it("61. a shift list written date-first gets the role as the title, not the rate", () => {
    const r = read("Sat 14 Nov 09:00-17:00 Warehouse\n£12.50/h\nSun 15 Nov 10:00-16:00 Steward\n£12.50/h");
    expect(r.items.map((i) => [i.title, i.date, i.start, i.end])).toEqual([
      ["Warehouse shift", "2026-11-14", "09:00", "17:00"],
      ["Steward shift", "2026-11-15", "10:00", "16:00"],
    ]);
  });

  it("62. two dates on ONE line each take the label in front of them", () => {
    const i = one("STATEMENT DATE 05/10/2026 PAYMENT DUE 29/10/2026\nMINIMUM PAYMENT £25.00\nCLOSING BALANCE £812.30\nHSBC Credit Card");
    expect(i).toMatchObject({ type: "bill", dueDate: "2026-10-29", amount: 812.3 });
    expect(i.notes).toBe("Minimum payment £25.00");
  });

  it("63. two-digit years and a delivery window", () => {
    expect(one("Capital One\nStatement date 05 Oct 26\nPayment due 29 Oct 26\nMinimum payment £25.00\nBalance £500.00").dueDate).toBe("2026-10-29");
    expect(one("Evri\nYour parcel is out for delivery\nDelivery between 08:00-12:00 on 16 Oct")).toMatchObject({ type: "delivery", date: "2026-10-16", start: "08:00", end: "12:00" });
  });

  it("64. an email screenshot: the mail app's name and buttons are not the title", () => {
    const i = one("Gmail\nInbox\nSubject: Your Unitemps booking\nTue 24 Nov 2026 08:30-12:30 Exam invigilator, UCL\nReply\nForward");
    expect(i.type).toBe("shift");
    expect(i.title).not.toMatch(/gmail/i);
    expect(i).toMatchObject({ date: "2026-11-24", start: "08:30", end: "12:30" });
  });

  it("65. a chat: the question is not a plan, the plan loses its 'yes!'", () => {
    const r = read("hey are you free sat?\nyes! lunch at 1pm sat?\nperfect see you at nandos\nok");
    expect(r.items.map((i) => [i.title, i.date, i.start])).toEqual([["Lunch", "2026-10-17", "13:00"]]);
  });

  it("66. a chat time with no am/pm in the small hours is the evening, marked unsure", () => {
    const i = read("book at 7.45 for 8").items[0];
    expect(i.start).toBe("19:45");
    expect(i.conf.start).toBeLessThan(0.6);
  });

  it("67. a festival poster: the year in its name is not a price, gates are the start", () => {
    const i = one("Wireless 2027\nFri 9 Jul 2027\nFinsbury Park\nGates 2pm");
    expect(i).toMatchObject({ type: "event", title: "Wireless 2027", date: "2027-07-09", start: "14:00", location: "Finsbury Park" });
  });

  it("68. rent: what comes before 'due' is what it is for", () => {
    expect(one("Rent due 1st of every month\nPayment of £1,200 due 1 Nov")).toMatchObject({ type: "bill", title: "Rent bill", amount: 1200, dueDate: "2026-11-01" });
  });

  it("69. every kind of date and time survives being split across lines and written in capitals", () => {
    const i = one("the garage highbury\ndoors 7pm. show 8pm.\nfri 20th nov\ntickets £12 adv");
    expect(i).toMatchObject({ type: "event", date: "2026-11-20", start: "20:00", amount: 12 });
  });
});

describe("Snap: big and hostile text never freezes anything", () => {
  const timed = (text: string) => {
    const t0 = performance.now();
    const r = read(text);
    return { ms: performance.now() - t0, r };
  };

  it("70. a long page (400 lines of text with one real event) is read in well under a second", () => {
    const filler = Array.from({ length: 400 }, (_, i) => `Terms and conditions apply to clause ${i + 1} of the agreement between the parties`);
    const { ms, r } = timed([...filler.slice(0, 200), "Your tickets", "Arctic Monkeys", "Sat 14 Nov 2026", "Doors 18:30  Start 19:30", ...filler.slice(200)].join("\n"));
    expect(ms).toBeLessThan(1500);
    expect(r.items.some((i) => i.date === "2026-11-14")).toBe(true);
  });

  it("71. words that look like the role patterns, repeated thousands of times, do not make the matcher blow up", () => {
    for (const text of ["on ".repeat(3000) + "Sat 14 Nov", "by by by ".repeat(1500) + "29 Oct 2026", " ".repeat(5000) + "Sat 14 Nov 7pm", "date and time ".repeat(800) + "14/11/2026", "at at at ".repeat(2000)]) {
      const { ms } = timed(text);
      expect(ms).toBeLessThan(1500);
    }
  });

  it("72. a wall of digits, symbols and money does not blow up the money, reference or sensitive patterns", () => {
    for (const text of ["1234567890".repeat(400), "£1,".repeat(2000), "A1B2C3D4 ".repeat(800), "4111 ".repeat(1500), "GB82 WEST ".repeat(800), "password ".repeat(1500), "AB 12 34 ".repeat(1000)]) {
      const { ms } = timed(text);
      expect(ms).toBeLessThan(2000);
    }
  });

  it("73. a thousand one-word lines (a table photographed from far away) is fine", () => {
    const { ms, r } = timed(Array.from({ length: 1000 }, (_, i) => (i % 7 === 0 ? "12" : "Row")).join("\n"));
    expect(ms).toBeLessThan(2000);
    expect(Array.isArray(r.items)).toBe(true);
  });

  it("74. odd characters (emoji, Devanagari, right-to-left, control characters) never throw", () => {
    for (const text of ["🎉 Party 🎉\nSat 14 Nov 2026 7pm", "शनिवार 14 नवंबर 7 बजे", "‮evil‬ Sat 14 Nov", "a\u0000b\u0007c\nSat 14 Nov", "ｓａｔ １４ ｎｏｖ", "\n\n\n", "", " "]) {
      expect(() => read(text)).not.toThrow();
    }
  });
});

describe("Snap: slips the real recogniser makes (seen on the emulator)", () => {
  it("75. 'O2 Arena' read as '02 Arena' is put right; other numbers are left alone", () => {
    expect(one("Your tickets\nArctic Monkeys\n02 Arena, London\nSat 14 Nov 2026\nStart 19:30").location).toBe("O2 Arena, London");
    expect(one("Gig\n02 Forum Kentish Town\nSat 14 Nov 2026 7pm").location).toContain("O2 Forum");
    expect(one("Quiz night\nSat 14 Nov 2026 8pm\nUnit 02 Industrial Estate, Leeds").location ?? "").not.toContain("O2");
  });
});

describe("Snap: real recogniser output, with real box sizes (the shift list that failed on the emulator)", () => {
  // Exactly what ML Kit returned for the test picture: a stray accent glued to every £, which also made those boxes taller.
  const row = (text: string, y: number, h: number) => ({ text, x0: 60, x1: 900, y0: y, y1: y + h });
  const page: OcrPage = {
    width: 1080,
    height: 1500,
    lines: [
      row("King's Talent Bank", 80, 70),
      row("Warehouse assistant shift", 240, 54),
      row("Sat 14 Nov 2026 09:00-17:00", 320, 48),
      row("Ä£12.50 per hour", 395, 64),
      row("Steward shift", 560, 54),
      row("Sun 15 Nov 2026 10:00-16:00", 640, 48),
      row("Ä£12.50 per hour", 715, 64),
    ],
  };
  it("76. two shifts, the right titles, the right pay, however tall the price boxes are", () => {
    const r = read("", { page });
    expect(r.items.map((i) => [i.title, i.date, i.start, i.end, i.amount])).toEqual([
      ["Warehouse assistant shift", "2026-11-14", "09:00", "17:00", 12.5],
      ["Steward shift", "2026-11-15", "10:00", "16:00", 12.5],
    ]);
  });
  it("77. even without the cleaning step, a tall price line cannot become the title", () => {
    const tall: OcrPage = { ...page, lines: page.lines.map((l) => (/per hour/.test(l.text) ? { ...l, text: "£12.50 per hour", y1: l.y0 + 90 } : l)) };
    expect(read("", { page: tall }).items.map((i) => i.title)).toEqual(["Warehouse assistant shift", "Steward shift"]);
  });
});
