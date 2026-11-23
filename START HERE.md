# AAVORAA Lead Agent: Start here

This app works as your 24/7 lead-generation employee. It finds businesses, emails them from **aavoraa.marketing@gmail.com**, follows up, answers replies, qualifies interested people, prepares LinkedIn messages and alerts your team leader.
It's free to run: no n8n, no Docker, no monthly fees.

---

## 1. Open the app (2 minutes)
1. Right-click **AAVORAA_Lead_Agent_Windows.zip**, choose **Extract All…**, and pick a permanent place, e.g. `C:\AAVORAA Lead Agent`.
2. Open the folder and double-click **AAVORAA Lead Agent.exe**.
3. Windows may show *"Windows protected your PC"* because the app is new and not yet signed. Click **More info → Run anyway**. This happens only once.
4. If Windows asks about network access, tick **Private networks** and click **Allow**. This lets your team open the app on the office Wi-Fi.
5. Tip: right-click the .exe, choose **Send to → Desktop (create shortcut)**.

## 2. First-time setup (the app guides you, about 30 minutes, only once)
The setup screen walks you through 5 steps, with instructions on each:

| Step | What you need | Where to get it (free) |
|---|---|---|
| 1. Google Sheet | An empty Google Sheet + a **service account key (.json)** | sheets.new and console.cloud.google.com (enable Google Sheets API → Credentials → Service account → Keys → JSON). Then **share the sheet** with the service account email as **Editor** |
| 2. Gmail | A Gmail **App Password** for aavoraa.marketing@gmail.com | myaccount.google.com → Security → 2-Step Verification ON → "App passwords". Also turn on IMAP in Gmail settings |
| 3. Gemini AI | API key | aistudio.google.com → Get API key |
| 4. Apify | API token | apify.com → Settings → API & Integrations |
| 5. Owner login | Your username + password | You choose |

Each step has a **Save & test** button, so you'll know right away if something is wrong.
The app creates all the tabs in your Google Sheet by itself: Settings, Raw Leads, Qualified Leads, LinkedIn Leads, Templates and Users.

## 3. Before switching it on
- Open **Settings**: fill in the team leader's name, email and LinkedIn, plus your booking link (optional), and check START DATE.
- Open **Templates & tone**: choose a tone, and edit the 3 starter templates or add your own. Use **Generate preview** to see a real email before anything is sent.
- First week tip: set **Reply mode = draft**. The agent then saves its replies as Gmail drafts so you can check them. Switch to **send** when you're happy.
- Open **Agent activity** → turn on **Start with Windows** so the agent never misses a day.

## 4. Add your team
**Team & logins → Add person**:
- **Team Leader**: sees leads, qualified leads, LinkedIn, import and templates, and gets an email for every interested lead.
- **LinkedIn Executive**: sees only the LinkedIn task cards.

Your team opens the address shown on that page (like `http://192.168.1.5:4780`) in Chrome on any computer or phone on the same office Wi-Fi.

## 5. Daily life
| Who | Does what | Time |
|---|---|---|
| The agent | Finds leads every 8 h, emails every hour (8 AM–8 PM, within the daily limit), reads replies every 5 min, finds LinkedIn prospects every 12 h, sends a report at 8:30 PM | 24/7 |
| LinkedIn Executive | **LinkedIn tasks** page: Copy message → Open profile → send → click what happened → paste their reply | 10 min/day |
| Team Leader | Gets an email for each interested lead, follows up, and updates the next step in **Qualified leads** | as needed |
| You | Check the **Dashboard**, import your own lists, adjust templates | 5 min/day |

## 6. Safety built in
- Gmail warm-up: 20 emails a day in week 1, then +10 each week, up to a maximum of 50, with 45–105 seconds between emails.
- Every first email says *"reply 'no' and I won't email again"*. People who say no are never emailed again.
- The AI never quotes prices, invents clients or promises deadlines.
- Passwords and keys stay **only on this PC, encrypted**, never in the Google Sheet.
- The agent never logs in to LinkedIn, so the account can't be banned.
- **Pause everything:** the ON/OFF switch on the Dashboard.

## 7. Good to know
- The agent works while this PC is on and the app is running. Closing the window keeps it running in the background; look for the gold **A** icon near the clock. To stop it completely, right-click that icon → **Quit**.
- Free limits: Apify covers about 1,000 Google Maps businesses a month. To pitch more, use **Import leads** with your own Excel/CSV lists.
- Your data lives in your Google Sheet, so you can open it there any time.

## Problems?
| You see | Do this |
|---|---|
| Google Sheets 403 / permission | Share the sheet with the service account email as **Editor** |
| Gmail "Invalid login" | Create a new App Password (2-Step Verification must be ON) and paste it in **Connections** |
| Team can't open the link | Same Wi-Fi? Allow the app in Windows Firewall (Windows Security → Firewall → Allow an app) |
| Nothing is being emailed | Check: Agent ON, START DATE not in the future, sending hours, leads with Status **New** |
| See what happened | **Agent activity** shows every run and error |
