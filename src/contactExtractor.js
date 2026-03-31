const axios = require('axios');
const cheerio = require('cheerio');

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(?:(?:\+49|0049|0)[\s.\-]?)(?:\d{2,5})[\s.\-]?\d{3,8}(?:[\s.\-]?\d{2,4})?/g;

function cleanPhone(phone) {
  return phone.replace(/\s+/g, ' ').trim();
}

function filterEmail(email) {
  const blocked = ['example', 'placeholder', 'youremail', 'email@', 'name@', '.png', '.jpg', '.gif', 'noreply', 'no-reply'];
  return !blocked.some(b => email.toLowerCase().includes(b));
}

async function fetchPage(url, timeout = 8000) {
  const response = await axios.get(url, {
    timeout,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    maxRedirects: 5
  });
  return response.data;
}

function extractFromText(text) {
  const emails = (text.match(EMAIL_REGEX) || []).filter(filterEmail);
  const phones = (text.match(PHONE_REGEX) || []).map(cleanPhone);
  return {
    email: emails[0] || null,
    phone: phones[0] || null
  };
}

async function trySubPage(baseUrl, $, pageKeywords) {
  const links = $('a[href]').map((_, el) => $(el).attr('href')).get();
  const matchingLink = links.find(href => {
    if (!href) return false;
    const lower = href.toLowerCase();
    return pageKeywords.some(kw => lower.includes(kw));
  });

  if (!matchingLink) return null;

  try {
    const fullUrl = new URL(matchingLink, baseUrl).href;
    const html = await fetchPage(fullUrl, 6000);
    const $sub = cheerio.load(html);
    const text = $sub('body').text().replace(/\s+/g, ' ');
    return extractFromText(text);
  } catch {
    return null;
  }
}

async function extractContacts(url) {
  if (!url) return {};

  try {
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    // Remove script/style tags
    $('script, style').remove();
    const text = $('body').text().replace(/\s+/g, ' ');

    let contacts = extractFromText(text);

    // If we didn't find an email, check impressum/kontakt subpage
    if (!contacts.email) {
      const sub = await trySubPage(url, $, ['impressum', 'kontakt', 'contact', 'datenschutz', 'about', 'ueber-uns']);
      if (sub) {
        contacts.email = contacts.email || sub.email;
        contacts.phone = contacts.phone || sub.phone;
      }
    }

    return contacts;
  } catch {
    return {};
  }
}

module.exports = { extractContacts };
