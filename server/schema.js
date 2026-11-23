// Tabs, columns and defaults of the Google Sheet.
const SERVICES = 'Software Development, Custom Software Development, Website & App Development, SaaS & Digital Products, Brand Strategy & Identity, Creative Graphic Design, Content & Video Studio, Personal Branding, SEO & AI Search Visibility, Digital Marketing, Performance Marketing, E-commerce Marketing, Workflow & CRM Automation, AI Inside Operations, Growth & Transformation Consulting';
const INDUSTRIES = 'real estate developer, interior designer, architect, construction company, dental clinic, aesthetic clinic, skin clinic, physiotherapy clinic, private hospital, veterinary clinic, school, coaching institute, training institute, restaurant, cafe, bakery, hotel, resort, travel agency, law firm, accounting firm, business consultant, recruitment agency, logistics company, manufacturer, textile exporter, furniture store, jewellery store, fashion boutique, gym, yoga studio, salon, spa, car dealer, auto repair, solar company, HVAC contractor, cleaning services, pest control, event planner, wedding planner, photographer, IT services company, software startup, insurance agency, financial advisor, home builder, pharmacy, printing company, packaging company';
const CITIES = 'Dubai, Abu Dhabi, Sharjah, Riyadh, Doha, Muscat, London, Manchester, Birmingham, Dublin, New York, Los Angeles, Houston, Chicago, Miami, Dallas, Toronto, Vancouver, Sydney, Melbourne, Auckland, Singapore, Kuala Lumpur, Madrid, Barcelona, Lisbon, Berlin, Munich, Amsterdam, Brussels, Paris, Milan, Warsaw, Prague, Sao Paulo, Mexico City, Johannesburg, Nairobi, Mumbai, Bengaluru, Chennai, Coimbatore, Hyderabad, Delhi, Pune, Kochi';

const TABS = {
  'Settings': ['Key', 'Value', 'What it means'],
  'Raw Leads': ['Lead ID', 'Date Found', 'Source', 'Business Name', 'Industry', 'City', 'Country', 'Website', 'Email', 'Phone', 'Contact Name', 'LinkedIn', 'Google Rating', 'Reviews', 'Website Issues', 'Best Service', 'Pitch Angle', 'Fit Score', 'Status', 'Pitched On', 'Email Subject', 'Message ID', 'Thread ID', 'Template Used', 'Follow-up 1 On', 'Follow-up 2 On', 'Last Reply On', 'Reply Category', 'Notes'],
  'Qualified Leads': ['Lead ID', 'Date Qualified', 'Source', 'Business Name', 'Contact Name', 'Email', 'LinkedIn', 'Phone', 'Website', 'Country', 'Service Needed', 'Budget', 'Timeline', 'Lead Score', 'Their Message', 'Summary', 'Next Step', 'Owner', 'Team Alerted'],
  'LinkedIn Leads': ['Lead ID', 'Date Found', 'Name', 'Title', 'Company', 'Industry', 'Location', 'LinkedIn URL', 'Fit Score', 'Best Service', 'Connection Note', 'First Message', 'Status', 'Their Reply', 'Suggested Reply', 'AI Category', 'Forwarded To Team', 'Handled By', 'Notes'],
  'Templates': ['Template ID', 'Name', 'Stage', 'Subject', 'Body', 'AI Personalise', 'Active', 'Created By', 'Updated On'],
  'Users': ['Username', 'Name', 'Role', 'Password Hash', 'Active', 'Created On', 'Last Login'],
};

// [key, default, help, group, type, options]
const SETTINGS = [
  ['AGENT_ON', 'yes', 'Master switch for the whole agent', 'Agent', 'switch'],
  ['REPLY_MODE', 'send', 'send = agent replies by itself. draft = replies are saved as Gmail drafts for you to check', 'Agent', 'select', ['send', 'draft']],
  ['TONE', 'Warm & friendly', 'How every email and message sounds', 'Writing', 'select', ['Warm & friendly', 'Formal & professional', 'Short & direct', 'Consultative expert']],
  ['EMAIL_LANGUAGE', 'auto', 'auto = the language of the lead\'s website, or type a language like English', 'Writing', 'text'],
  ['EXTRA_INSTRUCTIONS', '', 'Anything else the AI must always follow (optional)', 'Writing', 'textarea'],
  ['SENDER_NAME', 'Rohini', 'Name used in emails', 'Sender', 'text'],
  ['SENDER_TITLE', 'Business Development Executive', 'Title under the name', 'Sender', 'text'],
  ['COMPANY', 'AAVORAA', '', 'Sender', 'text'],
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
  ['DAILY_START_LIMIT', '20', 'Emails per day in week 1', 'Sending limits', 'number'],
  ['WEEKLY_INCREASE', '10', 'Extra emails per day added each week', 'Sending limits', 'number'],
  ['DAILY_MAX_LIMIT', '50', 'Never send more than this per day (keep 50 or less on Gmail)', 'Sending limits', 'number'],
  ['FOLLOWUP_1_DAYS', '3', 'Days after the first email for follow-up 1', 'Sending limits', 'number'],
  ['FOLLOWUP_2_DAYS', '7', 'Days after the first email for follow-up 2', 'Sending limits', 'number'],
  ['SEND_HOURS', '8-20', 'Only send new emails between these hours (India time), e.g. 8-20. Use 0-24 for all day', 'Sending limits', 'text'],
  ['MIN_FIT_SCORE', '5', 'Leads the AI scores below this are not emailed', 'Lead finding', 'number'],
  ['LEADS_PER_SEARCH', '10', 'Businesses fetched from Google Maps per search', 'Lead finding', 'number'],
  ['FIND_EVERY_HOURS', '8', 'How often to search for new businesses', 'Lead finding', 'number'],
  ['LINKEDIN_PER_RUN', '10', 'LinkedIn prospects added per search', 'Lead finding', 'number'],
  ['LINKEDIN_EVERY_HOURS', '12', 'How often to search for LinkedIn prospects', 'Lead finding', 'number'],
  ['INDUSTRIES', INDUSTRIES, 'Comma separated. One is picked at random each search', 'Targets', 'textarea'],
  ['CITIES', CITIES, 'Comma separated. Any city or country', 'Targets', 'textarea'],
  ['SERVICES', SERVICES, 'What the AI is allowed to offer', 'Targets', 'textarea'],
  ['GEMINI_MODEL', 'gemini-2.5-flash', 'The AI model. Leave as is unless told otherwise', 'Advanced', 'text'],
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
