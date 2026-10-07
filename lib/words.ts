/**
 * The offline dictionary's word lists: everyday words and phrases in English, Roman Hinglish and Devanagari, per area.
 * `lib/dictionary.ts` turns each group into a pattern with a weight (strong nouns count more than weak verbs), so
 * "fill the visa form" lands in Admin and "pay rent" in Finance even though both start with a verb.
 *
 * Add to these lists freely: one phrase per entry, commas between them. Words you teach the app on the phone
 * ("Add to my dictionary?") live in your own data and are checked first.
 */
export type WordGroup = [phrases: string[], weight: number];

const p = (list: string): string[] =>
  list
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export const EXTRA_WORDS: Record<string, WordGroup[]> = {
  // ---- Work -------------------------------------------------------------------------------------------------
  work: [
    [
      p(
        "stand up, standup, daily sync, team sync, retro, sprint planning, backlog, jira ticket, confluence, slack message, teams meeting, zoom call, meeting notes, minutes of meeting, status update, status report, weekly report, monthly report, timesheet, expense claim, reimbursement, leave request, apply for leave, sign off, handover, hand over, onboarding, kt session, client call, stakeholder, deliverable, milestone, project plan, presentation, slides, powerpoint, proposal, quotation, statement of work, spreadsheet, excel sheet, my manager, team lead, hr team, payroll team, appraisal form, okr, kpi review, one on one, 1:1, performance feedback, work from home, wfh, office laptop, vpn, standup notes, escalate, raise a ticket, bug fix, meeting room, production bug, production issue, prod issue, bug, hotfix, code review, pull request, deploy, release notes, test cases, documentation, calendar invite, book meeting room, kaam, ऑफिस, मीटिंग, रिपोर्ट, प्रेजेंटेशन, क्लाइंट, काम खत्म",
      ),
      4,
    ],
    [
      p(
        "send update, share update, send the report, send report, submit report, submit timesheet, reply to, respond to, follow up with, followup, check in with the team, forward the email, mail karna, reply karna, report banana, presentation banani, update bhejna, meeting hai, meeting attend, attend the meeting, join the call, prepare the deck, finish the report, review the document, review the doc, review pr, approve the request, send invoice, chase invoice, schedule a meeting, reschedule the meeting, send agenda, take notes, write the summary, draft the email, sort the inbox, clear the inbox, inbox zero, starred emails",
      ),
      3,
    ],
    [p("email, e-mail, mail, reply, respond, follow up, meeting, report, team, project, deadline, invoice, office"), 2],
  ],

  // ---- Career / Power BI --------------------------------------------------------------------------------------
  powerbi: [
    [
      p(
        "power bi, powerbi, dax, power query, m query, pbix, slicer, slicers, calculated column, calculated measure, measures, star schema, data model, dataflow, semantic model, drill through, drillthrough, tooltip page, row level security, rls, paginated report, tabular editor, dax studio, dashboard, dashboards, visuals, kpi card, matrix visual, dp-600, pl-300, pl300, dp600, microsoft fabric, lakehouse, onelake, bi report, report visuals, data viz, data visualisation, data visualization, डैशबोर्ड, पावर बीआई",
      ),
      5,
    ],
    [p("sql practice, sql query, sql joins, etl, data cleaning, data modelling, data modeling, data storytelling, excel pivot, pivot table, dataset, refresh schedule, gateway, workspace, bookmarks"), 3],
  ],
  career: [
    [
      p(
        "networking, personal brand, side project, promotion, appraisal, performance review, mentor, mentoring, career plan, career goals, skill gap, linkedin post, blog post, portfolio project, open source, give a talk, speaker, conference, meetup, community event, thought leadership, career coach, upskill plan",
      ),
      3,
    ],
  ],

  // ---- Job prep / apply -----------------------------------------------------------------------------------------
  job: [
    [
      p(
        "job application, apply for job, apply for jobs, apply to jobs, naukri, indeed, glassdoor, linkedin jobs, recruiter, hr call, screening call, phone screen, technical round, hr round, interview prep, interview preparation, mock interview, leetcode, hackerrank, sql interview, case study, take home assignment, offer letter, salary negotiation, negotiate salary, notice period, resignation letter, resume, résumé, cv, cover letter, portfolio, github profile, referral, ask for a referral, follow up with recruiter, thank you email, job alert, job hunt, job search, career fair, cold email, cold dm, नौकरी, इंटरव्यू, रिज्यूमे, बायोडाटा, नौकरी के लिए अप्लाई",
      ),
      5,
    ],
    [p("apply karna, apply kar, resume bhejna, cv bhejna, interview ki taiyari, interview ki tayari, naukri dhundhna, naukri dhoondhna, job ke liye apply, jobs apply, application bhejna, referral maangna"), 4],
    [p("apply, applied, applying, application, applications, interview, interviews, hiring, vacancy, opening"), 2],
  ],

  // ---- Health ---------------------------------------------------------------------------------------------------
  health: [
    [
      p(
        "gym, workout, exercise, yoga, pilates, zumba, cardio, stretching, physio, physiotherapy, doctor, dentist, dental, check-up, checkup, blood test, lab test, ultrasound, x-ray, mri, ecg, vaccine, vaccination, flu jab, prescription, pharmacy, chemist, medicine, medication, tablet, tablets, pills, vitamin, vitamins, supplements, protein shake, diet plan, calories, weigh myself, blood pressure, sugar test, eye test, optician, contact lenses, haircut, barber, salon, spa, massage, therapy, counsellor, counselling, mental health, dermatologist, skincare, sunscreen, shave, nail trim, manicure, hospital, clinic, dawai, dawa, दवाई, दवा, डॉक्टर, जिम, योग, इलाज, अस्पताल, व्यायाम, कसरत, dawai leni, dawai lena, doctor ko dikhana, checkup karwana, exercise karna, yoga karna, gym jana",
      ),
      4,
    ],
    [p("stretch, hydrate, drink water, water intake, sleep early, early sleep, nap, running, go for a run, jog, sit-ups, push-ups, plank, skipping, cycling, swim, swimming, badminton, football, cricket practice, sports"), 3],
  ],

  // ---- Learning -------------------------------------------------------------------------------------------------
  learning: [
    [
      p(
        "study, course, tutorial, lecture, class, classes, exam, exams, test prep, revision, revise, homework, udemy, coursera, youtube tutorial, certification, syllabus, flashcards, practice problems, mock test, workshop, webinar, bootcamp, training, upskill, reskill, new skill, padhai, padhna, padhai karni, seekhna, sikhna, revise karna, notes banana, exam ki taiyari, पढ़ाई, पढ़ना, सीखना, कोर्स, परीक्षा, कक्षा",
      ),
      4,
    ],
    [p("learn, learning, lesson, module, chapter, quiz, assignment, thesis, research paper, dissertation"), 3],
  ],

  // ---- Home -----------------------------------------------------------------------------------------------------
  home: [
    [
      p(
        "clean, cleaning, laundry, wash clothes, washing machine, dishes, dishwasher, vacuum, mop, sweep, dust, tidy, declutter, organise the, organize the, cook, cooking, meal prep, recipe, kitchen, fridge, bathroom, toilet, garbage, trash, bins, recycling, iron clothes, ironing, bedsheets, wardrobe, plumber, electrician, carpenter, painter, handyman, repair, furniture, curtains, water the plants, gardening, light bulb, leaking tap, boiler, heating, ac service, pest control, maid, safai, saaf karna, jhadu, jhadu lagana, pocha, pocha lagana, kapde, kapde dhona, dhona, bartan, khana banana, khana pakana, pakana, safai karni, सफाई, झाड़ू, पोछा, कपड़े, बर्तन, खाना बनाना, घर, घर का काम, unpack, pack boxes, move house, flat, roommate, landlord repairs",
      ),
      4,
    ],
    [p("wash, washed, put away, redecorate, change the bulb, change bedsheets, empty the, take out the bins, pick up the keys, drop off the keys"), 2],
  ],

  // ---- Shopping -------------------------------------------------------------------------------------------------
  shopping: [
    [
      p(
        "order online, amazon, flipkart, myntra, ajio, meesho, nykaa, zepto, blinkit, instamart, ebay, asos, zara, uniqlo, primark, argos, ikea, return parcel, return the parcel, return item, return the order, exchange, refund, courier, parcel, delivery, track order, wishlist, sale, discount, coupon, voucher, shoes, sneakers, clothes, jacket, jeans, shirt, t-shirt, dress, kurta, saree, bag, backpack, wrist watch, smart watch, phone case, charger, earphones, headphones, laptop bag, kharidna, kharidari, खरीदना, खरीदारी, ऑर्डर, मंगवाना, order karna, wapas karna, return karna, mangwana",
      ),
      4,
    ],
    [p("buy, purchase, get a, pick up the parcel, collect the parcel, lena hai, leni hai, lene jana, shop for"), 2],
  ],

  // ---- Finance / bills -------------------------------------------------------------------------------------------
  finance: [
    [
      p(
        "pay, payment, bill, bills, rent, kiraya, electricity, bijli, water bill, gas bill, broadband, wifi bill, mobile bill, recharge, credit card, debit card, bank, transfer money, upi, neft, imps, paytm, gpay, phonepe, loan, emi, mortgage, insurance, premium, tax refund, itr, income tax, gst, tds, salary, payslip, bonus, budget, expenses, savings, invest, investment, sip, mutual fund, stocks, shares, etf, fixed deposit, fd, ppf, nps, crypto, withdraw, atm, cash, bank statement, passbook, cheque, kyc, subscription, netflix, spotify, prime membership, cancel subscription, standing order, direct debit, overdraft, paisa, paise, पैसे, बिल, किराया, बैंक, लोन, बीमा, टैक्स, bharna, bill bharna, emi bharna, payment karna, paise bhejna, transfer karna, bhugtan",
      ),
      4,
    ],
    [p("pay off, settle up, split the bill, owe, lend, borrow, return the money, reimburse me, recharge karna, balance check, check balance, net banking, bank app, credit score"), 3],
  ],

  // ---- Family & friends -----------------------------------------------------------------------------------------
  family: [
    [
      p(
        "mum, mom, mummy, mama, maa, dad, daddy, papa, parents, sister, didi, bhai, brother, bhabhi, jiju, grandma, grandpa, nani, nana, dadi, dada, uncle, aunt, aunty, chacha, chachi, mausi, cousin, in-laws, family, call home, ghar pe call, friends, friend, dost, yaar, buddy, catch up with, meet up, birthday, bday, anniversary, wish them, gift for, surprise for, wedding, shaadi, reception, engagement, baby shower, kaisa hai, मम्मी, पापा, भाई, बहन, दोस्त, परिवार, जन्मदिन, शादी, रिश्तेदार, milna hai, milne jana, phone karna",
      ),
      4,
    ],
    [p("visit, check on, check in on, say hi, text back, ring, video call, facetime, whatsapp call, invite, send wishes, send a card, send flowers"), 2],
  ],

  // ---- Travel ---------------------------------------------------------------------------------------------------
  travel: [
    [
      p(
        "flight, flights, airport, airline, boarding pass, web check-in, online check-in, itinerary, luggage, suitcase, pack bags, packing list, passport, visa, vacation, holiday, hotel, hostel, airbnb, tour, trip, road trip, train ticket, train, irctc, tatkal, bus ticket, redbus, cab, uber, ola, taxi, metro pass, oyster, railcard, travelcard, forex, currency exchange, travel insurance, roaming, yatra, safar, यात्रा, सफर, टिकट, उड़ान, होटल, ticket book, ticket karna, ticket lena, booking karna",
      ),
      4,
    ],
    [p("book a, book the, reserve, reservation, leave for, drive to, travel to, going to, back from, pick up from the airport, drop at the station, drop off at the airport"), 1],
  ],

  // ---- Admin / forms / appointments --------------------------------------------------------------------------------
  admin: [
    [
      p(
        "form, forms, fill the form, fill form, fill in, fill out, submit the form, application form, documents, paperwork, certificate, affidavit, notary, attestation, apostille, passport renewal, renew passport, licence, license, driving licence, dvla, aadhaar, aadhar, pan card, voter id, ration card, address proof, change of address, council, nhs, gp registration, book appointment, reschedule appointment, cancel appointment, renewal, expiry, visa application, biometric, brp, ilr, ukvi, home office, hmrc, tax return, self assessment, bank account opening, tenancy agreement, deposit protection, complaint, raise a complaint, post office, post a letter, stamp, courier documents, print out, printout, print the, scan documents, photocopy, xerox, photo id, id proof, registration, register for, sign the, signature, e-sign, docusign, कागज, फॉर्म, दस्तावेज, आधार, पासपोर्ट, लाइसेंस, renew karna",
      ),
      4,
    ],
    [p("fill, submit, renew, cancel, post, print, sign, apply for, apply online, upload, download the, send documents, collect, collect the"), 2],
    [p("form bharna, form jama, forms jama, documents jama, document jama, document bhejna, documents bhejna, print nikalna, print karwana, scan karna, sign karna, appointment lena, appointment book, फॉर्म भरना, फॉर्म जमा"), 7],
  ],

  // ---- Going out / fun --------------------------------------------------------------------------------------------
  fun: [
    [
      p(
        "movie, film, cinema, concert, gig, festival, theatre, museum, exhibition, pub, bar, club, clubbing, karaoke, bowling, picnic, party, date night, dinner out, lunch out, brunch, restaurant, cafe, coffee date, drinks, beach, go out, going out, hang out, hangout, outing, amusement park, zoo, comedy show, stand-up show, match, game night, board games, picture dekhna, film dekhna, ghumne, ghumne jana, घूमने, पिक्चर, फिल्म, पार्टी, मूवी, डेट, बाहर जाना",
      ),
      4,
    ],
  ],

  // ---- Ideas / notes -----------------------------------------------------------------------------------------------
  notes: [
    [
      p(
        "idea, ideas, note to self, thought, jot down, brain dump, someday, maybe later, research, look into, explore, read later, save for later, to read, to watch, watchlist, reading list, bucket list, quote, wishlist idea, विचार, आइडिया, याद रखना",
      ),
      3,
    ],
  ],

  // ---- Your weekly-target areas -----------------------------------------------------------------------------------
  meditation: [[p("mindfulness, breathing exercise, pranayama, anulom vilom, kapalbhati, om chanting, gratitude journal, body scan, guided meditation, headspace, calm app, dhyaan, ध्यान, प्राणायाम, शांत बैठना"), 5]],
  english: [[p("reading, novel, kindle, audiobook, newspaper, article, magazine, vocabulary, vocab, grammar, ielts, toefl, pronunciation, speaking practice, spoken english, essay writing, writing practice, short story, poem, podcast, word of the day, kitab padhna, अंग्रेज़ी"), 4]],
  walking: [[p("walk, walking, stroll, hike, trek, morning walk, evening walk, step count, 10k steps, park, tehalna, tahalna, ghumne jana, सैर, टहलना, पैदल"), 5]],
};
