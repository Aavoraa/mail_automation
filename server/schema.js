// Tabs, columns and defaults of the Google Sheet.
const SERVICES = 'Software Development, Custom Software Development, Website & App Development, SaaS & Digital Products, Brand Strategy & Identity, Creative Graphic Design, Content & Video Studio, Personal Branding, SEO & AI Search Visibility, Digital Marketing, Performance Marketing, E-commerce Marketing, Workflow & CRM Automation, AI Inside Operations, Growth & Transformation Consulting';
const INDUSTRIES = 'real estate developer, interior designer, architect, construction company, dental clinic, aesthetic clinic, skin clinic, physiotherapy clinic, private hospital, veterinary clinic, school, coaching institute, training institute, restaurant, cafe, bakery, hotel, resort, travel agency, law firm, accounting firm, business consultant, recruitment agency, logistics company, manufacturer, textile exporter, furniture store, jewellery store, fashion boutique, gym, yoga studio, salon, spa, car dealer, auto repair, solar company, HVAC contractor, cleaning services, pest control, event planner, wedding planner, photographer, IT services company, software startup, insurance agency, financial advisor, home builder, pharmacy, printing company, packaging company';
const CITIES = 'Dubai, Abu Dhabi, Sharjah, Riyadh, Doha, Muscat, London, Manchester, Birmingham, Dublin, New York, Los Angeles, Houston, Chicago, Miami, Dallas, Toronto, Vancouver, Sydney, Melbourne, Auckland, Singapore, Kuala Lumpur, Madrid, Barcelona, Lisbon, Berlin, Munich, Amsterdam, Brussels, Paris, Milan, Warsaw, Prague, Sao Paulo, Mexico City, Johannesburg, Nairobi, Mumbai, Bengaluru, Chennai, Coimbatore, Hyderabad, Delhi, Pune, Kochi';

const TABS = {
  'Settings': ['Key', 'Value', 'What it means'],
  'Raw Leads': ['Lead ID', 'Date Found', 'Source', 'Business Name', 'Industry', 'City', 'Country', 'Website', 'Email', 'Phone', 'Contact Name', 'LinkedIn', 'Google Rating', 'Reviews', 'Website Issues', 'Best Service', 'Pitch Angle', 'Fit Score', 'Status', 'Pitched On', 'Email Subject', 'Message ID', 'Thread ID', 'Template Used', 'Follow-up 1 On', 'Follow-up 2 On', 'Last Reply On', 'Reply Category', 'Notes', 'Sent From', 'Call Status', 'Called By', 'What They Have', 'What They Need', 'Quality', 'WhatsApp Sent On', 'WhatsApp From', 'WhatsApp Chat', 'WhatsApp Reply On', 'WhatsApp Suggested', 'Profile', 'Instagram', 'Facebook', 'X / Twitter', 'TikTok', 'Social Sent On', 'Social Channel'],
  'Qualified Leads': ['Lead ID', 'Date Qualified', 'Source', 'Business Name', 'Contact Name', 'Email', 'LinkedIn', 'Phone', 'Website', 'Country', 'Service Needed', 'Budget', 'Timeline', 'Lead Score', 'Their Message', 'Summary', 'Next Step', 'Owner', 'Team Alerted', 'Our Replies', 'Last Contact On', 'Last Contact By', 'Stage', 'Confirmed On', 'Confirmed By', 'Call Done On', 'Decision Maker', 'Requirement Details', 'Follow-up 1 On', 'Follow-up 2 On', 'Profile'],
  'LinkedIn Leads': ['Lead ID', 'Date Found', 'Name', 'Title', 'Company', 'Industry', 'Location', 'LinkedIn URL', 'Fit Score', 'Best Service', 'Connection Note', 'First Message', 'Status', 'Their Reply', 'Suggested Reply', 'AI Category', 'Forwarded To Team', 'Handled By', 'Notes', 'Email', 'Email Found How', 'Request Sent On', 'Connected On', 'Message Sent On', 'LinkedIn Account', 'Queued Message', 'Profile'],
  'Templates': ['Template ID', 'Name', 'Stage', 'Subject', 'Body', 'AI Personalise', 'Active', 'Created By', 'Updated On'],
  'Replies': ['Reply ID', 'Received On', 'Lead ID', 'Business Name', 'Contact Name', 'From', 'Inbox', 'Subject', 'Their Message', 'Category', 'Summary', 'Our Reply', 'Reply Status', 'Answered By', 'Message ID', 'References'],
  // what the agent pitches: one row per product or service (any company, any sector)
  'Profiles': ['Profile ID', 'Name', 'Active', 'Offer Type', 'Company', 'Website', 'Tagline', 'What We Sell', 'Details', 'Ideal Customer', 'Industries', 'Cities', 'Call To Action', 'Address', 'Created On'],
  // social media posts written by the AI (ready to post, scheduled or posted)
  'Social Posts': ['Post ID', 'Created On', 'Profile', 'Platform', 'Text', 'Hashtags', 'Image Idea', 'Image URL', 'Link', 'Status', 'Scheduled For', 'Posted On', 'Post Link', 'Notes'],
  'Bills': ['Item', 'Monthly Amount (Rs)', 'Paid On', 'Paid By', 'Notes', 'Billing Link'],
  'Users': ['Username', 'Name', 'Role', 'Password Hash', 'Active', 'Created On', 'Last Login'],
};

// [key, default, help, group, type, options]
const SETTINGS = [
  ['AGENT_ON', 'yes', 'Master switch for the whole agent', 'Agent', 'switch'],
  ['REPLY_FALLBACK_MINUTES', '60', 'If the AI is unavailable when a lead replies, wait this many minutes, then send a short polite holding reply and alert the team leader. Type off to always wait for the AI', 'Agent', 'text'],
  ['AI_FOLLOW_UP_HELD', 'yes', 'yes = when the AI was out and only a short holding reply was sent, the AI writes and sends the real answer as soon as it is back (in the same email thread)', 'Agent', 'select', ['yes', 'no']],
  ['REPLY_MODE', 'send', 'send = agent replies by itself. draft = replies are saved as Gmail drafts for you to check', 'Agent', 'select', ['send', 'draft']],
  ['TONE', 'Warm & friendly', 'How every email and message sounds', 'Writing', 'select', ['Warm & friendly', 'Formal & professional', 'Short & direct', 'Consultative expert']],
  ['EMAIL_LANGUAGE', 'auto', 'auto = the language of the lead\'s website, or type a language like English', 'Writing', 'text'],
  ['EXTRA_INSTRUCTIONS', '', 'Anything else the AI must always follow (optional)', 'Writing', 'textarea'],
  ['SENDER_NAME', 'Rohini', 'Name used in emails', 'Sender', 'text'],
  ['SENDER_TITLE', 'Business Development Executive', 'Title under the name', 'Sender', 'text'],
  ['SENDER_LINKEDIN', '', 'Optional: the sender\'s LinkedIn profile link, shown in the email signature. Each sending inbox can have its own sender (Connections → Sending inboxes)', 'Sender', 'text'],
  ['COMPANY', 'AAVORAA', '', 'Sender', 'text'],
  ['COMPANY_DESCRIPTION', 'a digital and technology company', 'One line: what your company is, e.g. "a family-run organic skincare brand" or "an industrial pumps manufacturer"', 'Your offer', 'text'],
  ['OFFER_TYPE', 'service', 'service = you offer services; product = you sell products; both = products and services', 'Your offer', 'select', ['service', 'product', 'both']],
  ['OFFER_DETAILS', '', 'Key benefits, features, prices or offers the AI may mention (only true facts)', 'Your offer', 'textarea'],
  ['IDEAL_CUSTOMER', '', 'Who buys from you, e.g. "dental clinics with 2-10 chairs" or "cafes and bakeries"', 'Your offer', 'text'],
  ['CTA', '', 'The next step the AI proposes, e.g. "a free sample", "a 15-minute demo", "a price list on WhatsApp". Empty = a short call', 'Your offer', 'text'],
  ['WEBSITE', 'aavoraa.com', '', 'Sender', 'text'],
  ['TAGLINE', 'Beyond Possibilities', '', 'Sender', 'text'],
  ['COMPANY_ADDRESS', 'Coimbatore, Tamil Nadu, India', 'Shown in the signature (needed by email laws in US/EU)', 'Sender', 'text'],
  ['BOOKING_LINK', '', 'Optional: your Calendly / Google booking link', 'Sender', 'text'],
  ['TEAM_LEADER_NAME', '', 'Who gets hot-lead alerts', 'Team', 'text'],
  ['TEAM_LEADER_EMAIL', '', 'Email for hot-lead alerts', 'Team', 'text'],
  ['TEAM_LEADER_LINKEDIN', '', 'Team leader\'s LinkedIn profile link', 'Team', 'text'],
  ['ALERT_TEAM_FOR_EMAIL_LEADS', 'yes', 'Also alert the team leader for interested email leads', 'Team', 'select', ['yes', 'no']],
  ['REPORT_EMAILS', 'aavoraa.marketing@gmail.com', 'Who gets the 8:30 PM daily report (comma separated)', 'Team', 'text'],
  ['START_DATE', '', 'Day sending starts (YYYY-MM-DD). The daily limit grows from this day', 'Sending limits', 'date'],
  ['DAILY_START_LIMIT', '20', 'Warm-up: emails per day in week 1, for EACH inbox (up to 50; 20 is safest)', 'Sending limits', 'number'],
  ['WEEKLY_INCREASE', '10', 'Warm-up: extra emails per day added each week (up to 25)', 'Sending limits', 'number'],
  ['DAILY_MAX_LIMIT', '50', 'Emails per day for EACH inbox (up to 500, Gmail\'s own limit; Google Workspace allows more but 500 is the app\'s maximum). Above about 100 a day, cold emails land in spam more often', 'Sending limits', 'number'],
  ['SEND_ORDER', 'spread', 'one-by-one = the first inbox sends until its daily limit is used, then the next inbox takes over. spread = every inbox sends a little all day (safest)', 'Sending limits', 'select', ['spread', 'one-by-one']],
  ['EMAIL_WARMUP', 'yes', 'yes = each inbox starts low (DAILY_START_LIMIT) and grows every week (safest for new inboxes). no = send the full DAILY_MAX_LIMIT from day one', 'Sending limits', 'select', ['yes', 'no']],
  ['FOLLOWUP_1_DAYS', '3', 'Days after the first email for follow-up 1', 'Sending limits', 'number'],
  ['FOLLOWUP_2_DAYS', '7', 'Days after the first email for follow-up 2', 'Sending limits', 'number'],
  ['EMAILS_PER_DAY_TARGET', '200', 'How many emails a day you want to send in total. The Dashboard shows how many inboxes that needs (each inbox sends at most DAILY_MAX_LIMIT)', 'Sending limits', 'number'],
  ['IMPORT_SEND_NOW', 'yes', 'yes = leads you import are emailed first and straight away (within the daily limit, any time of day). no = they wait for the normal sending schedule, still first in line', 'Sending limits', 'select', ['yes', 'no']],
  ['SEND_PACING', 'even', 'even = spread each day\'s emails evenly over the sending hours (safest for Gmail). fast = one email every 5 minutes per inbox until the daily limit', 'Sending limits', 'select', ['even', 'fast']],
  ['SEND_HOURS', '8-20', 'Only send new emails between these hours (India time), e.g. 8-20. Use 0-24 for all day', 'Sending limits', 'text'],
  ['MIN_FIT_SCORE', '5', 'Leads the AI scores below this are still emailed, but after the better-fitting ones', 'Lead finding', 'number'],
  ['APIFY_CONTACTS', 'yes', 'Only when Apify (paid) is chosen on the Connections page: Apify also reads each business website for emails', 'Lead finding', 'select', ['yes', 'no']],
  ['DO_NOT_CONTACT', '', 'Never email these: one email address or domain per line (e.g. name@company.com or company.com). Also filled by the "Don\'t contact" button on All email leads', 'Do not contact', 'textarea'],
  ['GUESS_EMAILS', 'no', 'yes = if no email is found anywhere, use info@ their domain and email it. These bounce far more often (about 1 in 7), and many bounces get the inbox blocked. no (safest) = those leads go to Call / WhatsApp instead', 'Lead finding', 'select', ['yes', 'no']],
  ['LEADS_PER_SEARCH', '25', 'Most new leads added per search (all sources together)', 'Lead finding', 'number'],
  ['LEADS_PER_DAY', '200', 'Daily target of new leads (200-500). The finder searches every 30 minutes until it is reached. 0 = use FIND_EVERY_HOURS instead', 'Lead finding', 'number'],
  ['QUALITY_FIT_SCORE', '7', 'Leads with an email and a fit score of at least this are marked quality leads (target: 10-30 a day)', 'Lead finding', 'number'],
  ['FIND_EVERY_HOURS', '8', 'Only when LEADS_PER_DAY is 0: how often to search for new businesses', 'Lead finding', 'number'],
  ['LINKEDIN_PER_RUN', '10', 'LinkedIn prospects added per search', 'Lead finding', 'number'],
  ['LINKEDIN_EVERY_HOURS', '12', 'How often to search for LinkedIn prospects', 'Lead finding', 'number'],
  ['WHATSAPP_TEMPLATE', '', 'Name of your APPROVED WhatsApp message template (WhatsApp Manager → Message templates). WhatsApp only allows templates for the first message', 'WhatsApp', 'text'],
  ['WHATSAPP_TEMPLATE_LANG', 'en', 'Language code of that template, e.g. en, en_US, ta', 'WhatsApp', 'text'],
  ['WHATSAPP_TEMPLATE_PARAMS', 'name', 'name = the template has one variable {{1}} for their name. none = no variables', 'WhatsApp', 'select', ['name', 'none']],
  ['WHATSAPP_PITCH_TO', 'interested', 'Who gets a WhatsApp pitch: interested = leads who replied or showed interest (safest, WhatsApp blocks numbers that many people report). pitched = everyone already emailed. all = every lead with a phone number', 'WhatsApp', 'select', ['interested', 'pitched', 'all']],
  ['WHATSAPP_PER_DAY', '50', 'WhatsApp pitches a day for EACH connected WhatsApp number. When one number is full or has a problem, the next one takes over (new Meta businesses usually start at 250 a day in total)', 'WhatsApp', 'number'],
  ['LINKEDIN_AUTO_CONNECT', 'no', 'Windows app only: send LinkedIn connection requests automatically from your own LinkedIn (sign in once on the LinkedIn tasks page). You are notified when someone accepts, to send them the first message. LinkedIn does not allow automation tools, so keep the number low', 'LinkedIn auto-connect', 'switch'],
  ['LINKEDIN_CONNECT_PER_DAY', '25', 'Connection requests per day for EACH LinkedIn account (up to 100). When one account is full, the next team account takes over. LinkedIn itself allows about 100 a week on free accounts; going over can get the account restricted', 'LinkedIn auto-connect', 'number'],
  ['LINKEDIN_CONNECT_PER_WEEK', '100', 'Connection requests per week for EACH LinkedIn account (up to 200). LinkedIn\'s usual limit is about 100 a week (more with Premium / a high acceptance rate). When LinkedIn shows its limit, the app pauses for 7 days', 'LinkedIn auto-connect', 'number'],
  ['LINKEDIN_AUTO_MESSAGE', 'yes', 'yes = when someone accepts, the first message (and the AI\'s answer when they reply) is sent on LinkedIn automatically, during the sending hours', 'LinkedIn auto-connect', 'select', ['yes', 'no']],
  ['LINKEDIN_MESSAGES_PER_DAY', '60', 'Most LinkedIn messages a day for EACH LinkedIn account (up to 150)', 'LinkedIn auto-connect', 'number'],
  ['LINKEDIN_CONNECT_HOURS', '10-18', 'Only send requests between these hours (India time), Monday to Saturday', 'LinkedIn auto-connect', 'text'],
  ['LINKEDIN_CONNECT_NOTE', 'yes', 'yes = add the AI-written note to each request (free LinkedIn accounts get only a few notes a month; after that requests go without a note)', 'LinkedIn auto-connect', 'select', ['yes', 'no']],
  ['INDUSTRIES', INDUSTRIES, 'Comma separated. One is picked at random each search', 'Targets', 'textarea'],
  ['CITIES', CITIES, 'Comma separated. Any city or country', 'Targets', 'textarea'],
  ['SERVICES', SERVICES, 'What the AI is allowed to offer', 'Targets', 'textarea'],
  ['OPENAI_MODEL', 'auto', 'Only when ChatGPT (paid) is chosen: ChatGPT model. auto = a fast, low-cost model your key can use (recommended). Or type an exact name, e.g. gpt-4.1-mini', 'Advanced', 'text'],
  ['OPENAI_DAILY_LIMIT', '500', 'Only when ChatGPT (paid) is chosen: most ChatGPT requests per day, to cap your OpenAI bill (about 1 request per email or reply). Some are always kept for answering customer replies', 'Advanced', 'number'],
  ['AI_FALLBACK', 'template', 'When the AI is out of requests: template = still send pitches using your template (or a plain email), wait = hold pitches until the AI is back', 'Advanced', 'select', ['template', 'wait']],
  ['AI_DAILY_LIMIT', '20', 'Gemini requests per day for EACH free Gemini model (Google allows about 20 each). When one model is used up the app switches to the next free Gemini or Gemma model, so the AI keeps answering. Only if all are used up are your templates used until the next day', 'Advanced', 'number'],
  ['GEMINI_MODEL', 'auto', 'Gemini model. auto = the best free Gemini Flash model your key can use', 'Advanced', 'text'],
];

const TONES = {
  'Warm & friendly': 'warm, friendly and human, like a helpful person writing to someone they respect',
  'Formal & professional': 'formal, polished and professional, still human and never stiff or robotic',
  'Short & direct': 'very short and direct: get to the point in a few plain sentences, no small talk',
  'Consultative expert': 'calm and consultative, like an experienced advisor sharing one sharp, useful insight',
};

const STAGES = ['First email', 'Follow-up 1', 'Follow-up 2', 'Reply to interested lead', 'LinkedIn connection note', 'LinkedIn first message'];

const DEFAULT_TEMPLATES = [
  { Name: 'Website observation', Stage: 'First email', Subject: 'quick idea for {{business}}',
    Body: 'Hi {{first_name}},\n\nI was looking at {{business}} and noticed {{issue}}.\n\n{{opportunity}} This is exactly the kind of thing our {{service}} team fixes for businesses like yours.\n\nWould a free 10-minute audit be useful? Happy to send it over.\n\nIf this isn\'t relevant, just reply \'no\' and I won\'t email again.',
    'AI Personalise': 'yes', Active: 'yes' },
  { Name: 'Helpful tip follow-up', Stage: 'Follow-up 1', Subject: '',
    Body: 'Hi {{first_name}}, one quick idea since my last note: {{tip}}\n\nWould it help if I shared how this could work for {{business}}?',
    'AI Personalise': 'yes', Active: 'yes' },
  { Name: 'Polite last note', Stage: 'Follow-up 2', Subject: '',
    Body: 'Hi {{first_name}}, I don\'t want to fill your inbox, so this is my last note. If {{service}} becomes a priority later, I\'m just a reply away. Wishing {{business}} a great season.',
    'AI Personalise': 'yes', Active: 'yes' },
];

const ROLES = {
  owner: 'Owner (everything)',
  leader: 'Team Leader (leads, qualified, LinkedIn, templates, import)',
  linkedin: 'LinkedIn Executive (LinkedIn tasks only)',
};

module.exports = { TABS, SETTINGS, TONES, STAGES, DEFAULT_TEMPLATES, ROLES };
