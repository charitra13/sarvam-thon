// Finds a short list of inventory candidates for one slip description, so the model only ever
// chooses among a few plausible items. Handles Devanagari, transliteration and local spellings
// by comparing rough phonetic forms; the official catalog names are never changed.

const CONSONANTS = {
  क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "n", च: "ch", छ: "chh", ज: "j", झ: "jh", ञ: "n",
  ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n", त: "t", थ: "th", द: "d", ध: "dh", न: "n",
  प: "p", फ: "f", ब: "b", भ: "bh", म: "m", य: "y", र: "r", ल: "l", व: "v", श: "sh",
  ष: "sh", स: "s", ह: "h", ळ: "l", क़: "k", ख़: "kh", ग़: "g", ज़: "z", ड़: "r", ढ़: "rh", फ़: "f",
};
const VOWELS = { अ: "a", आ: "a", इ: "i", ई: "i", उ: "u", ऊ: "u", ऋ: "ri", ए: "e", ऐ: "ai", ओ: "o", औ: "au", ऑ: "o", ऍ: "e" };
const SIGNS = { "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e", "ं": "n", "ः": "h", "ँ": "", "्": "", "़": "" };

// Seed spellings for common shop words. These are heuristics, not shop-confirmed mappings.
const SEED_WORDS = {
  पेसिल: "pencil", पेंसिल: "pencil", पेन्सिल: "pencil", पैंसिल: "pencil", पेन्सल: "pencil", पेंसल: "pencil",
  कॉपी: "copy", कापी: "copy", काॅपी: "copy", कोपी: "copy", रबर: "eraser", रबड़: "eraser", इरेजर: "eraser",
  कटर: "sharpner", शार्पनर: "sharpner", शापनर: "sharpner", गोंद: "glue", कागज: "paper", "कागज़": "paper",
  लिफाफा: "envelope", लिफाफे: "envelope", रजिस्टर: "register", रंग: "colour", कलर: "colour", चॉक: "chalk", चाक: "chalk",
  स्याही: "ink", बॉलपेन: "ballpen", डोम: "doms", पीस: "pcs", पैकेट: "pkt", पाउच: "pouch",
  bp: "ballpen", ream: "rim", nataraj: "natraj", sharpener: "sharpner", color: "colour", reg: "register",
  pencils: "pencil", pens: "pen", erasers: "eraser", sharpeners: "sharpner", pouches: "pouch", copies: "copy", notebooks: "copy", registers: "register",
};
// Words that say how a thing is counted, not what it is.
const NOISE = new Set(["pis", "pees", "piece", "pieces", "pc", "pcs", "pkt", "packet", "nos", "no", "rs", "mrp", "new", "the", "of", "and", "ms"]);
// Product-type words: they matter for telling a pencil from an eraser, not for telling two pens apart.
const KINDS = { pen: "pen", ballpen: "pen", ballpoint: "pen", pencil: "pencil", eraser: "eraser", rubber: "eraser", sharpner: "sharpner", copy: "copy", notebook: "copy", pouch: "pouch", rim: "paper", paper: "paper", register: "register", refill: "refill", ink: "ink", glue: "glue", chalk: "chalk", envelope: "envelope" };
const PACKS = new Set(["pc", "pcs", "pkt", "packet", "box", "jar", "set", "card", "scheme", "scheem", "under", "new", "rs", "mrp"]);

export function transliterate(text) {
  const chars = [...String(text ?? "").normalize("NFC")];
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    let ch = chars[i];
    if (chars[i + 1] === "़" && CONSONANTS[ch + "़"]) ch += chars[++i];
    if (CONSONANTS[ch]) {
      out += CONSONANTS[ch];
      const next = chars[i + 1];
      // Inherent "a" only inside a word: "पेन" is "pen", not "pena".
      if (next && (CONSONANTS[next] || next === "ं" || next === "ः")) out += "a";
    } else if (VOWELS[ch]) out += VOWELS[ch];
    else if (ch in SIGNS) out += SIGNS[ch];
    else if (/[०-९]/.test(ch)) out += ch.charCodeAt(0) - 0x966;
    else out += ch;
  }
  return out;
}

// Loose spelling: soft c/g, aspirates and doubled letters folded. "Natraj" = "nataraj" = "नटराज".
function loose(word) {
  return word.toLowerCase()
    .replace(/chh|ch/g, "C").replace(/c(?=[eiy])/g, "s").replace(/ck|c/g, "k").replace(/C/g, "c")
    .replace(/g(?=[ei])/g, "j").replace(/ph/g, "f").replace(/([kgtdbjs])h/g, "$1")
    .replace(/x/g, "ks").replace(/q/g, "k").replace(/z/g, "j").replace(/w/g, "v").replace(/y/g, "i")
    .replace(/aa/g, "a").replace(/ee/g, "i").replace(/oo/g, "u").replace(/(.)\1+/g, "$1");
}
// Consonant skeleton: vowels after the first letter dropped, so "pensil" ≈ "pencil".
const skeleton = (l) => (l[0] + l.slice(1).replace(/[aeiou]/g, "")).replace(/(.)\1+/g, "$1");

// Splits a name or description into comparable tokens. Numbers stay exact ("25/-" → "25").
export function tokens(text) {
  return String(text ?? "").split(/\s+/).map((w) => SEED_WORDS[w] ?? w).map(transliterate).join(" ")
    .toLowerCase().split(/[^a-z0-9]+/).map((w) => SEED_WORDS[w] ?? w)
    .filter((w) => w && !NOISE.has(w) && (/\d/.test(w) || w.length >= 2))
    .map((w) => (/\d/.test(w) ? { word: w, loose: w, skel: w, num: true } : { word: w, loose: loose(w), skel: skeleton(loose(w)), num: false }));
}

function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
function dice(a, b) {
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return (2 * n) / (A.size + B.size);
}
// How alike two tokens are, 0..1. Numbers only match exactly.
function similar(q, t) {
  if (q.num || t.num) return q.loose === t.loose ? 1 : 0;
  if (q.loose === t.loose) return 1;
  if (q.skel === t.skel) return 0.85;
  const s = Math.max(dice(q.loose, t.loose), q.skel.length >= 3 && t.skel.length >= 3 ? dice(q.skel, t.skel) * 0.9 : 0);
  // A short prefix is a real abbreviation only when it is long enough: "dom" → "doms".
  const prefix = q.loose.length >= 3 && t.loose.startsWith(q.loose) ? 0.75 : 0;
  return Math.max(s, prefix) >= 0.6 ? Math.max(s, prefix) : 0;
}

// Normalised key for a description, used for shop-confirmed aliases.
export const aliasKey = (text, context = "") => contextualDescription(String(text ?? ""), context).normalize("NFC").split(/\s+/)
  .map((w) => SEED_WORDS[w] ?? SEED_WORDS[w.toLowerCase()] ?? w).map(transliterate).join(" ").toLowerCase()
  .replace(/[^a-z0-9./×-]+/g, " ").trim().split(/\s+/).filter(Boolean)
  .map((w) => /\d/.test(w) ? w.replace(/×/g, "x") : loose(w)).join(" ");
// A learnable alias must name something more specific than a bare product type or a number.
const GENERIC_ALIAS_WORDS = new Set([...Object.keys(KINDS), ...NOISE, ...PACKS].map(loose));
export const aliasLearnable = (key) => {
  const identity = key.split(" ").filter((w) => /[a-z0-9]/.test(w) && !GENERIC_ALIAS_WORDS.has(w));
  return key.length <= 200 && identity.length >= 2 && identity.some((w) => w.length >= 3 && !/\d/.test(w));
};

const BRANDS = ["doms", "natraj", "elkos", "shivalal", "apsara", "linc", "camlin", "cello", "reynolds", "pentel", "paras", "hauser", "flair"].map(loose);
const VARIANTS = ["fine", "blue", "black", "red", "gel", "fusion", "inxtra", "inxon", "signy"].map(loose);
const COLOURS = /\b(?:blue|black|red|green)\b/gi;

// A dash variant replaces a colour/size on its preceding full item; it does not replace the brand.
export function contextualDescription(description, context = "") {
  if (!context) return description;
  let base = context;
  if (/\b(?:blue|black|red|green)\b/i.test(description)) base = base.replace(COLOURS, " ");
  if (/\d+\s*[x×]\s*\d+/i.test(description)) base = base.replace(/\d+\s*[x×]\s*\d+/gi, " ");
  if (/\b(?:\d+(?:\.\d+)?\s*\/-|mrp\s*\d+(?:\.\d+)?)/i.test(description)) {
    base = base.replace(/\b(?:\d+(?:\.\d+)?\s*\/-|mrp\s*\d+(?:\.\d+)?)/gi, " ");
  }
  return `${base} ${description}`.replace(/\s+/g, " ").trim();
}

// Hard identity evidence is independent of a model's confidence or the catalog price.
// Unknown shorthand remains weak; only explicit, recognisable distinctions cause rejection here.
export function candidateConflict(description, item) {
  const query = tokens(description);
  const target = tokens(item.name);
  const qKind = query.map(kind).filter(Boolean).at(-1);
  const tKind = target.map(kind).filter(Boolean).at(-1);
  if (qKind && tKind && qKind !== tKind) return "product kind";
  const said = new Set(query.map((t) => t.loose));
  const named = new Set(target.map((t) => t.loose));
  if (BRANDS.some((brand) => said.has(brand) && !named.has(brand))) return "brand";
  if (VARIANTS.some((variant) => said.has(variant) && !named.has(variant))) return "variant";
  const latin = String(description).split(/\s+/).map((word) => SEED_WORDS[word] ?? SEED_WORDS[word.toLowerCase()] ?? word).map(transliterate).join(" ").toLowerCase();
  const targetText = transliterate(item.name).toLowerCase();
  const size = (s) => s.match(/\b\d+\s*[x×]\s*\d+\b/i)?.[0].replace(/\s|×/g, (m) => m === "×" ? "x" : "");
  if (size(latin) && size(latin) !== size(targetText)) return "size";
  const packs = (s) => [...s.matchAll(/\b(pc|pcs|piece|pieces|pkt|packet|jar)\b/g)].map((m) => /^(?:pc|pcs|piece|pieces)$/.test(m[1]) ? "pcs" : m[1] === "packet" ? "pkt" : m[1]);
  const qPacks = packs(latin);
  const unitPacks = packs(String(item.unit).toLowerCase());
  const tPacks = unitPacks.length ? unitPacks : packs(targetText);
  if (qPacks.length && !qPacks.some((p) => tPacks.includes(p))) return "pack";
  const mrp = (s) => s.match(/\b(\d+(?:\.\d+)?)\s*\/-/)?.[1] ?? s.match(/\bmrp\s*(\d+(?:\.\d+)?)/)?.[1];
  if (mrp(latin) && mrp(latin) !== mrp(targetText)) return "printed price";
  if (qKind === "pouch" && /laminat/.test(targetText) && !/laminat/.test(latin)) return "pouch type";
  return null;
}

const kind = (t) => KINDS[t.loose] ?? KINDS[t.word];
const core = (toks) => new Set(toks.filter((t) => !t.num && !PACKS.has(t.word)).map((t) => kind(t) ?? t.loose));

export function buildIndex(items, aliases = []) {
  const entries = items.map((item) => ({ item, toks: tokens(item.name) }));
  const vocab = new Map();
  for (const entry of entries) {
    entry.core = core(entry.toks);
    entry.name = entry.toks.map((t) => t.loose).join(" ");
    for (const t of entry.toks) {
      if (!vocab.has(t.loose)) vocab.set(t.loose, { tok: t, entries: new Set() });
      vocab.get(t.loose).entries.add(entry);
    }
  }
  const idf = new Map([...vocab].map(([k, v]) => [k, Math.log(1 + entries.length / v.entries.size)]));
  const byId = new Map(entries.map((e) => [e.item.id, e]));
  const aliasMap = new Map();
  for (const { alias, item_id } of aliases) {
    if (typeof alias !== "string" || !aliasLearnable(alias) || !byId.has(item_id)) continue;
    if (!aliasMap.has(alias)) aliasMap.set(alias, new Set());
    aliasMap.get(alias).add(item_id);
  }
  return { entries, vocab, idf, byId, aliases: aliasMap };
}

function score(index, query) {
  const scores = new Map();
  let weight = 0;
  for (const q of query) {
    const matches = [];
    for (const [key, { tok, entries }] of index.vocab) {
      const s = similar(q, tok);
      if (s) matches.push({ key, s, entries });
    }
    const w = matches.length ? Math.max(...matches.map((m) => index.idf.get(m.key))) : 3;
    weight += w;
    const best = new Map();
    for (const m of matches) {
      const v = m.s * index.idf.get(m.key);
      for (const e of m.entries) if (v > (best.get(e) ?? 0)) best.set(e, v);
    }
    for (const [e, v] of best) {
      const row = scores.get(e) ?? { q: 0, hit: new Set(), sure: false };
      row.q += Math.min(v, w);
      for (const m of matches) if (m.entries.has(e)) { row.hit.add(m.key); row.sure ||= m.s >= 0.85 && !q.num && q.loose.length >= 3; }
      scores.set(e, row);
    }
  }
  return [...scores].map(([e, { q, hit, sure }]) => {
    const total = e.toks.reduce((s, t) => s + index.idf.get(t.loose), 0);
    const covered = [...new Set(e.toks.map((t) => t.loose))].filter((k) => hit.has(k)).reduce((s, k) => s + index.idf.get(k), 0);
    return { entry: e, sure, score: 0.7 * (q / weight) + 0.3 * (covered / total) };
  }).sort((a, b) => b.score - a.score || a.entry.name.length - b.entry.name.length);
}

const LIMIT = 8;
const MAX = 12;
const MIN_SCORE = 0.3;
const WEAK_SCORE = 0.5;

// Up to 8 best items, plus same-name and same-line variants (pack sizes, units) of the top three,
// capped at 12, so a pcs/pkt or jar/pcs choice is never hidden from review.
export function findCandidates(index, description, context = "") {
  const query = tokens(contextualDescription(description, context));
  const alias = index.aliases.get(aliasKey(description, context));
  if (!query.length && !alias) return { candidates: [], alias: null, weak: true };
  const ranked = query.length ? score(index, query) : [];
  const top = ranked.filter((r) => r.score >= MIN_SCORE).slice(0, LIMIT);
  for (const lead of top.slice(0, 3)) {
    for (const r of ranked) {
      if (top.length >= MAX) break;
      if (!top.includes(r) && sameCore(r.entry, lead.entry)) top.push(r);
    }
  }
  if (alias) {
    for (const id of alias) {
      const entry = index.byId.get(id);
      const at = top.findIndex((r) => r.entry === entry);
      if (at >= 0) top.splice(at, 1);
      top.unshift({ entry, score: 1, alias: true });
    }
  }
  return {
    candidates: top.slice(0, MAX).map((r) => ({ item: r.entry.item, score: Math.round(r.score * 100) / 100, alias: Boolean(r.alias) })),
    alias: alias?.size === 1 ? [...alias][0] : null,
    alias_conflicts: alias?.size > 1 ? [...alias] : [],
    // Weak: low score, or not one word on the slip clearly names a word of the best item.
    weak: !top.length || alias?.size > 1 || (!top[0].alias && (top[0].score < WEAK_SCORE || !top[0].sure || query.length < 2 || query.every((t) => t.num || kind(t) || BRANDS.includes(t.loose)))),
  };
}

function sameCore(a, b) {
  return a.core.size === b.core.size && [...a.core].every((w) => b.core.has(w));
}

// Other candidates the chosen item could be confused with: everything the slip says about the chosen
// item fits the other one too (same name, pcs/pkt/jar packs, or "Natraj 621" for pencil vs sharpener),
// unless a size or price number on the slip tells them apart.
export function lookalikes(index, chosenId, candidateIds, description) {
  const chosen = index.byId.get(chosenId);
  if (!chosen) return [];
  const query = tokens(description);
  const said = (w) => query.some((t) => (kind(t) ?? t.loose) === w || similar(t, { loose: w, skel: skeleton(w) }) >= 0.85);
  const numbers = new Set(query.filter((t) => t.num).map((t) => t.loose));
  const nums = (e) => e.toks.filter((t) => t.num && numbers.has(t.loose)).length;
  const spoken = [...chosen.core].filter(said);
  return candidateIds.filter((id) => id !== chosenId).filter((id) => {
    const other = index.byId.get(id);
    if (!other) return false;
    if (candidateConflict(description, other.item)) return false;
    if (other.name === chosen.name) return true;
    return spoken.every((w) => other.core.has(w)) && nums(other) >= nums(chosen);
  });
}
