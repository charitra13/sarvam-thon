// Candidate retrieval and the full matchSlip pipeline with the model replaced by a scripted stand-in.
// tests/fixtures/catalog.json is the full 3,950-item shop catalog (ids, names, units, list prices; no cost or stock).
import { describe, expect, test } from "bun:test";
import { aliasKey, aliasLearnable, buildIndex, findCandidates, lookalikes } from "../lib/catalog.js";
import { matchSlip } from "../lib/sarvam.js";
import rows from "./fixtures/catalog.json";
import slips from "./fixtures/slips.json";

const items = rows.map(([id, sku, name, category, unit, sell_price]) => ({ id, sku, name, category, unit, sell_price }));
const index = buildIndex(items);
const ids = (description) => findCandidates(index, description).candidates.map((c) => c.item.id);

// Reads the prompt the pipeline sends and answers with `choose(line)`; records every call.
function scriptedModel(choose) {
  const calls = [];
  const complete = async (messages, maxTokens) => {
    const prompt = messages.at(-1).content;
    calls.push({ messages, maxTokens });
    const lines = prompt.split(/\n\n(?=Line \d+:)/).map((block) => {
      const [head, ...options] = block.split("\n");
      return {
        line: Number(head.match(/^Line (\d+):/)[1]),
        description: head.match(/“(.*?)”/)[1],
        options: options.map((o) => ({ key: o.trim().split(" ")[0], name: o.trim().replace(/^c\d+ /, "").split(" | ")[0] })),
      };
    });
    return JSON.stringify({ lines: lines.map((l) => ({ line: l.line, ...choose(l) })) });
  };
  return { complete, calls };
}
const pickName = (map) => (line) => {
  const want = map[line.description];
  const option = line.options.find((o) => o.name === want);
  return { pick: option?.key ?? null, confidence: 0.95 };
};

describe("candidate retrieval", () => {
  test("exact English names find their item first", () => {
    expect(ids("Doms Fusion Pencil")[0]).toBe(1750);
    expect(ids("DOMS INXTRA BALLPEN")[0]).toBe(2662);
  });

  test("Hindi and transliterated names find the same items", () => {
    expect(ids("पेन डोम्स इनक्स्ट्रा")).toEqual(expect.arrayContaining([2662, 3999, 2663]));
    expect(ids("कॉपी शिवालाल 25/-")[0]).toBe(2050);
    expect(ids("डोम्स ट्रायंगल रबर")).toEqual(expect.arrayContaining([1438, 1439]));
    expect(ids("नटराज पेंसिल")).toContain(1896);
  });

  test("pack variants are never hidden behind each other", () => {
    expect(ids("Elkos Signy Pen")).toEqual(expect.arrayContaining([2766, 3997]));
    expect(ids("Doms Triangle Eraser")).toEqual(expect.arrayContaining([1438, 1439]));
  });

  test("lists stay bounded", () => {
    for (const d of ["pen", "Shivalal copy", "Doms", "नटराज"]) expect(ids(d).length).toBeLessThanOrEqual(12);
  });

  test("unresolvable shorthand is marked weak instead of forced", () => {
    expect(findCandidates(index, "जिस पत्ती फोर्ट 20").weak).toBe(true);
    expect(findCandidates(index, "PFKKO").weak).toBe(true);
    expect(findCandidates(index, "—").candidates).toEqual([]);
  });

  test("lookalikes: same name, pcs vs pkt, and number-only descriptions", () => {
    expect(lookalikes(index, 2766, ids("Elkos Signy Pen"), "Elkos Signy Pen")).toContain(3997);
    expect(lookalikes(index, 3999, ids("पेन डोम्स इनक्स्ट्रा"), "पेन डोम्स इनक्स्ट्रा")).toContain(2662);
    expect(lookalikes(index, 1896, ids("Natraj 621"), "Natraj 621")).toEqual(expect.arrayContaining([1898, 1454]));
    // The slip's "25/-" tells the 25/- copy apart from the 12/- copy.
    expect(lookalikes(index, 2050, ids("कॉपी शिवालाल 25/-"), "कॉपी शिवालाल 25/-")).not.toContain(2048);
    expect(lookalikes(index, 1750, ids("Doms Fusion Pencil"), "Doms Fusion Pencil")).toEqual([]);
  });

  test("aliases: only specific names are learnable, and a confirmed one leads the list", () => {
    expect(aliasLearnable(aliasKey("पेन"))).toBe(false);
    expect(aliasLearnable(aliasKey("pen 20"))).toBe(false);
    expect(aliasLearnable(aliasKey("पोसम डोम ब्लन"))).toBe(true);
    const learned = buildIndex(items, [{ alias: aliasKey("पोसम डोम ब्लन"), item_id: 1750 }]);
    expect(findCandidates(learned, "पोसम डोम ब्लन")).toMatchObject({ alias: 1750 });
    expect(findCandidates(learned, "पोसम डोम ब्लन").candidates[0].item.id).toBe(1750);
  });
});

describe("matchSlip pipeline", () => {
  const controlled = {
    "Doms Fusion Pencil": "DOMS FUSION PENCIL 12%",
    "DOMS INXTRA BALLPEN": "DOMS INXTRA BALLPEN",
    "पेन डोम्स इनक्स्ट्रा": "DOMS INXTRA BALLPEN",
    "कॉपी शिवालाल 25/-": "SHIVALAL COPY  25/-",
  };

  test("the model only picks SKUs; every figure stays as read from the slip", async () => {
    const model = scriptedModel(pickName(controlled));
    const result = await matchSlip(slips.controlled, items, { complete: model.complete });
    const [pencil, ballpen, hindi, copy] = result.items;
    expect(pencil).toMatchObject({ item_id: 1750, qty: 200, unit_price: 4.1, line_total: 820 });
    expect(ballpen).toMatchObject({ item_id: 2662, qty: 100, unit_price: 3.8 });
    expect(copy).toMatchObject({ item_id: 2050, qty: 200, unit_price: 15.6, description: "कॉपी शिवालाल 25/-" });
    expect(hindi.item_id).toBe(2662);
    expect(hindi.ambiguous_with).toContain(3999);
    expect(hindi.needs_review).toBe(true);
    expect(hindi.confidence).toBeLessThanOrEqual(0.5);
    expect(model.calls).toHaveLength(1);
  });

  test("prompts are bounded to each line's shortlist, never the whole catalog", async () => {
    const model = scriptedModel(() => ({ pick: null }));
    await matchSlip(slips["ankur-hi"], items, { complete: model.complete });
    const prompt = model.calls.map((c) => c.messages.map((m) => m.content).join("\n")).join("\n");
    expect(model.calls).toHaveLength(1);
    expect(prompt.length).toBeLessThan(18 * 12 * 120 + 3000);
    expect((prompt.match(/^ {2}c\d+ /gm) ?? []).length).toBeLessThanOrEqual(18 * 12);
    expect(model.calls[0].maxTokens).toBeGreaterThanOrEqual(18 * 55);
    expect(model.calls[0].maxTokens).toBeLessThanOrEqual(2400);
  });

  test("more than 18 lines are split into bounded calls", async () => {
    const text = Array.from({ length: 20 }, (_, i) => `${i + 1} 10 Doms Fusion Pencil 4/10 41`).join("\n");
    const model = scriptedModel(() => ({ pick: null }));
    const result = await matchSlip(text, items, { complete: model.complete });
    expect(result.items).toHaveLength(20);
    expect(model.calls).toHaveLength(2);
  });

  test("a pick outside the line's shortlist, or a raw catalog id, is ignored", async () => {
    const model = scriptedModel((line) => ({ pick: line.line === 1 ? "c99" : "1750", confidence: 1 }));
    const result = await matchSlip(slips.controlled, items, { complete: model.complete });
    for (const line of result.items) expect(line.item_id).toBeNull();
    expect(result.items[0].needs_review).toBe(true);
    expect(result.items[0].issues.some((i) => i.message.includes("outside this line's shortlist"))).toBe(true);
  });

  test("a candidate key valid for another row is still invalid for this row", async () => {
    const local = [
      { id: 1, sku: "A", name: "Doms Fusion Pencil", unit: "pcs", sell_price: 4 },
      { id: 2, sku: "B", name: "Elkos Signy Pen", unit: "pcs", sell_price: 5 },
      { id: 3, sku: "C", name: "Elkos Signy Pen", unit: "pkt", sell_price: 25 },
    ];
    const model = scriptedModel((line) => ({ pick: line.line === 1 ? "c2" : "c1", confidence: 1 }));
    const result = await matchSlip("1 10 Doms Fusion Pencil 4 40\n2 10 Elkos Signy Pen 5 50", local, { complete: model.complete });
    expect(result.items[0].candidates).toHaveLength(1);
    expect(result.items[1].candidates.length).toBeGreaterThan(1);
    expect(result.items[0].item_id).toBeNull();
    expect(result.items[0].issues.some((issue) => issue.message.includes("outside this line's shortlist"))).toBe(true);
  });

  test("numbers in the model reply cannot change the figures", async () => {
    const model = scriptedModel(() => ({ pick: "c1", qty: 2, rate: 2140, amount: 0 }));
    const result = await matchSlip(slips["ankur-hi"], items, { complete: model.complete });
    expect(result.items[0]).toMatchObject({ qty: 100, unit_price: 4.1, amount: 410 });
  });

  test("the captured legacy reply is a retriable matching failure", async () => {
    const complete = async () => slips["sanjeev-captured-model-reply"];
    await expect(matchSlip(slips["sanjeev-hi"], items, { complete })).rejects.toThrow();
  });

  test("Sanjeev numeric regression: a matching reply cannot turn amount 320 into rate 320", async () => {
    const model = scriptedModel(() => ({ pick: null, qty: "100 पीस", rate: "320", amount: "" }));
    const result = await matchSlip(slips["sanjeev-hi"], items, { complete: model.complete });
    expect(result.items).toHaveLength(5);
    expect(result.items[0]).toMatchObject({ qty: 100, unit_price: 3.2, amount: 320, item_id: null, needs_review: true });
    expect(result.items[2].issues.some((i) => i.message.includes("Slip rate"))).toBe(false);
    expect(result.items.map((l) => l.raw)).toEqual(slips["sanjeev-hi"].split("\n").slice(2, 7));
  });

  test("duplicate pack variants picked by the model are flagged, not trusted", async () => {
    const model = scriptedModel((line) => ({ pick: line.options.find((o) => o.name === "Elkos Signy Pen")?.key, confidence: 0.99 }));
    const result = await matchSlip("1 10 Elkos Signy Pen 5 50", items, { complete: model.complete });
    expect(result.items[0].ambiguous_with.length).toBe(1);
    expect(result.items[0].needs_review).toBe(true);
  });

  test("a shop-confirmed alias matches without asking the model", async () => {
    const model = scriptedModel(() => ({ pick: null }));
    const aliases = [{ alias: aliasKey("पेन डोम्स इनक्स्ट्रा"), item_id: 2662 }];
    const result = await matchSlip("1 100 पेन डोम्स इनक्स्ट्रा 3/80 380", items, { aliases, complete: model.complete });
    expect(result.items[0]).toMatchObject({ item_id: 2662, needs_review: false });
    expect(model.calls).toHaveLength(0);
  });

  test("fallback grounds raw text and ignores invented numeric cells", async () => {
    const complete = async (messages) => messages[0].content.includes("printed Hindi bill book")
      ? JSON.stringify({ customer_name: "Invented", items: [{ source_line: 2, sno: 1, qty: "12", description: "Doms Fusion Pencil", rate: "4/10", amount: "49-20", raw: "invented raw" }] })
      : scriptedModel(() => ({ pick: null })).complete(messages);
    const source = "Doms Fusion Pencil twelve at four ten";
    const result = await matchSlip(`Ravi traders\n${source}`, items, { complete });
    expect(result.customer_name).not.toBe("Invented");
    expect(result.items[0]).toMatchObject({ raw: source, qty: null, unit_price: null, amount: null, needs_review: true });
  });

  test("empty, partial and duplicate matching replies fail instead of becoming deliberate nulls", async () => {
    for (const reply of ["", "{}", '{"lines":[]}', '{"lines":[{"line":1,"pick":null}]}', '{"lines":[{"line":1,"pick":null},{"line":1,"pick":null}]}']) {
      await expect(matchSlip(slips.controlled, items, { complete: async () => reply })).rejects.toThrow();
    }
    for (const text of ["", "Unknown layout"]) {
      await expect(matchSlip(text, items, { complete: async () => '{"items":[]}' })).rejects.toThrow();
    }
  });

  test("alias keys preserve explicit pack and size distinctions", () => {
    expect(aliasKey("Elkos Signy pcs")).not.toBe(aliasKey("Elkos Signy pkt"));
    expect(aliasKey("Rim 16x26")).not.toBe(aliasKey("Rim 17x27"));
    expect(aliasKey("File 1.5 inch")).not.toBe(aliasKey("File 1/5 inch"));
    expect(aliasLearnable(aliasKey("pen 20 pcs"))).toBe(false);
    expect(aliasLearnable(aliasKey("Doms pcs"))).toBe(false);
    expect(aliasLearnable(aliasKey("Doms -"))).toBe(false);
  });

  test("brand-only and numeric-only descriptions remain weak", () => {
    for (const description of ["Doms", "Natraj", "621", "pen 20"]) expect(findCandidates(index, description).weak).toBe(true);
  });

  test("conflicting confirmed aliases remain ambiguous", async () => {
    const description = "Elkos Signy Pen";
    const aliases = [2766, 3997].map((item_id) => ({ alias: aliasKey(description), item_id }));
    const model = scriptedModel(() => ({ pick: "c1", confidence: 1 }));
    const result = await matchSlip(`1 10 ${description} 5 50`, items, { aliases, complete: model.complete });
    expect(result.items[0].needs_review).toBe(true);
    expect(result.items[0].ambiguous_with.length).toBeGreaterThan(0);
  });

  test("a wrong-kind in-list pick cannot be trusted at high confidence", async () => {
    const local = [
      { id: 1, sku: "P", name: "Natraj 621 Pencil", unit: "pcs", sell_price: 3 },
      { id: 2, sku: "E", name: "Natraj 621 Eraser", unit: "pcs", sell_price: 3 },
    ];
    const model = scriptedModel((line) => ({ pick: line.options.find((o) => o.name.includes("Eraser"))?.key ?? "c1", confidence: 1 }));
    const result = await matchSlip("1 10 Natraj 621 pencil 3 30", local, { complete: model.complete });
    expect(result.items[0].item_id).not.toBe(2);
  });

  test("in-list choices cannot override explicit size, pack, MRP or pouch type", async () => {
    for (const [description, wrongName, wrongUnit] of [
      ["Rim 16x26", "Rim 17x27", "pcs"],
      ["Elkos Signy pcs", "Elkos Signy Pen (20 pcs)", "pkt"],
      ["Doms Inxtra Fine Ballpen", "DOMS INXTRA BALLPEN", "pcs"],
      ["Copy Shivalal 25/-", "SHIVALAL COPY 12/-", "pcs"],
      ["पाउच", "LAMINATION POUCH", "pcs"],
    ]) {
      const local = [{ id: 1, sku: "WRONG", name: wrongName, unit: wrongUnit, sell_price: 5 }];
      const model = scriptedModel(() => ({ pick: "c1", confidence: 1 }));
      const result = await matchSlip(`1 10 ${description} 5 50`, local, { complete: model.complete });
      expect(result.items[0].item_id).toBeNull();
      expect(result.items[0].needs_review).toBe(true);
    }
  });

  test("a fallback numeric cell is read from its own position, never a different source row", async () => {
    const source = "100 Doms Fusion Pencil 410\n200 Elkos Signy Pen 5 1000";
    const choose = scriptedModel(() => ({ pick: null }));
    const complete = async (messages, maxTokens) => messages[0].content.includes("printed Hindi bill book")
      ? JSON.stringify({ items: [{ source_line: 1, qty: "200", rate: "5", amount: "1000" }] })
      : choose.complete(messages, maxTokens);
    const result = await matchSlip(source, items, { complete });
    expect(result.items[0]).toMatchObject({ raw: source.split("\n")[0], qty: 100, rate_text: "", amount: 410, unit_price: 4.1, needs_review: true });
    await expect(matchSlip(source, items, { complete: async () => '{"items":[{"source_line":99}]}' })).rejects.toThrow();
  });

  test("chained dash variants keep the preceding full product context", async () => {
    const model = scriptedModel(() => ({ pick: null }));
    await matchSlip("1 10 Doms gel pen blue 5 50\n2 5 - red 5 25\n3 6 - black 5 30", items, { complete: model.complete });
    const prompt = model.calls.map((c) => c.messages.at(-1).content).join("\n");
    expect(prompt).toContain("“black” (continues the line above: “Doms gel pen blue”)");
  });

  test("a model failure is passed up so the page can offer a retry", async () => {
    const complete = async () => { throw new Error("timeout"); };
    expect(matchSlip(slips.controlled, items, { complete })).rejects.toThrow("timeout");
  });
});
