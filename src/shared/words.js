// Amount-in-words helpers ("словом") for BG and EN.

const BG_UNITS = {
  n: ['', 'едно', 'две', 'три', 'четири', 'пет', 'шест', 'седем', 'осем', 'девет'],
  m: ['', 'един', 'два', 'три', 'четири', 'пет', 'шест', 'седем', 'осем', 'девет'],
  f: ['', 'една', 'две', 'три', 'четири', 'пет', 'шест', 'седем', 'осем', 'девет'],
};
const BG_TEENS = ['десет', 'единадесет', 'дванадесет', 'тринадесет', 'четиринадесет', 'петнадесет',
  'шестнадесет', 'седемнадесет', 'осемнадесет', 'деветнадесет'];
const BG_TENS = ['', '', 'двадесет', 'тридесет', 'четиридесет', 'петдесет', 'шестдесет', 'седемдесет',
  'осемдесет', 'деветдесет'];
const BG_HUNDREDS = ['', 'сто', 'двеста', 'триста', 'четиристотин', 'петстотин', 'шестстотин',
  'седемстотин', 'осемстотин', 'деветстотин'];

function bgTripleWords(n, gender) {
  const words = [];
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10;
  if (h) words.push(BG_HUNDREDS[h]);
  if (t === 1) words.push(BG_TEENS[u]);
  else {
    if (t) words.push(BG_TENS[t]);
    if (u) words.push(BG_UNITS[gender][u]);
  }
  return words;
}

const joinWithI = (words) =>
  words.length > 1 ? `${words.slice(0, -1).join(' ')} и ${words.at(-1)}` : words.join('');

/** Bulgarian words for a non-negative integer. Default gender neuter (евро). */
export function bgNumber(n, gender = 'n') {
  if (n === 0) return 'нула';
  const millions = Math.floor(n / 1e6), thousands = Math.floor((n % 1e6) / 1000), rest = n % 1000;
  const parts = [];
  if (millions) parts.push(millions === 1 ? 'един милион' : `${joinWithI(bgTripleWords(millions, 'm'))} милиона`);
  if (thousands) parts.push(thousands === 1 ? 'хиляда' : `${joinWithI(bgTripleWords(thousands, 'f'))} хиляди`);
  if (rest) {
    const w = bgTripleWords(rest, gender);
    if (parts.length && w.length === 1) parts.push(`и ${w[0]}`);
    else parts.push(joinWithI(w));
  }
  return parts.join(' ');
}

const EN_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function enTriple(n) {
  const h = Math.floor(n / 100), r = n % 100, out = [];
  if (h) out.push(`${EN_ONES[h]} hundred`);
  if (r) {
    if (r < 20) out.push(EN_ONES[r]);
    else out.push(EN_TENS[Math.floor(r / 10)] + (r % 10 ? `-${EN_ONES[r % 10]}` : ''));
  }
  return out.join(' and ');
}

export function enNumber(n) {
  if (n === 0) return 'zero';
  const scales = [[1e6, 'million'], [1000, 'thousand']];
  const parts = [];
  let rest = n;
  for (const [v, name] of scales) {
    const q = Math.floor(rest / v);
    if (q) parts.push(`${enTriple(q)} ${name}`);
    rest %= v;
  }
  if (rest) parts.push(enTriple(rest));
  return parts.join(' ');
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** amountCents → "Четири хиляди ... евро и 44 евроцента" */
export function amountInWords(amountCents, lang) {
  const euros = Math.floor(amountCents / 100), cents = amountCents % 100;
  const cc = String(cents).padStart(2, '0');
  if (lang === 'en') return `${cap(enNumber(euros))} euro and ${cc} cents`;
  return `${cap(bgNumber(euros))} евро и ${cc} ${cents === 1 ? 'евроцент' : 'евроцента'}`;
}
